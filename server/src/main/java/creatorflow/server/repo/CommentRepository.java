package creatorflow.server.repo;

import creatorflow.server.domain.Comment;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommentRepository extends JpaRepository<Comment, Long> {

    List<Comment> findByAssetIdOrderByCreatedAtAsc(Long assetId);

    long countByAssetId(Long assetId);
}
