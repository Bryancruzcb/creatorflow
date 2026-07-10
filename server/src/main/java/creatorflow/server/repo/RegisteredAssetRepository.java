package creatorflow.server.repo;

import creatorflow.server.domain.RegisteredAsset;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RegisteredAssetRepository extends JpaRepository<RegisteredAsset, Long> {

    List<RegisteredAsset> findByOwnerIdOrderByCreatedAtDesc(Long ownerId);
}
