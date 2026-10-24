package com.vehicletracker.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Entry point of the Vehicle Expense Tracker admin API.
 *
 * The website (HTML/CSS/JS) stores its data in a PostgreSQL database.
 * This Spring Boot application connects to that same database and exposes:
 *   - a REST API under /api/**            (JSON)
 *   - an Admin dashboard at /admin.html    (all users, logins and entries)
 *   - API documentation at /swagger-ui.html
 *
 * Profiles:
 *   demo     (default) in-memory H2 database with sample data, no setup needed
 *   supabase connects to the real Supabase PostgreSQL database
 */
@SpringBootApplication
public class VehicleTrackerApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(VehicleTrackerApiApplication.class, args);
    }
}
