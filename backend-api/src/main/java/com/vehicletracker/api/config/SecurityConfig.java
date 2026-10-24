package com.vehicletracker.api.config;

import com.vehicletracker.api.auth.AuthService;
import com.vehicletracker.api.auth.TokenAuthenticationFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

/**
 * Security rules.
 *  - Website pages, CSS, JS and /api/auth/register|login are public.
 *  - /api/app/** (the website's data) needs a website login token (role USER).
 *  - Everything else (admin page, admin API, Swagger UI, database console) needs
 *    the admin login (HTTP Basic). Passwords are kept only as BCrypt hashes.
 */
@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AuthService authService) throws Exception {
        RequestMatcher websiteApi = request -> request.getRequestURI().startsWith("/api/app/")
                || request.getRequestURI().startsWith("/api/auth/");
        http
                // Lets the public website (e.g. on Vercel) call this API from another address.
                .cors(Customizer.withDefaults())
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/admin.html", "/admin.js", "/admin.css").hasRole("ADMIN")
                        .requestMatchers("/api/health", "/api/auth/register", "/api/auth/login", "/api/auth/logout").permitAll()
                        .requestMatchers("/api/app/**", "/api/auth/**").hasRole("USER")
                        .requestMatchers("/", "/*.html", "/css/**", "/js/**", "/assets/**", "/favicon.ico", "/error").permitAll()
                        .anyRequest().hasRole("ADMIN"))
                .addFilterBefore(new TokenAuthenticationFilter(authService), BasicAuthenticationFilter.class)
                .httpBasic(Customizer.withDefaults())
                // Website API calls get a plain 401 (no browser login pop-up).
                .exceptionHandling(e -> e.defaultAuthenticationEntryPointFor(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED), websiteApi))
                // Stateless: every request carries its own token / admin login, so CSRF tokens are not needed.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .headers(h -> h.frameOptions(f -> f.sameOrigin()));
        return http.build();
    }

    /**
     * CORS: which other websites may call /api/** from the browser.
     * Set with CORS_ALLOWED_ORIGINS (comma-separated). Empty = only this server's own pages.
     * Logins use the Authorization header (no cookies), so credentials are not shared.
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource(@Value("${app.cors.allowed-origins:}") String allowedOrigins) {
        List<String> origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim).map(o -> o.replaceAll("/+$", "")).filter(o -> !o.isEmpty()).toList();
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(origins);
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept"));
        config.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    UserDetailsService adminUser(@Value("${app.admin.username}") String username,
                                 @Value("${app.admin.password}") String password,
                                 PasswordEncoder encoder) {
        if (password == null || password.length() < 8) {
            throw new IllegalStateException("ADMIN_PASSWORD must be at least 8 characters.");
        }
        return new InMemoryUserDetailsManager(User.withUsername(username)
                .password(encoder.encode(password))
                .roles("ADMIN")
                .build());
    }
}
