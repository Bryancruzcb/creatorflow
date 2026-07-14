package creatorflow.manifest;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Small CLI release gate for exercising the scanner before desktop integration lands. */
public final class ManifestCli {

    /** Parsed invocation: positional arguments plus the merged directory-name exclusions. */
    record CliArgs(List<String> positional, Set<String> excludedDirectoryNames) {
    }

    private ManifestCli() {
    }

    public static void main(String[] args) throws Exception {
        CliArgs parsed;
        try {
            parsed = parse(args);
        } catch (IllegalArgumentException e) {
            System.err.println(e.getMessage());
            System.err.println("Usage: ManifestCli <project-directory> <project-name> <release>"
                    + " [output.json] [--exclude <directory-name>]...");
            System.exit(2);
            return;
        }

        List<String> positional = parsed.positional();
        Path root = Path.of(positional.get(0));
        Path output = positional.size() == 4
                ? Path.of(positional.get(3))
                : root.resolve("creatorflow-manifest.json");
        ScanOptions options = ScanOptions.defaults()
                .withExcludedDirectoryNames(parsed.excludedDirectoryNames());
        CreativeManifest manifest = new ProjectScanner()
                .scanDetailed(root, positional.get(1), positional.get(2),
                        SourceEvidenceResolver.unresolved(), options,
                        ScanObserver.noop(), new ScanCancellation())
                .manifest();
        new ManifestJson().write(output, manifest);

        CreativeManifest.Summary summary = manifest.summary();
        System.out.printf("Wrote %s%n", output.toAbsolutePath().normalize());
        System.out.printf("Assets: %d · clear: %d · similar: %d · duplicate: %d · unresolved sources: %d%n",
                summary.total(), summary.clear(), summary.similar(), summary.duplicate(),
                summary.unresolvedSources());
    }

    /**
     * {@code --exclude} is repeatable and adds to (never replaces) the default
     * exclusions, so fixture or vendor trees can be kept out of a release scan.
     */
    static CliArgs parse(String[] args) {
        List<String> positional = new ArrayList<>();
        Set<String> excludes = new LinkedHashSet<>(ScanOptions.DEFAULT_EXCLUDED_DIRECTORY_NAMES);
        for (int i = 0; i < args.length; i++) {
            if ("--exclude".equals(args[i])) {
                if (i + 1 >= args.length) {
                    throw new IllegalArgumentException("--exclude requires a directory name");
                }
                excludes.add(args[++i]);
            } else {
                positional.add(args[i]);
            }
        }
        if (positional.size() < 3 || positional.size() > 4) {
            throw new IllegalArgumentException("Expected 3 or 4 positional arguments, got "
                    + positional.size());
        }
        return new CliArgs(List.copyOf(positional), Set.copyOf(excludes));
    }
}
