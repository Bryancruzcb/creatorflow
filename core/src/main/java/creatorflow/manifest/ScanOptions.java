package creatorflow.manifest;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/** Immutable traversal policy for a project scan. */
public record ScanOptions(
        Set<String> excludedDirectoryNames,
        Set<String> supportedFileTypes,
        boolean includeHidden,
        boolean followSymbolicLinks) {

    public static final Set<String> DEFAULT_EXCLUDED_DIRECTORY_NAMES = Set.of(
            ".git", ".gradle", ".idea", ".mvn", ".next", ".nuxt", ".turbo",
            "build", "coverage", "dist", "node_modules", "out", "target");

    public static final Set<String> DEFAULT_SUPPORTED_FILE_TYPES = Set.of(
            "png", "jpg", "jpeg", "gif", "bmp", "svg", "exr", "psd", "sketch",
            "wav", "aif", "aiff", "au", "mp3", "ogg", "flac",
            "glb", "gltf", "fbx", "obj", "blend",
            "ttf", "otf", "woff", "woff2");

    public ScanOptions {
        excludedDirectoryNames = normalized(excludedDirectoryNames, "excludedDirectoryNames", false);
        supportedFileTypes = normalized(supportedFileTypes, "supportedFileTypes", true);
        if (supportedFileTypes.isEmpty()) {
            throw new IllegalArgumentException("supportedFileTypes cannot be empty");
        }
    }

    public static ScanOptions defaults() {
        return new ScanOptions(DEFAULT_EXCLUDED_DIRECTORY_NAMES, DEFAULT_SUPPORTED_FILE_TYPES, false, false);
    }

    public ScanOptions withExcludedDirectoryNames(Set<String> names) {
        return new ScanOptions(names, supportedFileTypes, includeHidden, followSymbolicLinks);
    }

    public ScanOptions withSupportedFileTypes(Set<String> types) {
        return new ScanOptions(excludedDirectoryNames, types, includeHidden, followSymbolicLinks);
    }

    public ScanOptions withIncludeHidden(boolean value) {
        return new ScanOptions(excludedDirectoryNames, supportedFileTypes, value, followSymbolicLinks);
    }

    public ScanOptions withFollowSymbolicLinks(boolean value) {
        return new ScanOptions(excludedDirectoryNames, supportedFileTypes, includeHidden, value);
    }

    boolean excludesDirectory(String name) {
        return excludedDirectoryNames.contains(name.toLowerCase(Locale.ROOT));
    }

    boolean supports(String fileType) {
        return supportedFileTypes.contains(fileType.toLowerCase(Locale.ROOT));
    }

    private static Set<String> normalized(Set<String> values, String label, boolean stripLeadingDot) {
        Objects.requireNonNull(values, label);
        TreeSet<String> sorted = new TreeSet<>();
        for (String value : values) {
            if (value == null || value.isBlank()) {
                throw new IllegalArgumentException(label + " cannot contain blank values");
            }
            String normalized = value.strip().toLowerCase(Locale.ROOT);
            if (stripLeadingDot && normalized.startsWith(".")) normalized = normalized.substring(1);
            if (normalized.contains("/") || normalized.contains("\\")) {
                throw new IllegalArgumentException(label + " entries must be names, not paths: " + value);
            }
            sorted.add(normalized);
        }
        return Collections.unmodifiableSet(new LinkedHashSet<>(sorted));
    }
}
