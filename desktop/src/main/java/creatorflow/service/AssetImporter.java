package creatorflow.service;

import creatorflow.db.AssetRepository;
import creatorflow.model.Asset;
import creatorflow.model.AssetMatch;
import creatorflow.model.OriginalityReport;
import creatorflow.model.VerificationStatus;
import creatorflow.service.registry.RegistryClient;
import creatorflow.verification.OriginalityEngine;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Brings a file into the managed library: verifies it against everything
 * already indexed locally — and, when a community registry is configured,
 * against every other account's fingerprints — then copies it into the
 * library folder and persists the asset with its match evidence.
 */
public final class AssetImporter {

    private final AssetRepository assets;
    private final OriginalityEngine engine;
    private final Path libraryDir;
    private final RegistryClient registry;

    public AssetImporter(AssetRepository assets, OriginalityEngine engine, Path libraryDir) {
        this(assets, engine, libraryDir, RegistryClient.disabled());
    }

    public AssetImporter(AssetRepository assets, OriginalityEngine engine, Path libraryDir,
                         RegistryClient registry) {
        this.assets = assets;
        this.engine = engine;
        this.libraryDir = libraryDir;
        this.registry = registry;
    }

    public record ImportRequest(Path source, long projectId, String license, boolean ownershipDeclared) {
    }

    public record ImportResult(Asset asset, OriginalityReport report) {
    }

    public ImportResult importFile(ImportRequest request) throws IOException {
        List<Asset> indexed = assets.findAll();
        OriginalityEngine.Result result = engine.verify(request.source(), indexed);

        VerificationStatus status = result.report().status();
        List<AssetMatch> matches = new ArrayList<>(result.report().matches());
        List<String> findings = new ArrayList<>(result.report().findings());
        List<String> layersRun = new ArrayList<>(result.report().layersRun());

        if (registry.isConfigured()) {
            try {
                RegistryClient.RemoteVerdict remote = registry.verify(
                        request.source().getFileName().toString(),
                        result.sha256(), result.dHash(), result.pHash(), result.audioFp());
                for (RegistryClient.RemoteMatch match : remote.matches()) {
                    matches.add(new AssetMatch(match.assetId(),
                            match.fileName() + " — registered by " + match.owner(),
                            "registry", match.distance(), match.note()));
                }
                if (remote.verdict().ordinal() > status.ordinal()) {
                    status = remote.verdict();
                }
                layersRun.add("Community registry (fingerprints only)");
            } catch (Exception e) {
                findings.add("Community registry unreachable — verified against the local library only.");
            }
        }

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
                status,
                String.join("\n", findings),
                Instant.now());

        Asset saved = assets.insert(asset, matches);

        if (registry.isConfigured()) {
            try {
                registry.register(saved);
            } catch (Exception e) {
                // the local import already succeeded; a failed registration just means
                // this asset is not yet visible to other accounts
            }
        }

        return new ImportResult(saved, new OriginalityReport(
                status, List.copyOf(matches), List.copyOf(findings), List.copyOf(layersRun)));
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
