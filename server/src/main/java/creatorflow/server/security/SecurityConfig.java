package creatorflow.server.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Headless, deny-by-default: the server serves no pages and holds no browser
 * session — there is exactly one front door, {@code /api/**}, authenticated by
 * the per-account {@code X-Api-Key} header that {@code ApiKeyInterceptor}
 * enforces. That path is permitted here and CSRF-exempt (a header-authenticated
 * request cannot be forged by a cross-site form); everything else is denied
 * outright rather than redirected to a login that no longer exists.
 *
 * <p>The CSP header stays. It costs nothing on JSON responses and keeps the
 * hardening in place for any surface a later phase adds.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.ignoringRequestMatchers("/api/**"))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/**", "/error").permitAll()
                        .anyRequest().denyAll())
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .headers(headers -> headers.contentSecurityPolicy(csp -> csp.policyDirectives(
                        "default-src 'self'; img-src 'self' data:; media-src 'self'; "
                                + "style-src 'self' 'unsafe-inline'; script-src 'self'; "
                                + "object-src 'none'; frame-ancestors 'none'; form-action 'self'")));
        return http.build();
    }

    /**
     * There are no browser logins. Stating that explicitly stops Boot from
     * auto-configuring a random-password development user — and logging its
     * password on every start — for a server that has no login form to use it.
     */
    @Bean
    public UserDetailsService noBrowserLogins() {
        return username -> {
            throw new UsernameNotFoundException("This server has no browser logins.");
        };
    }
}
