package creatorflow.server.repo;

import creatorflow.server.domain.Dispute;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DisputeRepository extends JpaRepository<Dispute, Long> {

    List<Dispute> findByClaimantIdOrderByCreatedAtDesc(Long claimantId);

    List<Dispute> findByAsset_Owner_IdOrderByCreatedAtDesc(Long ownerId);

    long countByAssetIdAndStatus(Long assetId, String status);
}
