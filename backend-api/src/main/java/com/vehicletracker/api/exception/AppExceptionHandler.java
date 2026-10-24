package com.vehicletracker.api.exception;

import com.vehicletracker.api.controller.AppDataController;
import com.vehicletracker.api.controller.AuthController;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.sql.SQLException;
import java.util.Map;

/**
 * Errors for the website API, as {"code": ..., "message": ...} JSON.
 * Database rule violations are translated to the codes the frontend already understands.
 */
@RestControllerAdvice(assignableTypes = {AppDataController.class, AuthController.class})
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AppExceptionHandler {

    @ExceptionHandler(AppException.class)
    ResponseEntity<Map<String, String>> app(AppException e) {
        return ResponseEntity.status(e.getStatus()).body(Map.of("code", e.getCode(), "message", e.getMessage()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<Map<String, String>> integrity(DataIntegrityViolationException e) {
        Throwable cause = NestedExceptionUtils.getMostSpecificCause(e);
        String state = cause instanceof SQLException sql && sql.getSQLState() != null ? sql.getSQLState() : "";
        String code;
        String message;
        switch (state) {
            case "23505" -> { code = "23505"; message = "A record with these details already exists."; }
            case "23503", "23506" -> { code = "23503"; message = "The selected vehicle was not found in your account."; }
            case "23502" -> { code = "23514"; message = "A required value is missing."; }
            default -> { code = "23514"; message = "Some values are not allowed. Please check the amounts, dates and readings."; }
        }
        return ResponseEntity.badRequest().body(Map.of("code", code, "message", message));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class, IllegalArgumentException.class})
    ResponseEntity<Map<String, String>> badInput(Exception e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("code", "22P02", "message", "Invalid input."));
    }
}
