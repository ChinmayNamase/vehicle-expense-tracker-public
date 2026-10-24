package com.vehicletracker.api.exception;

import org.springframework.http.HttpStatus;

/**
 * An error the website should show to the user.
 * "code" follows the same codes the frontend already understands
 * (e.g. 23505 duplicate, 23503 vehicle not found, 23514 invalid value, P0001 rule violated).
 */
public class AppException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public AppException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
