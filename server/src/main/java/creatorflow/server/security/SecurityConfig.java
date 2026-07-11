package creatorflow.server.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Two front doors, one account table: browsers use session form-login with
 * BCrypt passwords; API and desktop clients use per-account API keys, which the
 * existing {@code ApiKeyInterceptor} enforces — so {@code /api/**} is permitted
 * here and CSRF-exempt (header-authenticated requests cannot be forged by a form).
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.ignoringRequestMatchers("/api/**"))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/", "/assets/*", "/u/**", "/files/**", "/thumbs/**",
                                "/css/**", "/js/**", "/login", "/signup", "/error", "/api/**")
                        .permitAll()
                        .anyRequest().authenticated())
                .formLogin(form -> form
                        .loginPage("/login")
                        .defaultSuccessUrl("/", false)
                        .permitAll())
                .logout(logout -> logout
                        .logoutUrl("/logout")
                        .logoutSuccessUrl("/"))
                .headers(headers -> headers.contentSecurityPolicy(csp -> csp.policyDirectives(
                        "default-src 'self'; img-src 'self' data:; media-src 'self'; "
                                + "style-src 'self' 'unsafe-inline'; script-src 'self'; "
                                + "object-src 'none'; frame-ancestors 'none'; form-action 'self'")));
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
