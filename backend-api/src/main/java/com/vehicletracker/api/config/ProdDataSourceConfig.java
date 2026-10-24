package com.vehicletracker.api.config;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

import javax.sql.DataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * Production database connection (profile "prod").
 * Accepts the connection string exactly as Neon/Render show it:
 *   postgresql://user:password@host/dbname?sslmode=require
 * and turns it into a JDBC connection, so nothing has to be reformatted by hand.
 */
@Configuration
@Profile("prod")
public class ProdDataSourceConfig {

    @Bean
    DataSource dataSource(@Value("${DATABASE_URL}") String databaseUrl, @Value("${DB_POOL_SIZE:5}") int poolSize) {
        URI uri = URI.create(databaseUrl.trim().replaceFirst("^jdbc:", ""));
        String[] credentials = uri.getRawUserInfo() == null ? new String[0] : uri.getRawUserInfo().split(":", 2);
        String query = uri.getQuery() == null ? "" : uri.getQuery();
        // "channel_binding" is a libpq option the Java driver doesn't use; drop it.
        query = query.replaceAll("(^|&)channel_binding=[^&]*", "").replaceFirst("^&", "");
        // Connection poolers (e.g. Neon "-pooler" hosts) work best without server-side prepared statements.
        if (uri.getHost() != null && uri.getHost().contains("-pooler")) {
            query = (query.isEmpty() ? "" : query + "&") + "prepareThreshold=0";
        }
        if (!query.contains("sslmode=")) {
            query = (query.isEmpty() ? "" : query + "&") + "sslmode=require";
        }
        // stringtype=unspecified lets PostgreSQL convert "2026-10-01" text into DATE columns, etc.
        query += "&stringtype=unspecified";
        String port = uri.getPort() > 0 ? ":" + uri.getPort() : "";

        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:postgresql://" + uri.getHost() + port + uri.getRawPath() + "?" + query);
        if (credentials.length > 0) dataSource.setUsername(URLDecoder.decode(credentials[0], StandardCharsets.UTF_8));
        if (credentials.length > 1) dataSource.setPassword(URLDecoder.decode(credentials[1], StandardCharsets.UTF_8));
        dataSource.setMaximumPoolSize(poolSize);
        return dataSource;
    }
}
