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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests: start the whole application with the H2 demo database
 * and call the REST API exactly like a browser would.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("demo")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class ApiIntegrationTest {

    private static final String ADMIN = "admin";
    private static final String PASSWORD = "admin12345";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Test
    void healthIsPublic() throws Exception {
        mvc.perform(get("/api/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void dataNeedsAdminLogin() throws Exception {
        mvc.perform(get("/api/users")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/users").with(httpBasic(ADMIN, "wrong-password"))).andExpect(status().isUnauthorized());
        mvc.perform(get("/admin.html")).andExpect(status().isUnauthorized());
    }

    @Test
    void listsUsersWithoutPasswords() throws Exception {
        String body = mvc.perform(get("/api/users").with(httpBasic(ADMIN, PASSWORD)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode users = json.readTree(body);
        assertThat(users.size()).isEqualTo(4);
        assertThat(body).doesNotContainIgnoringCase("password");
        assertThat(users.get(0).has("lastSignInAt")).isTrue();
    }

    @Test
    void filtersEntriesByUserAndCategory() throws Exception {
        JsonNode users = json.readTree(mvc.perform(get("/api/users").with(httpBasic(ADMIN, PASSWORD)))
                .andReturn().getResponse().getContentAsString());
        String riderOne = null;
        for (JsonNode u : users) {
            if (u.get("email").asText().equals("rider.one@example.com")) riderOne = u.get("id").asText();
        }
        JsonNode petrol = json.readTree(mvc.perform(get("/api/expenses")
                        .param("userId", riderOne).param("category", "Petrol").with(httpBasic(ADMIN, PASSWORD)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(petrol.size()).isGreaterThan(0);
        for (JsonNode e : petrol) {
            assertThat(e.get("ownerEmail").asText()).isEqualTo("rider.one@example.com");
            assertThat(e.get("category").asText()).isEqualTo("Petrol");
            assertThat(e.get("litres").isNull()).isFalse(); // fuel details joined in
        }
    }

    @Test
    void statsAddUp() throws Exception {
        mvc.perform(get("/api/stats").with(httpBasic(ADMIN, PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users").value(4))
                .andExpect(jsonPath("$.vehicles").value(3));
    }

    @Test
    void addAndDeleteExpense() throws Exception {
        JsonNode vehicle = json.readTree(mvc.perform(get("/api/vehicles").with(httpBasic(ADMIN, PASSWORD)))
                .andReturn().getResponse().getContentAsString()).get(0);
        String request = """
                {"userId":"%s","vehicleId":"%s","expenseDate":"2026-10-01","description":"Chain lubrication",
                 "amount":150,"category":"Spare Parts"}
                """.formatted(vehicle.get("userId").asText(), vehicle.get("id").asText());
        String created = mvc.perform(post("/api/expenses").with(httpBasic(ADMIN, PASSWORD))
                        .contentType(MediaType.APPLICATION_JSON).content(request))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.description").value("Chain lubrication"))
                .andReturn().getResponse().getContentAsString();
        String id = json.readTree(created).get("id").asText();

        mvc.perform(delete("/api/expenses/" + id).with(httpBasic(ADMIN, PASSWORD))).andExpect(status().isNoContent());
        mvc.perform(get("/api/expenses/" + id).with(httpBasic(ADMIN, PASSWORD))).andExpect(status().isNotFound());
    }

    @Test
    void rejectsInvalidExpenses() throws Exception {
        JsonNode vehicle = json.readTree(mvc.perform(get("/api/vehicles").with(httpBasic(ADMIN, PASSWORD)))
                .andReturn().getResponse().getContentAsString()).get(0);
        String base = "{\"userId\":\"%s\",\"vehicleId\":\"%s\",\"expenseDate\":\"2026-10-01\",\"description\":\"x\",\"amount\":%s,\"category\":\"%s\"}";
        String user = vehicle.get("userId").asText();
        String veh = vehicle.get("id").asText();

        // negative amount -> validation error
        mvc.perform(post("/api/expenses").with(httpBasic(ADMIN, PASSWORD)).contentType(MediaType.APPLICATION_JSON)
                .content(base.formatted(user, veh, "-5", "Other"))).andExpect(status().isBadRequest());
        // Petrol must come from the Fuel Tracker
        mvc.perform(post("/api/expenses").with(httpBasic(ADMIN, PASSWORD)).contentType(MediaType.APPLICATION_JSON)
                .content(base.formatted(user, veh, "100", "Petrol"))).andExpect(status().isBadRequest());
        // vehicle that belongs to a different user -> rejected by the database's ownership foreign key
        String otherUser = "00000000-0000-4000-8000-000000000000";
        mvc.perform(post("/api/expenses").with(httpBasic(ADMIN, PASSWORD)).contentType(MediaType.APPLICATION_JSON)
                .content(base.formatted(otherUser, veh, "100", "Other"))).andExpect(status().isBadRequest());
    }
}
