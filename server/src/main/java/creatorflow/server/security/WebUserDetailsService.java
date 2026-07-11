package creatorflow.server.security;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.UserAccountRepository;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

/**
 * Web login backed by the registry's account table. Accounts created through
 * the API alone carry no password, so they cannot log into the site until one
 * is set — they keep working with their API key.
 */
@Service
public class WebUserDetailsService implements UserDetailsService {

    private final UserAccountRepository accounts;

    public WebUserDetailsService(UserAccountRepository accounts) {
        this.accounts = accounts;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        UserAccount account = accounts.findByUsernameIgnoreCase(username)
                .filter(a -> a.getPasswordHash() != null)
                .orElseThrow(() -> new UsernameNotFoundException(
                        "No web account named “" + username + "”."));
        return User.withUsername(account.getUsername())
                .password(account.getPasswordHash())
                .roles("USER")
                .build();
    }
}
