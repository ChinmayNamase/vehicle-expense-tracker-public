package com.vehicletracker.api.controller;

import com.vehicletracker.api.model.ApiModels.Stats;
import com.vehicletracker.api.repository.TrackerRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.Map;

@RestController
@RequestMapping("/api")
@Tag(name = "Status", description = "Health check and database totals")
public class StatusController {

    private final TrackerRepository repository;
    private final Environment environment;

    public StatusController(TrackerRepository repository, Environment environment) {
        this.repository = repository;
        this.environment = environment;
    }

    @GetMapping("/health")
    @Operation(summary = "Public health check: is the API running and can it reach the database?")
    public Map<String, Object> health() {
        boolean up;
        try {
            up = repository.isDatabaseUp();
        } catch (RuntimeException e) {
            up = false;
        }
        return Map.of(
                "status", up ? "UP" : "DATABASE_UNREACHABLE",
                "database", String.join(",", Arrays.asList(environment.getActiveProfiles())));
    }

    @GetMapping("/stats")
    @Operation(summary = "Totals across the whole database (users, vehicles, entries, money, litres)")
    public Stats stats() {
        return repository.stats();
    }
}
