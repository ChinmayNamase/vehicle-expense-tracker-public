package com.vehicletracker.api.app;

import com.vehicletracker.api.exception.AppException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.temporal.Temporal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Business logic for the website's data. Every method works ONLY on the
 * logged-in user's rows (user_id = the session's user), which replaces the
 * Row Level Security that Supabase provided.
 *
 * It also replaces the Supabase database triggers:
 *  - a fuel log / service record / insurance policy creates and updates ONE
 *    linked row in expenses (category Petrol / Servicing / Insurance),
 *  - linked expenses cannot be edited directly,
 *  - a higher odometer reading updates the vehicle's current odometer,
 *  - deleting a record deletes its linked expense (and vice versa, by FK cascade).
 */
@Service
public class AppDataService {

    /** Which columns the website may write for each table (whitelist, prevents SQL injection via names). */
    private record TableSpec(String name, Set<String> columns, String linkedCategory, String linkedSource, boolean bumpsOdometer) {
        boolean isLinkedModule() {
            return linkedSource != null;
        }
    }

    private static final Map<String, TableSpec> TABLES = Map.of(
            "vehicles", new TableSpec("vehicles", Set.of("vehicle_type", "make", "model", "registration_number",
                    "chassis_number", "engine_number", "manufacturing_month_year", "registration_date",
                    "registration_valid_until", "purchase_date", "purchase_price", "current_odometer", "fuel_type",
                    "tank_capacity", "notes"), null, null, false),
            "expenses", new TableSpec("expenses", Set.of("vehicle_id", "expense_date", "description", "amount",
                    "category", "notes", "receipt_url"), null, null, false),
            "fuel_logs", new TableSpec("fuel_logs", Set.of("vehicle_id", "fuel_date", "description", "fuel_station",
                    "amount_paid", "price_per_litre", "litres", "litres_is_manual", "odometer_reading", "is_full_tank",
                    "notes"), "Petrol", "fuel", true),
            "maintenance_records", new TableSpec("maintenance_records", Set.of("vehicle_id", "service_date",
                    "description", "service_centre", "cost", "odometer_reading", "next_service_date",
                    "next_service_odometer", "notes"), "Servicing", "maintenance", true),
            "insurance_records", new TableSpec("insurance_records", Set.of("vehicle_id", "provider", "policy_number",
                    "policy_start_date", "expiry_date", "premium_amount", "notes"), "Insurance", "insurance", false));

    private final NamedParameterJdbcTemplate jdbc;

    public AppDataService(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------ read

    public List<Map<String, Object>> list(UUID userId, String table) {
        TableSpec spec = spec(table);
        var params = new MapSqlParameterSource("uid", userId);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select * from public." + spec.name() + " where user_id = :uid order by created_at desc", params)
                .stream().map(AppDataService::toJson).collect(Collectors.toList());

        if (spec.name().equals("expenses")) {
            // Attach fuel details to Petrol expenses (like Supabase's embedded "fuel_logs(...)").
            Map<String, List<Map<String, Object>>> fuelByExpense = jdbc.queryForList("""
                    select id, expense_id, price_per_litre, litres, odometer_reading, is_full_tank, litres_is_manual, fuel_station
                    from public.fuel_logs where user_id = :uid and expense_id is not null
                    """, params).stream().map(AppDataService::toJson)
                    .collect(Collectors.groupingBy(r -> String.valueOf(r.get("expense_id"))));
            rows.forEach(r -> r.put("fuel_logs", fuelByExpense.getOrDefault(String.valueOf(r.get("id")), List.of())));
        }
        return rows;
    }

    // ------------------------------------------------------------------ create

    @Transactional
    public List<Map<String, Object>> insert(UUID userId, String table, List<Map<String, Object>> rows) {
        TableSpec spec = spec(table);
        List<Map<String, Object>> saved = new ArrayList<>();
        for (Map<String, Object> input : rows) {
            Map<String, Object> values = allowedValues(spec, input);
            if (spec.name().equals("vehicles")) {
                checkUniqueRegistration(userId, values.get("registration_number"), null);
            }
            if (spec.name().equals("expenses")) {
                values.put("source", "manual"); // only the module records below may create linked expenses
            }
            UUID id = UUID.randomUUID();
            values.put("id", id);
            values.put("user_id", userId);
            String columns = String.join(", ", values.keySet());
            String placeholders = values.keySet().stream().map(c -> ":" + c).collect(Collectors.joining(", "));
            jdbc.update("insert into public." + spec.name() + " (" + columns + ") values (" + placeholders + ")",
                    new MapSqlParameterSource(values));
            afterWrite(spec, userId, id);
            saved.add(find(spec, userId, id));
        }
        return saved;
    }

    // ------------------------------------------------------------------ update

    @Transactional
    public Map<String, Object> update(UUID userId, String table, UUID id, Map<String, Object> input) {
        TableSpec spec = spec(table);
        Map<String, Object> existing = find(spec, userId, id);
        if (spec.name().equals("expenses") && !"manual".equals(existing.get("source"))) {
            throw new AppException(HttpStatus.BAD_REQUEST, "P0001",
                    "This expense is linked to a " + existing.get("source") + " record. Edit it from that module.");
        }
        Map<String, Object> values = allowedValues(spec, input);
        if (spec.name().equals("vehicles") && values.containsKey("registration_number")) {
            checkUniqueRegistration(userId, values.get("registration_number"), id);
        }
        if (!values.isEmpty()) {
            String assignments = values.keySet().stream().map(c -> c + " = :" + c).collect(Collectors.joining(", "));
            var params = new MapSqlParameterSource(values).addValue("id", id).addValue("uid", userId);
            jdbc.update("update public." + spec.name() + " set " + assignments
                    + ", updated_at = current_timestamp where id = :id and user_id = :uid", params);
        }
        afterWrite(spec, userId, id);
        return find(spec, userId, id);
    }

    // ------------------------------------------------------------------ delete

    @Transactional
    public void delete(UUID userId, String table, UUID id) {
        TableSpec spec = spec(table);
        Map<String, Object> existing = find(spec, userId, id);
        var params = new MapSqlParameterSource("id", id).addValue("uid", userId);
        if (spec.isLinkedModule() && existing.get("expense_id") != null) {
            // Deleting the linked expense also deletes this record (ON DELETE CASCADE).
            jdbc.update("delete from public.expenses where id = :eid and user_id = :uid",
                    new MapSqlParameterSource("eid", UUID.fromString(existing.get("expense_id").toString())).addValue("uid", userId));
        }
        jdbc.update("delete from public." + spec.name() + " where id = :id and user_id = :uid", params);
    }

    // ------------------------------------------------------------------ business rules (replace the DB triggers)

    private void afterWrite(TableSpec spec, UUID userId, UUID id) {
        if (!spec.isLinkedModule()) {
            return;
        }
        Map<String, Object> row = find(spec, userId, id);
        syncLinkedExpense(spec, userId, row);
        if (spec.bumpsOdometer() && row.get("odometer_reading") != null) {
            jdbc.update("""
                    update public.vehicles set current_odometer = :odo, updated_at = current_timestamp
                    where id = :vid and user_id = :uid and current_odometer < :odo
                    """, new MapSqlParameterSource("odo", new BigDecimal(row.get("odometer_reading").toString()))
                    .addValue("vid", UUID.fromString(row.get("vehicle_id").toString()))
                    .addValue("uid", userId));
        }
    }

    /** Creates or updates the ONE expense row that represents this fuel log / service / policy. */
    private void syncLinkedExpense(TableSpec spec, UUID userId, Map<String, Object> row) {
        Object date;
        String description;
        Object amount;
        switch (spec.linkedSource()) {
            case "fuel" -> {
                date = row.get("fuel_date");
                description = row.get("description") == null ? "Petrol" : row.get("description").toString();
                amount = row.get("amount_paid");
            }
            case "maintenance" -> {
                date = row.get("service_date");
                description = row.get("description") + (row.get("service_centre") == null ? "" : " (" + row.get("service_centre") + ")");
                amount = row.get("cost");
            }
            default -> {
                date = row.get("policy_start_date");
                description = "Insurance premium - " + row.get("provider");
                amount = row.get("premium_amount");
            }
        }
        if (description.length() > 120) {
            description = description.substring(0, 120);
        }
        var params = new MapSqlParameterSource("uid", userId)
                .addValue("vid", UUID.fromString(row.get("vehicle_id").toString()))
                .addValue("date", date)
                .addValue("description", description)
                .addValue("amount", amount)
                .addValue("notes", row.get("notes"));

        if (row.get("expense_id") == null) {
            UUID expenseId = UUID.randomUUID();
            jdbc.update("""
                    insert into public.expenses (id, user_id, vehicle_id, expense_date, description, amount, category, source, notes)
                    values (:eid, :uid, :vid, :date, :description, :amount, :category, :source, :notes)
                    """, params.addValue("eid", expenseId).addValue("category", spec.linkedCategory()).addValue("source", spec.linkedSource()));
            jdbc.update("update public." + spec.name() + " set expense_id = :eid where id = :id",
                    new MapSqlParameterSource("eid", expenseId).addValue("id", UUID.fromString(row.get("id").toString())));
        } else {
            jdbc.update("""
                    update public.expenses set vehicle_id = :vid, expense_date = :date, description = :description,
                           amount = :amount, notes = :notes, updated_at = current_timestamp
                    where id = :eid and user_id = :uid
                    """, params.addValue("eid", UUID.fromString(row.get("expense_id").toString())));
        }
    }

    private void checkUniqueRegistration(UUID userId, Object registration, UUID exceptId) {
        if (registration == null) {
            return;
        }
        String sql = "select count(*) from public.vehicles where user_id = :uid and upper(registration_number) = upper(:reg)"
                + (exceptId == null ? "" : " and id <> :except");
        Integer count = jdbc.queryForObject(sql,
                new MapSqlParameterSource("uid", userId).addValue("reg", registration.toString()).addValue("except", exceptId),
                Integer.class);
        if (count != null && count > 0) {
            throw new AppException(HttpStatus.CONFLICT, "23505", "A vehicle with this registration number already exists.");
        }
    }

    // ------------------------------------------------------------------ helpers

    private Map<String, Object> find(TableSpec spec, UUID userId, UUID id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select * from public." + spec.name() + " where id = :id and user_id = :uid",
                new MapSqlParameterSource("id", id).addValue("uid", userId));
        if (rows.isEmpty()) {
            throw new AppException(HttpStatus.NOT_FOUND, "PGRST116", "Record not found in your account.");
        }
        return toJson(rows.get(0));
    }

    private static TableSpec spec(String table) {
        TableSpec spec = TABLES.get(table);
        if (spec == null) {
            throw new AppException(HttpStatus.NOT_FOUND, "42P01", "Unknown table: " + table);
        }
        return spec;
    }

    /** Keeps only whitelisted columns; converts vehicle_id to a UUID. */
    private static Map<String, Object> allowedValues(TableSpec spec, Map<String, Object> input) {
        Map<String, Object> values = new LinkedHashMap<>();
        input.forEach((column, value) -> {
            if (spec.columns().contains(column)) {
                if (column.equals("vehicle_id") && value != null) {
                    try {
                        value = UUID.fromString(value.toString());
                    } catch (IllegalArgumentException e) {
                        throw new AppException(HttpStatus.BAD_REQUEST, "23503", "The selected vehicle was not found in your account.");
                    }
                }
                values.put(column, value);
            }
        });
        return values;
    }

    /** Converts database values to JSON-friendly ones (dates as "YYYY-MM-DD", ids as text). */
    private static Map<String, Object> toJson(Map<String, Object> row) {
        Map<String, Object> json = new LinkedHashMap<>();
        row.forEach((key, value) -> {
            if (value instanceof java.sql.Date date) {
                value = date.toLocalDate().toString();
            } else if (value instanceof Timestamp timestamp) {
                value = timestamp.toInstant().toString();
            } else if (value instanceof Temporal || value instanceof UUID) {
                value = value.toString();
            }
            json.put(key.toLowerCase(), value);
        });
        return json;
    }
}
