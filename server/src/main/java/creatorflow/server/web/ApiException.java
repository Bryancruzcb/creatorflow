package creatorflow.server.web;

import org.springframework.http.HttpStatus;

/** Request-level failure with an HTTP status; rendered as {"error": message}. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;

    public ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus status() {
        return status;
    }
}
