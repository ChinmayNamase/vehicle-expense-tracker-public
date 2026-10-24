package com.vehicletracker.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Tests the website's OWN API: sign-up, login, per-user data, and the business
 * rules that replace the Supabase triggers and Row Level Security.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class WebsiteApiTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    private String register(String email) throws Exception {
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"Secret123\",\"fullName\":\"Test User\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(body).at("/session/access_token").asText();
    }

    private ResultActions call(String method, String path, String token, String body) throws Exception {
        var request = switch (method) {
            case "POST" -> post(path);
            case "PATCH" -> patch(path);
            case "DELETE" -> delete(path);
            default -> get(path);
        };
        request.header("Authorization", "Bearer " + token);
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(body);
        return mvc.perform(request);
    }

    private JsonNode read(ResultActions result) throws Exception {
        return json.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private String addBike(String token, String reg) throws Exception {
        return read(call("POST", "/api/app/vehicles", token,
                "{\"vehicle_type\":\"Bike\",\"make\":\"Honda\",\"model\":\"Activa\",\"registration_number\":\"" + reg + "\",\"current_odometer\":185}")
                .andExpect(status().isCreated())).get(0).get("id").asText();
    }

    @Test
    void websiteIsServedAndUsesOwnApi() throws Exception {
        mvc.perform(get("/index.html")).andExpect(status().isOk());
        mvc.perform(get("/js/config.js")).andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("API_CONFIG")));
    }

    @Test
    void registerLoginAndRejectBadPasswords() throws Exception {
        register("chinmay@example.com");
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"chinmay@example.com\",\"password\":\"Secret123\"}"))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"weak@example.com\",\"password\":\"short\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"chinmay@example.com\",\"password\":\"WrongPass1\"}"))
                .andExpect(status().isBadRequest());
        String body = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"CHINMAY@example.com\",\"password\":\"Secret123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(body).at("/session/access_token").asText()).hasSizeGreaterThan(20);
        assertThat(body).doesNotContain("Secret123").doesNotContain("password_hash");
    }

    @Test
    void dataNeedsLoginWithoutBrowserPopup() throws Exception {
        mvc.perform(get("/api/app/vehicles"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("WWW-Authenticate"));
        call("GET", "/api/app/vehicles", "not-a-real-token", null).andExpect(status().isUnauthorized());
    }

    @Test
    void fuelEntryCreatesLinkedExpenseAndUpdatesOdometer() throws Exception {
        String token = register("rider@example.com");
        String bike = addBike(token, "MH12AB1234");
        JsonNode fuel = read(call("POST", "/api/app/fuel_logs", token,
                "{\"vehicle_id\":\"" + bike + "\",\"fuel_date\":\"2026-10-01\",\"description\":\"Petrol HPCL\","
                        + "\"amount_paid\":658,\"price_per_litre\":104,\"litres\":6.327,\"odometer_reading\":348.2,\"is_full_tank\":true}")
                .andExpect(status().isCreated())).get(0);
        assertThat(fuel.get("expense_id").isNull()).isFalse();

        JsonNode expenses = read(call("GET", "/api/app/expenses", token, null).andExpect(status().isOk()));
        assertThat(expenses.size()).isEqualTo(1);
        assertThat(expenses.get(0).get("category").asText()).isEqualTo("Petrol");
        assertThat(expenses.get(0).get("source").asText()).isEqualTo("fuel");
        assertThat(expenses.get(0).get("amount").decimalValue()).isEqualByComparingTo("658");
        assertThat(expenses.get(0).get("fuel_logs").get(0).get("litres").decimalValue()).isEqualByComparingTo("6.327");

        JsonNode vehicles = read(call("GET", "/api/app/vehicles", token, null));
        assertThat(vehicles.get(0).get("current_odometer").decimalValue()).isEqualByComparingTo("348.2");

        // linked expense cannot be edited directly
        call("PATCH", "/api/app/expenses/" + expenses.get(0).get("id").asText(), token, "{\"amount\":1}")
                .andExpect(status().isBadRequest());
        // editing the fuel entry updates its expense
        call("PATCH", "/api/app/fuel_logs/" + fuel.get("id").asText(), token, "{\"amount_paid\":700}").andExpect(status().isOk());
        assertThat(read(call("GET", "/api/app/expenses", token, null)).get(0).get("amount").decimalValue()).isEqualByComparingTo("700");
        // deleting the fuel entry deletes its expense
        call("DELETE", "/api/app/fuel_logs/" + fuel.get("id").asText(), token, null).andExpect(status().isNoContent());
        assertThat(read(call("GET", "/api/app/expenses", token, null)).size()).isZero();
    }

    @Test
    void rulesAndValidation() throws Exception {
        String token = register("rules@example.com");
        String bike = addBike(token, "MH14XY9999");
        // duplicate registration (case-insensitive)
        call("POST", "/api/app/vehicles", token,
                "{\"vehicle_type\":\"Bike\",\"make\":\"X\",\"model\":\"Y\",\"registration_number\":\"mh14xy9999\"}")
                .andExpect(status().isConflict());
        // Petrol must come from the Fuel Tracker
        call("POST", "/api/app/expenses", token, "{\"vehicle_id\":\"" + bike
                + "\",\"expense_date\":\"2026-10-01\",\"description\":\"x\",\"amount\":10,\"category\":\"Petrol\"}")
                .andExpect(status().isBadRequest());
        // negative amount
        call("POST", "/api/app/expenses", token, "{\"vehicle_id\":\"" + bike
                + "\",\"expense_date\":\"2026-10-01\",\"description\":\"x\",\"amount\":-5,\"category\":\"Other\"}")
                .andExpect(status().isBadRequest());
        // service record creates a Servicing expense
        call("POST", "/api/app/maintenance_records", token, "{\"vehicle_id\":\"" + bike
                + "\",\"service_date\":\"2026-09-01\",\"description\":\"General service\",\"service_centre\":\"Honda Care\",\"cost\":1250}")
                .andExpect(status().isCreated());
        JsonNode expenses = read(call("GET", "/api/app/expenses", token, null));
        assertThat(expenses.get(0).get("category").asText()).isEqualTo("Servicing");
        assertThat(expenses.get(0).get("description").asText()).isEqualTo("General service (Honda Care)");
        // deleting the vehicle deletes everything of it
        call("DELETE", "/api/app/vehicles/" + bike, token, null).andExpect(status().isNoContent());
        assertThat(read(call("GET", "/api/app/expenses", token, null)).size()).isZero();
        assertThat(read(call("GET", "/api/app/maintenance_records", token, null)).size()).isZero();
    }

    @Test
    void usersCannotSeeOrUseEachOthersData() throws Exception {
        String alice = register("alice@example.com");
        String bob = register("bob@example.com");
        String aliceBike = addBike(alice, "MH01AA0001");

        assertThat(read(call("GET", "/api/app/vehicles", bob, null)).size()).isZero();
        call("PATCH", "/api/app/vehicles/" + aliceBike, bob, "{\"make\":\"hacked\"}").andExpect(status().isNotFound());
        call("DELETE", "/api/app/vehicles/" + aliceBike, bob, null).andExpect(status().isNotFound());
        // Bob cannot attach an expense to Alice's vehicle
        call("POST", "/api/app/expenses", bob, "{\"vehicle_id\":\"" + aliceBike
                + "\",\"expense_date\":\"2026-10-01\",\"description\":\"x\",\"amount\":10,\"category\":\"Other\"}")
                .andExpect(status().isBadRequest());
        // Alice's data is unchanged
        assertThat(read(call("GET", "/api/app/vehicles", alice, null)).get(0).get("make").asText()).isEqualTo("Honda");
    }

    @Test
    void logoutEndsTheSession() throws Exception {
        String token = register("logout@example.com");
        call("GET", "/api/app/vehicles", token, null).andExpect(status().isOk());
        call("POST", "/api/auth/logout", token, null).andExpect(status().isNoContent());
        call("GET", "/api/app/vehicles", token, null).andExpect(status().isUnauthorized());
    }
}
