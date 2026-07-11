package creatorflow.server.web;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.UserAccountRepository;
import creatorflow.server.service.ApiKeys;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;

/** Login and signup pages. Signup also issues the account's API key for the desktop app. */
@Controller
public class WebAuthController {

    private static final String USERNAME_PATTERN = "[A-Za-z0-9._-]{3,40}";

    private final UserAccountRepository accounts;
    private final PasswordEncoder passwordEncoder;

    public WebAuthController(UserAccountRepository accounts, PasswordEncoder passwordEncoder) {
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
    }

    @GetMapping("/login")
    public String login() {
        return "login";
    }

    @GetMapping("/signup")
    public String signupForm() {
        return "signup";
    }

    @PostMapping("/signup")
    public String signup(@RequestParam String username,
                         @RequestParam(required = false) String displayName,
                         @RequestParam String password,
                         @RequestParam String confirm,
                         Model model) {
        String name = username == null ? "" : username.strip();
        String error = validate(name, password, confirm);
        if (error != null) {
            model.addAttribute("error", error);
            model.addAttribute("username", name);
            model.addAttribute("displayName", displayName);
            return "signup";
        }
        UserAccount account = new UserAccount(name, ApiKeys.newKey());
        account.setPasswordHash(passwordEncoder.encode(password));
        if (displayName != null && !displayName.isBlank()) {
            account.setDisplayName(displayName.strip());
        }
        accounts.save(account);
        return "redirect:/login?created";
    }

    private String validate(String username, String password, String confirm) {
        if (!username.matches(USERNAME_PATTERN)) {
            return "Usernames are 3–40 characters: letters, digits, dots, dashes, underscores.";
        }
        if (accounts.existsByUsernameIgnoreCase(username)) {
            return "The username “" + username + "” is taken.";
        }
        if (password == null || password.length() < 8) {
            return "Passwords need at least 8 characters.";
        }
        if (!password.equals(confirm)) {
            return "The two passwords do not match.";
        }
        return null;
    }
}
