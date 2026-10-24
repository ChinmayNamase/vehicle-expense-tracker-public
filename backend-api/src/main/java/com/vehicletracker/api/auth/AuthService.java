package com.vehicletracker.api.auth;

import com.vehicletracker.api.exception.AppException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Our own login system.
 *  - Passwords are stored only as BCrypt hashes (never plain text).
 *  - After login the browser gets a random 256-bit token; the database stores
 *    only the token's SHA-256 hash, so a stolen database cannot be used to log in.
 */
@Service
public class AuthService {

    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final int sessionDays;

    public AuthService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, @Value("${app.session.days:30}") int sessionDays) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.sessionDays = sessionDays;
    }

    /** A logged-in user as seen by the website. */
    public record AppUser(UUID id, String email, String fullName) {
        public Map<String, Object> toJson() {
            Map<String, Object> json = new LinkedHashMap<>();
            json.put("id", id);
            json.put("email", email);
            json.put("user_metadata", Map.of("full_name", fullName == null ? "" : fullName));
            return json;
        }
    }

    @Transactional
    public Map<String, Object> register(String email, String password, String fullName) {
        String normalized = normalizeEmail(email);
        validatePassword(password);
        Integer existing = jdbc.queryForObject("select count(*) from auth.users where email = ?", Integer.class, normalized);
        if (existing != null && existing > 0) {
            throw new AppException(HttpStatus.CONFLICT, "user_exists", "An account with this email already exists. Please log in.");
        }
        UUID id = UUID.randomUUID();
        String name = fullName == null ? null : fullName.trim();
        jdbc.update("insert into auth.users (id, email, full_name, password_hash, last_sign_in_at) values (?, ?, ?, ?, current_timestamp)",
                id, normalized, name, passwordEncoder.encode(password));
        return newSession(new AppUser(id, normalized, name));
    }

    @Transactional
    public Map<String, Object> login(String email, String password) {
        String normalized = email == null ? "" : email.trim().toLowerCase();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select id, email, full_name, password_hash from auth.users where email = ?", normalized);
        if (rows.isEmpty() || rows.get(0).get("password_hash") == null
                || password == null || !passwordEncoder.matches(password, (String) rows.get(0).get("password_hash"))) {
            throw new AppException(HttpStatus.BAD_REQUEST, "invalid_credentials", "Invalid login credentials");
        }
        Map<String, Object> row = rows.get(0);
        UUID id = (UUID) row.get("id");
        jdbc.update("update auth.users set last_sign_in_at = current_timestamp where id = ?", id);
        return newSession(new AppUser(id, (String) row.get("email"), (String) row.get("full_name")));
    }

    public void logout(String token) {
        if (token != null) {
            jdbc.update("delete from auth.sessions where token_hash = ?", hash(token));
        }
    }

    @Transactional
    public void changePassword(UUID userId, String newPassword) {
        validatePassword(newPassword);
        jdbc.update("update auth.users set password_hash = ? where id = ?", passwordEncoder.encode(newPassword), userId);
    }

    /** Finds the user for a token, or empty if the token is unknown or expired. */
    public Optional<AppUser> findUserByToken(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        List<AppUser> users = jdbc.query("""
                select u.id, u.email, u.full_name
                from auth.sessions s join auth.users u on u.id = s.user_id
                where s.token_hash = ? and s.expires_at > current_timestamp
                """, (rs, i) -> new AppUser(rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("full_name")),
                hash(token));
        return users.stream().findFirst();
    }

    private Map<String, Object> newSession(AppUser user) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.update("delete from auth.sessions where expires_at < current_timestamp");
        jdbc.update("insert into auth.sessions (token_hash, user_id, expires_at) values (?, ?, ?)",
                hash(token), user.id(), OffsetDateTime.now().plusDays(sessionDays));
        Map<String, Object> session = new LinkedHashMap<>();
        session.put("access_token", token);
        session.put("user", user.toJson());
        return Map.of("session", session, "user", user.toJson());
    }

    private static String normalizeEmail(String email) {
        String normalized = email == null ? "" : email.trim().toLowerCase();
        if (!EMAIL.matcher(normalized).matches()) {
            throw new AppException(HttpStatus.BAD_REQUEST, "invalid_email", "Enter a valid email address.");
        }
        return normalized;
    }

    private static void validatePassword(String password) {
        if (password == null || password.length() < 8 || !password.matches(".*[A-Za-z].*") || !password.matches(".*\\d.*")) {
            throw new AppException(HttpStatus.BAD_REQUEST, "weak_password",
                    "Password must be at least 8 characters and contain a letter and a number.");
        }
    }

    static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
