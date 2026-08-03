package creatorflow.server.web;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.UserAccountRepository;
import creatorflow.server.service.ApiKeys;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class AccountController {

    public static final String SIGNUP_TOKEN_HEADER = "X-Signup-Token";

    public record CreateAccountRequest(String username) {
    }

    public record AccountResponse(String username, String apiKey) {
    }

    private final UserAccountRepository accounts;

    /**
     * Optional shared secret gating registration, from {@code creatorflow.signup.token}.
     *
     * <p>Blank by default, which keeps registration open — the posture a trusted LAN box has had
     * all along. Set it and every new account must present the same value in
     * {@value #SIGNUP_TOKEN_HEADER}. Open registration on a box anyone on the network can reach is
     * a real hole, and this is the handful of lines that closes it.
     *
     * <p>One interaction to know about: the frozen Rojo plugin's own account-creation call
     * ({@code roblox-plugin/src/Api.luau}) sends no such header, so an operator who also turns on
     * the legacy registry flag should create plugin accounts <em>before</em> setting this — or
     * leave it unset on a network they already trust.
     */
    private final String signupToken;

    public AccountController(UserAccountRepository accounts,
                             @Value("${creatorflow.signup.token:}") String signupToken) {
        this.accounts = accounts;
        this.signupToken = signupToken == null ? "" : signupToken.strip();
    }

    /** Register a username, receive the API key for all other calls. */
    @PostMapping("/accounts")
    public ResponseEntity<AccountResponse> create(
            @RequestBody CreateAccountRequest request,
            @RequestHeader(value = SIGNUP_TOKEN_HEADER, required = false) String presentedToken) {
        requireSignupToken(presentedToken);
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

    /**
     * No configured token means open registration, unchanged. A configured one is compared in
     * constant time, mirroring the desktop bridge's session/CSRF checks — a secret that leaks its
     * length or prefix through timing is not much of a secret.
     */
    private void requireSignupToken(String presentedToken) {
        if (signupToken.isEmpty()) return;
        byte[] expected = signupToken.getBytes(StandardCharsets.UTF_8);
        byte[] presented = (presentedToken == null ? "" : presentedToken.strip())
                .getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, presented)) {
            throw new ApiException(HttpStatus.FORBIDDEN,
                    "This server requires a signup token. Ask whoever runs it for the value to send "
                            + "as " + SIGNUP_TOKEN_HEADER + ".");
        }
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
