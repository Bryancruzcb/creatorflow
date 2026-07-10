package creatorflow.server.repo;

import creatorflow.server.domain.UserAccount;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAccountRepository extends JpaRepository<UserAccount, Long> {

    Optional<UserAccount> findByApiKey(String apiKey);

    boolean existsByUsernameIgnoreCase(String username);
}
