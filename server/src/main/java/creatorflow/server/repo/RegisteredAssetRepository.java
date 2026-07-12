package creatorflow.server.repo;

import creatorflow.server.domain.RegisteredAsset;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RegisteredAssetRepository extends JpaRepository<RegisteredAsset, Long> {

    List<RegisteredAsset> findByOwnerIdOrderByCreatedAtDesc(Long ownerId);

    /**
     * Public gallery: latest version of each stored stack, optional search text,
     * file-type filter, and a feedback-wanted-only switch.
     */
    @Query("""
            select a from RegisteredAsset a
            where a.hasFile = true
              and (a.latestVersion = true or a.latestVersion is null)
              and a.fileType in :types
              and (:feedbackOnly = false or a.feedbackWanted = true)
              and (:q = '' or lower(a.title) like concat('%', :q, '%')
                   or lower(a.fileName) like concat('%', :q, '%')
                   or lower(a.description) like concat('%', :q, '%')
                   or lower(a.owner.username) like concat('%', :q, '%'))
            order by a.createdAt desc
            """)
    Page<RegisteredAsset> gallery(@Param("q") String q,
                                  @Param("types") Collection<String> types,
                                  @Param("feedbackOnly") boolean feedbackOnly,
                                  Pageable pageable);

    List<RegisteredAsset> findByOwnerIdAndHasFileTrueOrderByCreatedAtDesc(Long ownerId);

    List<RegisteredAsset> findByRootIdOrderByVersionNumberDesc(Long rootId);

    long countByOwnerId(Long ownerId);
}
