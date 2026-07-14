package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ManifestCliTest {

    @Test
    void excludeFlagsAddToTheDefaultExclusions() {
        ManifestCli.CliArgs parsed = ManifestCli.parse(new String[] {
                "/project", "Name", "1.0.0", "out.json",
                "--exclude", "stress-fixtures", "--exclude", "decoders"});

        assertEquals(java.util.List.of("/project", "Name", "1.0.0", "out.json"), parsed.positional());
        assertTrue(parsed.excludedDirectoryNames().contains("stress-fixtures"));
        assertTrue(parsed.excludedDirectoryNames().contains("decoders"));
        assertTrue(parsed.excludedDirectoryNames().containsAll(
                ScanOptions.DEFAULT_EXCLUDED_DIRECTORY_NAMES),
                "defaults such as node_modules must survive --exclude");
    }

    @Test
    void excludeFlagsMayInterleaveWithPositionals() {
        ManifestCli.CliArgs parsed = ManifestCli.parse(new String[] {
                "--exclude", "fixtures", "/project", "Name", "1.0.0"});
        assertEquals(3, parsed.positional().size());
        assertTrue(parsed.excludedDirectoryNames().contains("fixtures"));
    }

    @Test
    void rejectsDanglingExcludeAndWrongArity() {
        assertThrows(IllegalArgumentException.class,
                () -> ManifestCli.parse(new String[] {"/project", "Name", "1.0.0", "--exclude"}));
        assertThrows(IllegalArgumentException.class,
                () -> ManifestCli.parse(new String[] {"/project", "Name"}));
        assertThrows(IllegalArgumentException.class,
                () -> ManifestCli.parse(new String[] {"a", "b", "c", "d", "e"}));
    }
}
