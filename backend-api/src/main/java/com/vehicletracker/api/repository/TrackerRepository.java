package com.vehicletracker.api.repository;

import com.vehicletracker.api.model.ApiModels.Expense;
import com.vehicletracker.api.model.ApiModels.FuelLog;
import com.vehicletracker.api.model.ApiModels.InsuranceRecord;
import com.vehicletracker.api.model.ApiModels.MaintenanceRecord;
import com.vehicletracker.api.model.ApiModels.NewExpenseRequest;
import com.vehicletracker.api.model.ApiModels.Stats;
import com.vehicletracker.api.model.ApiModels.UserSummary;
import com.vehicletracker.api.model.ApiModels.Vehicle;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Data access layer: every SQL query used by the API lives here.
 *
 * It uses Spring's JdbcTemplate with "?" placeholders, so user input is always
 * sent as a parameter and can never change the SQL (no SQL injection).
 *
 * The same SQL runs on PostgreSQL (Supabase) and on the H2 demo database.
 * Logins come from the auth.users table, which is managed by Supabase Auth.
 */
@Repository
public class TrackerRepository {

    private static final String VEHICLE_NAME = "(v.make || ' ' || v.model)";

    private final JdbcTemplate jdbc;
    /** SQL expression for the user's display name (differs between Supabase and H2). */
    private final String userNameExpression;

    public TrackerRepository(JdbcTemplate jdbc, @Value("${app.sql.user-name-expression}") String userNameExpression) {
        this.jdbc = jdbc;
        this.userNameExpression = userNameExpression;
    }

    // ------------------------------------------------------------------ users (logins)

    public List<UserSummary> findUsers() {
        String sql = """
                select u.id, u.email, %s as full_name, u.created_at, u.last_sign_in_at,
                       (select count(*) from public.vehicles v where v.user_id = u.id) as vehicle_count,
                       (select count(*) from public.expenses e where e.user_id = u.id) as entry_count,
                       (select coalesce(sum(e.amount), 0) from public.expenses e where e.user_id = u.id) as total_spent
                from auth.users u
                order by u.created_at desc
                """.formatted(userNameExpression);
        return jdbc.query(sql, (rs, i) -> mapUser(rs));
    }

    public Optional<UserSummary> findUser(UUID id) {
        return findUsers().stream().filter(u -> u.id().equals(id)).findFirst();
    }

    private UserSummary mapUser(ResultSet rs) throws SQLException {
        return new UserSummary(
                rs.getObject("id", UUID.class),
                rs.getString("email"),
                rs.getString("full_name"),
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getObject("last_sign_in_at", OffsetDateTime.class),
                rs.getLong("vehicle_count"),
                rs.getLong("entry_count"),
                rs.getBigDecimal("total_spent"));
    }

    // ------------------------------------------------------------------ vehicles

    public List<Vehicle> findVehicles(UUID userId) {
        Where where = new Where().eq("v.user_id", userId);
        String sql = """
                select v.id, v.user_id, u.email, v.vehicle_type, v.make, v.model, v.registration_number,
                       v.fuel_type, v.current_odometer, v.purchase_date, v.created_at
                from public.vehicles v
                join auth.users u on u.id = v.user_id
                %s
                order by v.created_at desc
                """.formatted(where.sql());
        return jdbc.query(sql, (rs, i) -> new Vehicle(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("email"),
                rs.getString("vehicle_type"),
                rs.getString("make"),
                rs.getString("model"),
                rs.getString("registration_number"),
                rs.getString("fuel_type"),
                rs.getBigDecimal("current_odometer"),
                rs.getObject("purchase_date", LocalDate.class),
                rs.getObject("created_at", OffsetDateTime.class)), where.args());
    }

    // ------------------------------------------------------------------ expenses

    public List<Expense> findExpenses(UUID userId, UUID vehicleId, String category,
                                      LocalDate from, LocalDate to, int limit) {
        Where where = new Where()
                .eq("e.user_id", userId)
                .eq("e.vehicle_id", vehicleId)
                .eq("e.category", category)
                .gte("e.expense_date", from)
                .lte("e.expense_date", to);
        String sql = """
                select e.id, e.user_id, u.email, e.vehicle_id, %s as vehicle_name, e.expense_date,
                       e.description, e.amount, e.category, e.source, e.notes, e.created_at,
                       f.price_per_litre, f.litres, f.odometer_reading
                from public.expenses e
                join public.vehicles v on v.id = e.vehicle_id
                join auth.users u on u.id = e.user_id
                left join public.fuel_logs f on f.expense_id = e.id
                %s
                order by e.expense_date desc, e.created_at desc
                limit %d
                """.formatted(VEHICLE_NAME, where.sql(), limit);
        return jdbc.query(sql, (rs, i) -> mapExpense(rs), where.args());
    }

    public Optional<Expense> findExpense(UUID id) {
        String sql = """
                select e.id, e.user_id, u.email, e.vehicle_id, %s as vehicle_name, e.expense_date,
                       e.description, e.amount, e.category, e.source, e.notes, e.created_at,
                       f.price_per_litre, f.litres, f.odometer_reading
                from public.expenses e
                join public.vehicles v on v.id = e.vehicle_id
                join auth.users u on u.id = e.user_id
                left join public.fuel_logs f on f.expense_id = e.id
                where e.id = ?
                """.formatted(VEHICLE_NAME);
        return jdbc.query(sql, (rs, i) -> mapExpense(rs), id).stream().findFirst();
    }

    private Expense mapExpense(ResultSet rs) throws SQLException {
        return new Expense(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("email"),
                rs.getObject("vehicle_id", UUID.class),
                rs.getString("vehicle_name"),
                rs.getObject("expense_date", LocalDate.class),
                rs.getString("description"),
                rs.getBigDecimal("amount"),
                rs.getString("category"),
                rs.getString("source"),
                rs.getBigDecimal("price_per_litre"),
                rs.getBigDecimal("litres"),
                rs.getBigDecimal("odometer_reading"),
                rs.getString("notes"),
                rs.getObject("created_at", OffsetDateTime.class));
    }

    /**
     * Adds a manual (non-fuel) expense. The database's composite foreign key
     * (vehicle_id, user_id) rejects the insert if the vehicle is not the user's.
     */
    public UUID insertExpense(NewExpenseRequest request) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into public.expenses (id, user_id, vehicle_id, expense_date, description, amount, category, source, notes)
                values (?, ?, ?, ?, ?, ?, ?, 'manual', ?)
                """,
                id, request.userId(), request.vehicleId(), request.expenseDate(),
                request.description().trim(), request.amount(), request.category(), request.notes());
        return id;
    }

    /** Returns true if a row was deleted. Linked fuel/service/insurance rows are removed by the database (ON DELETE CASCADE). */
    public boolean deleteExpense(UUID id) {
        return jdbc.update("delete from public.expenses where id = ?", id) > 0;
    }

    // ------------------------------------------------------------------ fuel, maintenance, insurance

    public List<FuelLog> findFuelLogs(UUID userId, UUID vehicleId, int limit) {
        Where where = new Where().eq("f.user_id", userId).eq("f.vehicle_id", vehicleId);
        String sql = """
                select f.id, f.user_id, u.email, f.vehicle_id, %s as vehicle_name, f.fuel_date, f.description,
                       f.amount_paid, f.price_per_litre, f.litres, f.odometer_reading, f.is_full_tank
                from public.fuel_logs f
                join public.vehicles v on v.id = f.vehicle_id
                join auth.users u on u.id = f.user_id
                %s
                order by f.fuel_date desc, f.odometer_reading desc
                limit %d
                """.formatted(VEHICLE_NAME, where.sql(), limit);
        return jdbc.query(sql, (rs, i) -> new FuelLog(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("email"),
                rs.getObject("vehicle_id", UUID.class),
                rs.getString("vehicle_name"),
                rs.getObject("fuel_date", LocalDate.class),
                rs.getString("description"),
                rs.getBigDecimal("amount_paid"),
                rs.getBigDecimal("price_per_litre"),
                rs.getBigDecimal("litres"),
                rs.getBigDecimal("odometer_reading"),
                rs.getBoolean("is_full_tank")), where.args());
    }

    public List<MaintenanceRecord> findMaintenance(UUID userId) {
        Where where = new Where().eq("m.user_id", userId);
        String sql = """
                select m.id, m.user_id, u.email, m.vehicle_id, %s as vehicle_name, m.service_date, m.description,
                       m.service_centre, m.cost, m.odometer_reading, m.next_service_date, m.next_service_odometer
                from public.maintenance_records m
                join public.vehicles v on v.id = m.vehicle_id
                join auth.users u on u.id = m.user_id
                %s
                order by m.service_date desc
                """.formatted(VEHICLE_NAME, where.sql());
        return jdbc.query(sql, (rs, i) -> new MaintenanceRecord(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("email"),
                rs.getObject("vehicle_id", UUID.class),
                rs.getString("vehicle_name"),
                rs.getObject("service_date", LocalDate.class),
                rs.getString("description"),
                rs.getString("service_centre"),
                rs.getBigDecimal("cost"),
                rs.getBigDecimal("odometer_reading"),
                rs.getObject("next_service_date", LocalDate.class),
                rs.getBigDecimal("next_service_odometer")), where.args());
    }

    public List<InsuranceRecord> findInsurance(UUID userId) {
        Where where = new Where().eq("i.user_id", userId);
        String sql = """
                select i.id, i.user_id, u.email, i.vehicle_id, %s as vehicle_name, i.provider,
                       i.policy_start_date, i.expiry_date, i.premium_amount
                from public.insurance_records i
                join public.vehicles v on v.id = i.vehicle_id
                join auth.users u on u.id = i.user_id
                %s
                order by i.expiry_date desc
                """.formatted(VEHICLE_NAME, where.sql());
        return jdbc.query(sql, (rs, i) -> new InsuranceRecord(
                rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class),
                rs.getString("email"),
                rs.getObject("vehicle_id", UUID.class),
                rs.getString("vehicle_name"),
                rs.getString("provider"),
                rs.getObject("policy_start_date", LocalDate.class),
                rs.getObject("expiry_date", LocalDate.class),
                rs.getBigDecimal("premium_amount")), where.args());
    }

    // ------------------------------------------------------------------ statistics

    public Stats stats() {
        Map<String, BigDecimal> byCategory = new LinkedHashMap<>();
        jdbc.query("""
                select category, coalesce(sum(amount), 0) as total
                from public.expenses group by category order by total desc
                """, rs -> {
            byCategory.put(rs.getString("category"), rs.getBigDecimal("total"));
        });
        return new Stats(
                count("select count(*) from auth.users"),
                count("select count(*) from public.vehicles"),
                count("select count(*) from public.expenses"),
                count("select count(*) from public.fuel_logs"),
                sum("select coalesce(sum(amount), 0) from public.expenses"),
                byCategory.getOrDefault("Petrol", BigDecimal.ZERO),
                sum("select coalesce(sum(litres), 0) from public.fuel_logs"),
                byCategory);
    }

    public boolean isDatabaseUp() {
        Integer one = jdbc.queryForObject("select 1", Integer.class);
        return one != null && one == 1;
    }

    private long count(String sql) {
        Long value = jdbc.queryForObject(sql, Long.class);
        return value == null ? 0 : value;
    }

    private BigDecimal sum(String sql) {
        BigDecimal value = jdbc.queryForObject(sql, BigDecimal.class);
        return value == null ? BigDecimal.ZERO : value;
    }

    // ------------------------------------------------------------------ helper

    /** Builds a WHERE clause from optional filters, keeping values as "?" parameters. */
    private static final class Where {
        private final List<String> conditions = new ArrayList<>();
        private final List<Object> args = new ArrayList<>();

        Where eq(String column, Object value) {
            return add(column + " = ?", value);
        }

        Where gte(String column, Object value) {
            return add(column + " >= ?", value);
        }

        Where lte(String column, Object value) {
            return add(column + " <= ?", value);
        }

        private Where add(String condition, Object value) {
            if (value != null && !(value instanceof String s && s.isBlank())) {
                conditions.add(condition);
                args.add(value);
            }
            return this;
        }

        String sql() {
            return conditions.isEmpty() ? "" : "where " + String.join(" and ", conditions);
        }

        Object[] args() {
            return args.toArray();
        }
    }
}
