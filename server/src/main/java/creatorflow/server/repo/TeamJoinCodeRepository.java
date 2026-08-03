package creatorflow.server.repo;

import creatorflow.server.domain.TeamJoinCode;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamJoinCodeRepository extends JpaRepository<TeamJoinCode, Long> {

    /** The only lookup: by the SHA-256 of a presented code. The raw code is never stored. */
    Optional<TeamJoinCode> findByCodeHash(String codeHash);
}
