package creatorflow.server.repo;

import creatorflow.server.domain.AssetIdMapping;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AssetIdMappingRepository extends JpaRepository<AssetIdMapping, Long> {

    List<AssetIdMapping> findByAssetIdOrderByContextAsc(Long assetId);

    Optional<AssetIdMapping> findByAssetIdAndContext(Long assetId, String context);
}
