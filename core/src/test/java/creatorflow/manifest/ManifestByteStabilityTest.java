package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;

import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.Project;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.CreativeManifest.Summary;
import creatorflow.model.VerificationStatus;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Pins the exact bytes {@link ManifestJson} writes for a fixed manifest.
 *
 * <p>Byte-determinism is a product promise: a release manifest regenerated from the same persisted
 * evidence must be identical, so a CLI can verify the embedded gate result and exit non-zero when
 * someone has edited it. The existing tests only compare two exports produced by the <em>same</em>
 * build, which cannot notice a serializer that starts formatting differently — a Jackson upgrade
 * would change every manifest in lockstep and stay green.
 *
 * <p>So this test hashes the output. If it fails after a dependency bump, the new bytes are not
 * necessarily wrong, but the change is real and someone has to decide it is acceptable and update
 * the constant deliberately rather than by accident.
 */
class ManifestByteStabilityTest {

    /** SHA-256 of ManifestJson.write(FIXTURE) under jackson-databind 2.17.2. */
    private static final String EXPECTED_SHA256 =
            "0c72bf2013fea235b8e45e81f3f0680b8d2171cd6b48dcb679ff5e562956c4ce";

    private static CreativeManifest fixture() {
        AssetEntry asset = new AssetEntry(
                "art/hero.png", "hero.png", "png", 2048,
                "a".repeat(64), 128, 256,
                new Fingerprints("0123456789abcdef", "fedcba9876543210", null),
                VerificationStatus.SIMILAR,
                new SourceEvidence("Studio archive", "CC-BY-4.0", "https://example.test/evidence"),
                ReleaseDecision.APPROVED, List.of(), List.of("Perceptual match"));
        return new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new Project("Byte Stability", "1.0.0"),
                Instant.parse("2026-07-21T02:35:21.397452600Z"),
                new Summary(1, 0, 1, 0, 0, 0), List.of(asset));
    }

    @Test
    void manifestBytesAreStableAcrossDependencyChanges() throws IOException, NoSuchAlgorithmException {
        String written = new ManifestJson().write(fixture());
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        String actual = HexFormat.of().formatHex(digest.digest(written.getBytes(StandardCharsets.UTF_8)));
        assertEquals(EXPECTED_SHA256, actual,
                "manifest serialization changed — verify the new output is acceptable, then update "
                        + "EXPECTED_SHA256 deliberately. Written form was:\n" + written);
    }
}
