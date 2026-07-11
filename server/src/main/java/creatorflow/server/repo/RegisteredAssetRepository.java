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

    /** Public gallery: stored files only, optional search text and file-type filter. */
    @Query("""
            select a from RegisteredAsset a
            where a.hasFile = true
              and a.fileType in :types
              and (:q = '' or lower(a.title) like concat('%', :q, '%')
                   or lower(a.fileName) like concat('%', :q, '%')
                   or lower(a.description) like concat('%', :q, '%')
                   or lower(a.owner.username) like concat('%', :q, '%'))
            order by a.createdAt desc
            """)
    Page<RegisteredAsset> gallery(@Param("q") String q,
                                  @Param("types") Collection<String> types,
                                  Pageable pageable);

    List<RegisteredAsset> findByOwnerIdAndHasFileTrueOrderByCreatedAtDesc(Long ownerId);

    long countByOwnerId(Long ownerId);
}
