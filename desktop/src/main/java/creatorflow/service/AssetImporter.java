package creatorflow.service;

import creatorflow.db.AssetRepository;
import creatorflow.model.Asset;
import creatorflow.model.OriginalityReport;
import creatorflow.verification.OriginalityEngine;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

/**
 * Brings a file into the managed library: verifies it against everything
 * already indexed, copies it into the library folder, and persists the asset
 * together with its match evidence.
 */
public final class AssetImporter {

    private final AssetRepository assets;
    private final OriginalityEngine engine;
    private final Path libraryDir;

    public AssetImporter(AssetRepository assets, OriginalityEngine engine, Path libraryDir) {
        this.assets = assets;
        this.engine = engine;
        this.libraryDir = libraryDir;
    }

    public record ImportRequest(Path source, long projectId, String license, boolean ownershipDeclared) {
    }

    public record ImportResult(Asset asset, OriginalityReport report) {
    }

    public ImportResult importFile(ImportRequest request) throws IOException {
        List<Asset> indexed = assets.findAll();
        OriginalityEngine.Result result = engine.verify(request.source(), indexed);
        OriginalityReport report = result.report();

        Path stored = copyIntoLibrary(request.source(), request.projectId());

        Asset asset = new Asset(
                0,
                request.projectId(),
                request.source().getFileName().toString(),
                stored.toString(),
                OriginalityEngine.fileType(request.source()),
                Files.size(request.source()),
                result.width(),
                result.height(),
                result.sha256(),
                result.dHash(),
                result.pHash(),
                result.audioFp(),
                request.license(),
                request.ownershipDeclared(),
                report.status(),
                String.join("\n", report.findings()),
                Instant.now());

        Asset saved = assets.insert(asset, report.matches());
        return new ImportResult(saved, report);
    }

    /** Copies into {@code library/<projectId>/}, suffixing the name if it collides. */
    private Path copyIntoLibrary(Path source, long projectId) throws IOException {
        Path projectDir = libraryDir.resolve(String.valueOf(projectId));
        Files.createDirectories(projectDir);

        String name = source.getFileName().toString();
        String base = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            base = name.substring(0, dot);
            ext = name.substring(dot);
        }

        Path target = projectDir.resolve(name);
        for (int i = 1; Files.exists(target); i++) {
            target = projectDir.resolve(base + "-" + i + ext);
        }
        Files.copy(source, target);
        return target;
    }
}
