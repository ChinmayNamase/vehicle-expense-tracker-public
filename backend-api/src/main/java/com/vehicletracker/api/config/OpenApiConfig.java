package com.vehicletracker.api.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Title and login scheme shown in Swagger UI (/swagger-ui.html). */
@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI vehicleTrackerOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("Vehicle Expense Tracker API")
                        .version("1.0.0")
                        .description("Admin REST API: users (logins), vehicles, expenses, fuel logs, maintenance, insurance and totals."))
                .components(new Components().addSecuritySchemes("adminLogin",
                        new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("basic")))
                .addSecurityItem(new SecurityRequirement().addList("adminLogin"));
    }
}
