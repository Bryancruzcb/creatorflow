package creatorflow.server.web;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.UserAccountRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Optional;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * API-key authentication: clients send {@code X-Api-Key}, issued at account
 * creation. Deliberately simple for this stage — the production path is
 * JWT/OAuth with rotating credentials.
 */
@Component
public class ApiKeyInterceptor implements HandlerInterceptor {

    public static final String ACCOUNT_ATTRIBUTE = "account";
    public static final String HEADER = "X-Api-Key";

    private final UserAccountRepository accounts;

    public ApiKeyInterceptor(UserAccountRepository accounts) {
        this.accounts = accounts;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        String key = request.getHeader(HEADER);
        Optional<UserAccount> account = key == null ? Optional.empty() : accounts.findByApiKey(key);
        if (account.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Missing or invalid X-Api-Key header.\"}");
            return false;
        }
        request.setAttribute(ACCOUNT_ATTRIBUTE, account.get());
        return true;
    }
}
