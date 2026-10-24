package com.vehicletracker.api.controller;

import com.vehicletracker.api.app.AppDataService;
import com.vehicletracker.api.auth.AuthService.AppUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The website's data API. {table} is one of: vehicles, expenses, fuel_logs,
 * maintenance_records, insurance_records. Every request needs a login token and
 * only ever touches the logged-in user's own rows.
 */
@RestController
@RequestMapping("/api/app")
@Tag(name = "Website data", description = "The logged-in user's vehicles and entries (Bearer token)")
public class AppDataController {

    private final AppDataService service;

    public AppDataController(AppDataService service) {
        this.service = service;
    }

    @GetMapping("/{table}")
    @Operation(summary = "List my rows of a table")
    public List<Map<String, Object>> list(@AuthenticationPrincipal AppUser user, @PathVariable String table) {
        return service.list(user.id(), table);
    }

    @PostMapping("/{table}")
    @Operation(summary = "Add one row (JSON object) or many rows (JSON array)")
    @SuppressWarnings("unchecked")
    public ResponseEntity<List<Map<String, Object>>> insert(@AuthenticationPrincipal AppUser user,
                                                            @PathVariable String table, @RequestBody Object body) {
        List<Map<String, Object>> rows = body instanceof List<?> list
                ? (List<Map<String, Object>>) list
                : List.of((Map<String, Object>) body);
        return ResponseEntity.status(HttpStatus.CREATED).body(service.insert(user.id(), table, rows));
    }

    @PatchMapping("/{table}/{id}")
    @Operation(summary = "Update one of my rows")
    public Map<String, Object> update(@AuthenticationPrincipal AppUser user, @PathVariable String table,
                                      @PathVariable UUID id, @RequestBody Map<String, Object> values) {
        return service.update(user.id(), table, id, values);
    }

    @DeleteMapping("/{table}/{id}")
    @Operation(summary = "Delete one of my rows")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AppUser user, @PathVariable String table, @PathVariable UUID id) {
        service.delete(user.id(), table, id);
        return ResponseEntity.noContent().build();
    }
}
