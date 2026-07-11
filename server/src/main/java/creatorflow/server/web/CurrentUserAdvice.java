package creatorflow.server.web;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.UserAccountRepository;
import java.security.Principal;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;

/** Exposes the logged-in account to every page template as {@code currentUser}. */
@ControllerAdvice(assignableTypes = {PageController.class, WebAuthController.class})
public class CurrentUserAdvice {

    private final UserAccountRepository accounts;

    public CurrentUserAdvice(UserAccountRepository accounts) {
        this.accounts = accounts;
    }

    @ModelAttribute("currentUser")
    public UserAccount currentUser(Principal principal) {
        return principal == null ? null
                : accounts.findByUsernameIgnoreCase(principal.getName()).orElse(null);
    }
}
