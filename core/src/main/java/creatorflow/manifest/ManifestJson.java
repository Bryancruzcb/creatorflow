package creatorflow.manifest;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Deterministic JSON serialization and re-import for {@link CreativeManifest}. */
public final class ManifestJson {

    public static final long MAX_INPUT_BYTES = 25L * 1024L * 1024L;

    private final ObjectMapper mapper = JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .serializationInclusion(JsonInclude.Include.ALWAYS)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .enable(SerializationFeature.INDENT_OUTPUT)
            .build();

    public String write(CreativeManifest manifest) throws IOException {
        return mapper.writeValueAsString(manifest) + "\n";
    }

    public void write(Path output, CreativeManifest manifest) throws IOException {
        Path parent = output.toAbsolutePath().normalize().getParent();
        if (parent != null) Files.createDirectories(parent);
        Files.writeString(output, write(manifest), StandardCharsets.UTF_8);
    }

    public CreativeManifest read(String json) throws IOException {
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_INPUT_BYTES) {
            throw new IOException("Manifest exceeds the 25 MB import limit");
        }
        return mapper.readValue(json, CreativeManifest.class);
    }

    public CreativeManifest read(Path input) throws IOException {
        if (Files.size(input) > MAX_INPUT_BYTES) {
            throw new IOException("Manifest exceeds the 25 MB import limit: " + input);
        }
        return read(Files.readString(input, StandardCharsets.UTF_8));
    }
}
