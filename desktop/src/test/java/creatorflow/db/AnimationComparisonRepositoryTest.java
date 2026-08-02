package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;

import creatorflow.motion.PlaybackSettings;
import creatorflow.workflow.AnimationComparisonRecord;
import creatorflow.workflow.LocalProject;
import java.nio.file.Path;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AnimationComparisonRepositoryTest {

    @TempDir
    Path dir;

    private Database database;
    private AnimationComparisonRepository repo;
    private long projectId;

    @BeforeEach
    void openDatabase() {
        database = new Database(dir.resolve("test.db"));
        repo = new AnimationComparisonRepository(database);
        LocalProject project = new LocalProjectRepository(database).adopt(dir);
        projectId = project.projectId();
    }

    @AfterEach
    void closeDatabase() {
        database.close();
    }

    @Test
    void roundTripsOptionalPlayabilityJson() {
        String playability = "{\"source\":{\"r6\":{\"ok\":true}},\"candidate\":{\"r6\":{\"ok\":false}}}";

        AnimationComparisonRecord withPlayability = repo.insert(projectId, "1001", "1002", "Walk", "Walk",
                1.0, 1.0, "fp1", "fp2", 100, 100, 100, 100, true,
                "{\"verdict\":\"MATCH\"}", "motion-v2", PlaybackSettings.unknown(), PlaybackSettings.unknown(),
                playability, null, null);
        assertEquals(Optional.of(playability), withPlayability.playabilityJson());

        AnimationComparisonRecord withoutPlayability = repo.insert(projectId, "2001", "2002", "Run", "Run",
                1.0, 1.0, "fp3", "fp4", 100, 100, 100, 100, true,
                "{\"verdict\":\"MATCH\"}", "motion-v2", PlaybackSettings.unknown(), PlaybackSettings.unknown(),
                null, null, null);
        assertEquals(Optional.empty(), withoutPlayability.playabilityJson());

        assertEquals(Optional.of(playability), repo.findById(withPlayability.id()).orElseThrow().playabilityJson());
        assertEquals(Optional.empty(), repo.findById(withoutPlayability.id()).orElseThrow().playabilityJson());
    }

    @Test
    void roundTripsOptionalClipKinds() {
        AnimationComparisonRecord withKinds = repo.insert(projectId, "5001", "5002", "Walk", "Walk",
                1.0, 1.0, "fp5", "fp6", 100, 100, 100, 100, true,
                "{\"verdict\":\"MATCH\"}", "motion-v2", PlaybackSettings.unknown(), PlaybackSettings.unknown(),
                null, "KEYFRAME", "CURVE_SAMPLED");
        assertEquals(Optional.of("KEYFRAME"), withKinds.sourceClipKind());
        assertEquals(Optional.of("CURVE_SAMPLED"), withKinds.candidateClipKind());

        AnimationComparisonRecord withoutKinds = repo.insert(projectId, "6001", "6002", "Run", "Run",
                1.0, 1.0, "fp7", "fp8", 100, 100, 100, 100, true,
                "{\"verdict\":\"MATCH\"}", "motion-v2", PlaybackSettings.unknown(), PlaybackSettings.unknown(),
                null, null, null);
        assertEquals(Optional.empty(), withoutKinds.sourceClipKind());
        assertEquals(Optional.empty(), withoutKinds.candidateClipKind());

        assertEquals(Optional.of("KEYFRAME"), repo.findById(withKinds.id()).orElseThrow().sourceClipKind());
    }
}
