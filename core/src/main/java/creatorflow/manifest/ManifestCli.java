package creatorflow.manifest;

import java.nio.file.Path;

/** Small CLI release gate for exercising the scanner before desktop integration lands. */
public final class ManifestCli {

    private ManifestCli() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 3 || args.length > 4) {
            System.err.println("Usage: ManifestCli <project-directory> <project-name> <release> [output.json]");
            System.exit(2);
        }

        Path root = Path.of(args[0]);
        Path output = args.length == 4 ? Path.of(args[3]) : root.resolve("creatorflow-manifest.json");
        CreativeManifest manifest = new ProjectScanner().scan(root, args[1], args[2]);
        new ManifestJson().write(output, manifest);

        CreativeManifest.Summary summary = manifest.summary();
        System.out.printf("Wrote %s%n", output.toAbsolutePath().normalize());
        System.out.printf("Assets: %d · clear: %d · similar: %d · duplicate: %d · unresolved sources: %d%n",
                summary.total(), summary.clear(), summary.similar(), summary.duplicate(),
                summary.unresolvedSources());
    }
}
