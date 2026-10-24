package com.vehicletracker.api.controller;

import com.vehicletracker.api.model.ApiModels.UserSummary;
import com.vehicletracker.api.repository.TrackerRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** Registered users (login accounts). Passwords are never read or returned. */
@RestController
@RequestMapping("/api/users")
@Tag(name = "Users", description = "Registered login accounts and their activity")
public class UserController {

    private final TrackerRepository repository;

    public UserController(TrackerRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    @Operation(summary = "List all users with sign-up date, last login and entry counts")
    public List<UserSummary> listUsers() {
        return repository.findUsers();
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get one user")
    public ResponseEntity<UserSummary> getUser(@PathVariable UUID id) {
        return repository.findUser(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }
}
