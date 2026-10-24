package com.vehicletracker.api.model;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * Data Transfer Objects (DTOs) returned by the REST API as JSON.
 * Java records are immutable classes with a constructor, getters, equals and toString.
 */
public final class ApiModels {

    private ApiModels() {
    }

    /** A registered user (login account) with activity counts. Passwords are never read. */
    public record UserSummary(
            UUID id,
            String email,
            String fullName,
            OffsetDateTime signedUpAt,
            OffsetDateTime lastSignInAt,
            long vehicles,
            long entries,
            BigDecimal totalSpent) {
    }

    public record Vehicle(
            UUID id,
            UUID userId,
            String ownerEmail,
            String vehicleType,
            String make,
            String model,
            String registrationNumber,
            String fuelType,
            BigDecimal currentOdometer,
            LocalDate purchaseDate,
            OffsetDateTime createdAt) {
    }

    /** One money entry. Fuel details are filled in when the expense came from the Fuel Tracker. */
    public record Expense(
            UUID id,
            UUID userId,
            String ownerEmail,
            UUID vehicleId,
            String vehicleName,
            LocalDate expenseDate,
            String description,
            BigDecimal amount,
            String category,
            String source,
            BigDecimal pricePerLitre,
            BigDecimal litres,
            BigDecimal odometerReading,
            String notes,
            OffsetDateTime createdAt) {
    }

    public record FuelLog(
            UUID id,
            UUID userId,
            String ownerEmail,
            UUID vehicleId,
            String vehicleName,
            LocalDate fuelDate,
            String description,
            BigDecimal amountPaid,
            BigDecimal pricePerLitre,
            BigDecimal litres,
            BigDecimal odometerReading,
            boolean fullTank) {
    }

    public record MaintenanceRecord(
            UUID id,
            UUID userId,
            String ownerEmail,
            UUID vehicleId,
            String vehicleName,
            LocalDate serviceDate,
            String description,
            String serviceCentre,
            BigDecimal cost,
            BigDecimal odometerReading,
            LocalDate nextServiceDate,
            BigDecimal nextServiceOdometer) {
    }

    public record InsuranceRecord(
            UUID id,
            UUID userId,
            String ownerEmail,
            UUID vehicleId,
            String vehicleName,
            String provider,
            LocalDate policyStartDate,
            LocalDate expiryDate,
            BigDecimal premiumAmount) {
    }

    /** Whole-database totals for the admin dashboard. */
    public record Stats(
            long users,
            long vehicles,
            long expenses,
            long fuelLogs,
            BigDecimal totalSpent,
            BigDecimal petrolSpent,
            BigDecimal litres,
            Map<String, BigDecimal> spentByCategory) {
    }

    /** Request body for POST /api/expenses. Validated before it reaches the database. */
    public record NewExpenseRequest(
            @NotNull UUID userId,
            @NotNull UUID vehicleId,
            @NotNull @PastOrPresent LocalDate expenseDate,
            @NotBlank @Size(max = 120) String description,
            @NotNull @DecimalMin(value = "0.01") @DecimalMax(value = "10000000") BigDecimal amount,
            @NotBlank String category,
            @Size(max = 1000) String notes) {
    }
}
