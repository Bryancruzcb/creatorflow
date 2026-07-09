package creatorflow.verification;

import com.drew.imaging.ImageMetadataReader;
import com.drew.metadata.Directory;
import com.drew.metadata.Metadata;
import com.drew.metadata.Tag;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Provenance layer: surfaces embedded authorship metadata (EXIF, XMP, PNG text
 * chunks) so a human can judge it. Findings are informational — they never
 * change the verdict, because metadata is trivially edited or stripped.
 */
public final class MetadataInspector {

    /** Tag-name fragments that indicate authorship or provenance. */
    private static final Set<String> INTERESTING = Set.of(
            "artist", "author", "copyright", "creator", "software", "credit", "by-line");

    private MetadataInspector() {
    }

    public static List<String> inspect(Path file) {
        List<String> findings = new ArrayList<>();
        try {
            Metadata metadata = ImageMetadataReader.readMetadata(file.toFile());
            for (Directory directory : metadata.getDirectories()) {
                for (Tag tag : directory.getTags()) {
                    String name = tag.getTagName().toLowerCase(Locale.ROOT);
                    String value = tag.getDescription();
                    if (value == null || value.isBlank()) {
                        continue;
                    }
                    if (INTERESTING.stream().anyMatch(name::contains)) {
                        findings.add(tag.getTagName() + ": " + value.strip());
                    }
                }
            }
            if (findings.isEmpty()) {
                findings.add("No embedded authorship metadata. Common for exported game assets, "
                        + "but provenance cannot be confirmed from the file alone.");
            }
        } catch (Exception e) {
            // Unreadable or non-media file: fine, this layer just has nothing to say.
            findings.add("No readable embedded metadata for this file type.");
        }
        return findings;
    }
}
