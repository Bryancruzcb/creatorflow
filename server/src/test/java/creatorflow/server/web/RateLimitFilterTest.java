package creatorflow.server.web;

import static org.junit.jupiter.api.Assertions.assertEquals;

import jakarta.servlet.ServletException;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RateLimitFilterTest {

    @Test
    void spoofedForwardedHeaderCannotDodgeTheThrottle() throws ServletException, IOException {
        // Capacity 1 and a negligible refill rate: the second request from the same
        // address must be throttled no matter what headers it carries.
        RateLimitFilter filter = new RateLimitFilter(1, 1e-9);

        assertEquals(200, apiRequest(filter, "10.0.0.9", "1.1.1.1"));
        assertEquals(429, apiRequest(filter, "10.0.0.9", "2.2.2.2"),
                "a fresh X-Forwarded-For value from the same address must not earn a fresh bucket");
    }

    @Test
    void distinctAddressesKeepIndependentBuckets() throws ServletException, IOException {
        RateLimitFilter filter = new RateLimitFilter(1, 1e-9);

        assertEquals(200, apiRequest(filter, "10.0.0.1", null));
        assertEquals(429, apiRequest(filter, "10.0.0.1", null));
        assertEquals(200, apiRequest(filter, "10.0.0.2", null), "a different address has its own bucket");
    }

    private static int apiRequest(RateLimitFilter filter, String remoteAddr, String forwardedFor)
            throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/registry");
        request.setRemoteAddr(remoteAddr);
        if (forwardedFor != null) {
            request.addHeader("X-Forwarded-For", forwardedFor);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response.getStatus();
    }
}
