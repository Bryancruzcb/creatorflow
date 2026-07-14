package creatorflow.server.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Per-client request throttling for the dynamic endpoints — the API and the upload pipeline —
 * so one client cannot flood the server and degrade it for everyone. Static assets and pages are
 * left unthrottled (they are cheap and a normal page load fetches many of them). Limits are
 * generous by default and tunable via {@code creatorflow.ratelimit.*}.
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimiter limiter;
    private final AtomicInteger sincePrune = new AtomicInteger();

    public RateLimitFilter(@Value("${creatorflow.ratelimit.capacity:120}") int capacity,
                           @Value("${creatorflow.ratelimit.per-second:2.0}") double perSecond) {
        this.limiter = new RateLimiter(capacity, perSecond);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        boolean throttled = path.startsWith("/api/")
                || ("/upload".equals(path) && "POST".equalsIgnoreCase(request.getMethod()));
        return !throttled;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (sincePrune.incrementAndGet() % 512 == 0) {
            limiter.pruneStale();
        }
        if (!limiter.tryAcquire(clientKey(request))) {
            response.setStatus(429);
            response.setContentType("application/json");
            response.setHeader("Retry-After", "1");
            response.getWriter().write("{\"error\":\"Too many requests. Please slow down.\"}");
            return;
        }
        chain.doFilter(request, response);
    }

    private static String clientKey(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].strip();
        }
        return request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
    }
}
