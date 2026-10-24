package com.vehicletracker.api.controller;

import com.vehicletracker.api.auth.AuthService;
import com.vehicletracker.api.auth.AuthService.AppUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Website sign-up, login, logout and password change (our own login system). */
@RestController
@RequestMapping("/api/auth")
@Tag(name = "Website login", description = "Register, log in, log out (own user database)")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    public record RegisterRequest(String email, String password, String fullName) {
    }

    public record LoginRequest(String email, String password) {
    }

    public record PasswordRequest(String password) {
    }

    @PostMapping("/register")
    @Operation(summary = "Create an account; returns a login session")
    public Map<String, Object> register(@RequestBody RegisterRequest request) {
        return authService.register(request.email(), request.password(), request.fullName());
    }

    @PostMapping("/login")
    @Operation(summary = "Log in with email and password; returns a session token")
    public Map<String, Object> login(@RequestBody LoginRequest request) {
        return authService.login(request.email(), request.password());
    }

    @PostMapping("/logout")
    @Operation(summary = "End the current session")
    public ResponseEntity<Void> logout(@RequestHeader(value = "Authorization", required = false) String header) {
        authService.logout(header != null && header.startsWith("Bearer ") ? header.substring(7).trim() : null);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    @Operation(summary = "The logged-in user")
    public Map<String, Object> me(@AuthenticationPrincipal AppUser user) {
        return Map.of("user", user.toJson());
    }

    @PostMapping("/password")
    @Operation(summary = "Change the logged-in user's password")
    public ResponseEntity<Void> changePassword(@AuthenticationPrincipal AppUser user, @RequestBody PasswordRequest request) {
        authService.changePassword(user.id(), request.password());
        return ResponseEntity.noContent().build();
    }
}
