package creatorflow.server.web;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.UserAccountRepository;
import creatorflow.server.service.ApiKeys;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class AccountController {

    public record CreateAccountRequest(String username) {
    }

    public record AccountResponse(String username, String apiKey) {
    }

    private final UserAccountRepository accounts;

    public AccountController(UserAccountRepository accounts) {
        this.accounts = accounts;
    }

    /** Open endpoint: register a username, receive the API key for all other calls. */
    @PostMapping("/accounts")
    public ResponseEntity<AccountResponse> create(@RequestBody CreateAccountRequest request) {
        String username = request.username() == null ? "" : request.username().strip();
        if (username.length() < 3 || username.length() > 40) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Username must be 3-40 characters.");
        }
        if (accounts.existsByUsernameIgnoreCase(username)) {
            throw new ApiException(HttpStatus.CONFLICT, "Username “" + username + "” is taken.");
        }
        UserAccount account = accounts.save(new UserAccount(username, ApiKeys.newKey()));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new AccountResponse(account.getUsername(), account.getApiKey()));
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
