package creatorflow.server.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.RegisteredAssetRepository;
import creatorflow.server.storage.FileStore;
import creatorflow.verification.OriginalityEngine;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * The community gallery: uploads run the exact core verification pipeline on the
 * server, are matched against every registered fingerprint (desktop registrations
 * included), and only then publish. Exact duplicates never publish; perceptual
 * matches publish visibly flagged with their evidence.
 */
@Service
public class GalleryService {

    public static final Set<String> IMAGE_TYPES = Set.of("png", "jpg", "jpeg", "gif", "bmp", "webp", "svg");
    public static final Set<String> AUDIO_TYPES = Set.of("wav", "mp3", "ogg", "aif", "aiff", "au");

    public static final List<String> LICENSES = List.of(
            "All rights reserved", "CC0 (public domain)", "CC-BY 4.0", "CC-BY-SA 4.0",
            "Licensed (commercial)", "Unknown");

    private static final Map<String, String> MIME_BY_TYPE = Map.ofEntries(
            Map.entry("png", "image/png"), Map.entry("jpg", "image/jpeg"),
            Map.entry("jpeg", "image/jpeg"), Map.entry("gif", "image/gif"),
            Map.entry("bmp", "image/bmp"), Map.entry("webp", "image/webp"),
            Map.entry("svg", "image/svg+xml"), Map.entry("wav", "audio/wav"),
            Map.entry("mp3", "audio/mpeg"), Map.entry("ogg", "audio/ogg"),
            Map.entry("aif", "audio/aiff"), Map.entry("aiff", "audio/aiff"),
            Map.entry("au", "audio/basic"));

    private static final int PAGE_SIZE = 30;

    /** What the upload page renders: either the published asset or why publishing stopped. */
    public record UploadOutcome(boolean published, RegisteredAsset asset, String blockReason,
                                String verdict, List<RegistryService.Match> matches,
                                List<String> findings) {

        public static UploadOutcome blocked(String reason, String verdict,
                                            List<RegistryService.Match> matches, List<String> findings) {
            return new UploadOutcome(false, null, reason, verdict, matches, findings);
        }
    }

    /** The originality report persisted with each published asset. */
    public record StoredReport(String verdict, List<RegistryService.Match> matches,
                               List<String> findings, List<String> layers) {

        public static StoredReport empty() {
            return new StoredReport("CLEAR", List.of(), List.of(), List.of());
        }
    }

    private final RegisteredAssetRepository assets;
    private final RegistryService registry;
    private final FileStore files;
    private final ObjectMapper json;

    public GalleryService(RegisteredAssetRepository assets, RegistryService registry,
                          FileStore files, ObjectMapper json) {
        this.assets = assets;
        this.registry = registry;
        this.files = files;
        this.json = json;
    }

    @Transactional
    public UploadOutcome upload(UserAccount user, MultipartFile file, String title,
                                String description, String license, boolean ownershipDeclared)
            throws IOException {
        if (file == null || file.isEmpty()) {
            return UploadOutcome.blocked("Choose a file to upload.", null, List.of(), List.of());
        }
        String fileName = cleanFileName(file.getOriginalFilename());
        String fileType = OriginalityEngine.fileType(Path.of(fileName));
        Path tmp = Files.createTempFile("cf-upload-", fileType.isEmpty() ? ".bin" : "." + fileType);
        try {
            file.transferTo(tmp);
            return publish(user, tmp, fileName, file.getSize(), title, description,
                    license, ownershipDeclared);
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    /** The pipeline itself, from a file on disk — also used by the demo seeder. */
    @Transactional
    public UploadOutcome publish(UserAccount user, Path source, String originalName, long size,
                                 String title, String description, String license,
                                 boolean ownershipDeclared) throws IOException {
        String fileName = cleanFileName(originalName);
        String fileType = OriginalityEngine.fileType(Path.of(fileName));
        if (!IMAGE_TYPES.contains(fileType) && !AUDIO_TYPES.contains(fileType)) {
            return UploadOutcome.blocked("“" + fileType + "” files are not supported. Images ("
                    + String.join(", ", IMAGE_TYPES.stream().sorted().toList()) + ") and audio ("
                    + String.join(", ", AUDIO_TYPES.stream().sorted().toList()) + ") are.",
                    null, List.of(), List.of());
        }
        if (!ownershipDeclared) {
            return UploadOutcome.blocked(
                    "You must declare that you created this work or hold the rights to share it.",
                    null, List.of(), List.of());
        }

        // The same pipeline the desktop app runs, executed server-side.
        OriginalityEngine.Result local = new OriginalityEngine().verify(source, List.of());
        RegistryService.Verdict remote = registry.verify(new RegistryService.Fingerprints(
                fileName, local.sha256(), local.dHash(), local.pHash(), local.audioFp()), user);

        List<RegistryService.Match> exact = remote.matches().stream()
                .filter(m -> "sha256".equals(m.layer())).toList();
        List<RegistryService.Match> perceptual = remote.matches().stream()
                .filter(m -> !"sha256".equals(m.layer())).toList();

        // Exact duplicates never publish. The one exception: the uploader's own
        // fingerprint-only registration (from the desktop app) is upgraded in
        // place — that is "publish the file for an asset I already registered".
        RegisteredAsset adopt = null;
        for (RegistryService.Match match : exact) {
            RegisteredAsset existing = assets.findById(match.assetId()).orElse(null);
            if (existing == null) {
                continue;
            }
            boolean own = existing.getOwner().getId().equals(user.getId());
            if (!own) {
                return UploadOutcome.blocked("This exact file is already registered by “"
                        + existing.getOwner().getUsername() + "”. Byte-identical uploads are never "
                        + "published — if this is your work, file a dispute on the existing asset.",
                        "DUPLICATE", remote.matches(), local.report().findings());
            }
            if (existing.isGalleryAsset()) {
                return UploadOutcome.blocked("You already published this exact file as “"
                        + existing.getDisplayTitle() + "”.",
                        "DUPLICATE", remote.matches(), local.report().findings());
            }
            adopt = existing;
        }

        String verdict = perceptual.isEmpty() ? "CLEAR" : "SIMILAR";
        List<String> layers = new ArrayList<>(local.report().layersRun());
        layers.add("Community registry cross-check (all accounts)");
        String reportJson = writeReport(new StoredReport(verdict, perceptual,
                local.report().findings(), layers));

        RegisteredAsset asset = adopt != null ? adopt
                : new RegisteredAsset(user, fileName, fileType, size, local.sha256(),
                        local.dHash(), local.pHash(), local.audioFp(),
                        normalizeLicense(license), true);
        asset.publishToGallery(clip(title, 120), clip(description, 2000),
                MIME_BY_TYPE.get(fileType), verdict, reportJson,
                local.width() > 0 ? local.width() : null,
                local.height() > 0 ? local.height() : null);
        asset = assets.save(asset);

        files.store(source, local.sha256());
        if (IMAGE_TYPES.contains(fileType)) {
            files.writeThumbnail(source, local.sha256());
        }
        return new UploadOutcome(true, asset, null, verdict, perceptual,
                local.report().findings());
    }

    @Transactional(readOnly = true)
    public Page<RegisteredAsset> browse(String q, String type, int page) {
        Set<String> types = switch (type == null ? "" : type) {
            case "image" -> IMAGE_TYPES;
            case "audio" -> AUDIO_TYPES;
            default -> allTypes();
        };
        String query = q == null ? "" : q.strip().toLowerCase(Locale.ROOT);
        return assets.gallery(query, types, PageRequest.of(Math.max(0, page), PAGE_SIZE));
    }

    public StoredReport report(RegisteredAsset asset) {
        if (asset.getReportJson() == null) {
            return StoredReport.empty();
        }
        try {
            return json.readValue(asset.getReportJson(), StoredReport.class);
        } catch (JsonProcessingException e) {
            return StoredReport.empty();
        }
    }

    private String writeReport(StoredReport report) {
        try {
            return json.writeValueAsString(report);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialize originality report", e);
        }
    }

    private static Set<String> allTypes() {
        Set<String> all = new HashSet<>(IMAGE_TYPES);
        all.addAll(AUDIO_TYPES);
        return all;
    }

    private static String cleanFileName(String original) {
        String name = original == null || original.isBlank() ? "upload" : original;
        name = Path.of(name.replace('\\', '/')).getFileName().toString();
        return name.length() > 160 ? name.substring(name.length() - 160) : name;
    }

    private static String normalizeLicense(String license) {
        return license == null || license.isBlank() ? "Unknown" : license.strip();
    }

    private static String clip(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String stripped = value.strip();
        return stripped.length() > max ? stripped.substring(0, max) : stripped;
    }
}
