package com.vehicletracker.api.controller;

import com.vehicletracker.api.model.ApiModels.Expense;
import com.vehicletracker.api.model.ApiModels.FuelLog;
import com.vehicletracker.api.model.ApiModels.InsuranceRecord;
import com.vehicletracker.api.model.ApiModels.MaintenanceRecord;
import com.vehicletracker.api.model.ApiModels.NewExpenseRequest;
import com.vehicletracker.api.model.ApiModels.Vehicle;
import com.vehicletracker.api.repository.TrackerRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Vehicles and all entries (expenses, fuel logs, services, insurance).
 * Every list endpoint accepts an optional ?userId= filter.
 */
@RestController
@RequestMapping("/api")
@Tag(name = "Entries", description = "Vehicles, expenses, fuel logs, maintenance and insurance")
public class EntryController {

    /** Categories a manual expense may use. Petrol must come from the Fuel Tracker (enforced by the DB too). */
    private static final Set<String> MANUAL_CATEGORIES = Set.of(
            "Bike/Car Purchase", "Servicing", "Spare Parts", "Insurance",
            "Repairs", "Accessories", "Parking and Tolls", "Other");
    private static final int MAX_LIMIT = 5000;

    private final TrackerRepository repository;

    public EntryController(TrackerRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/vehicles")
    @Operation(summary = "List vehicles (optionally for one user)")
    public List<Vehicle> vehicles(@RequestParam(required = false) UUID userId) {
        return repository.findVehicles(userId);
    }

    @GetMapping("/expenses")
    @Operation(summary = "List expenses with optional filters: userId, vehicleId, category, from, to (YYYY-MM-DD)")
    public List<Expense> expenses(
            @RequestParam(required = false) UUID userId,
            @RequestParam(required = false) UUID vehicleId,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "500") int limit) {
        return repository.findExpenses(userId, vehicleId, category, from, to, clampLimit(limit));
    }

    @GetMapping("/expenses/{id}")
    @Operation(summary = "Get one expense")
    public ResponseEntity<Expense> expense(@PathVariable UUID id) {
        return repository.findExpense(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/expenses")
    @Operation(summary = "Add a manual (non-fuel) expense for a user's vehicle")
    public ResponseEntity<Expense> addExpense(@Valid @RequestBody NewExpenseRequest request) {
        if (!MANUAL_CATEGORIES.contains(request.category())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "category must be one of " + MANUAL_CATEGORIES + " (Petrol entries come from the Fuel Tracker)");
        }
        UUID id = repository.insertExpense(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(repository.findExpense(id).orElseThrow());
    }

    @DeleteMapping("/expenses/{id}")
    @Operation(summary = "Delete an expense (a linked fuel/service/insurance record is deleted with it)")
    public ResponseEntity<Void> deleteExpense(@PathVariable UUID id) {
        return repository.deleteExpense(id) ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    @GetMapping("/fuel-logs")
    @Operation(summary = "List fuel fills (optionally for one user or vehicle)")
    public List<FuelLog> fuelLogs(@RequestParam(required = false) UUID userId,
                                  @RequestParam(required = false) UUID vehicleId,
                                  @RequestParam(defaultValue = "500") int limit) {
        return repository.findFuelLogs(userId, vehicleId, clampLimit(limit));
    }

    @GetMapping("/maintenance")
    @Operation(summary = "List service records")
    public List<MaintenanceRecord> maintenance(@RequestParam(required = false) UUID userId) {
        return repository.findMaintenance(userId);
    }

    @GetMapping("/insurance")
    @Operation(summary = "List insurance policies")
    public List<InsuranceRecord> insurance(@RequestParam(required = false) UUID userId) {
        return repository.findInsurance(userId);
    }

    private static int clampLimit(int limit) {
        return Math.max(1, Math.min(limit, MAX_LIMIT));
    }
}
