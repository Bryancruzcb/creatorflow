package creatorflow.manifest;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** CI-oriented release gate with stable JSON output and documented process exit codes. */
public final class ReleaseGateCli {

    private static final ObjectMapper JSON = JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .serializationInclusion(JsonInclude.Include.ALWAYS)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .enable(SerializationFeature.INDENT_OUTPUT)
            .build();

    private ReleaseGateCli() {
    }

    public static void main(String[] args) {
        System.exit(run(args, System.out, System.err));
    }

    /** Testable entry point: 0 passes, 2 is policy-blocked, and 3 is invalid input/execution failure. */
    public static int run(String[] args, PrintStream out, PrintStream err) {
        if (args.length != 1 && !(args.length == 3 && "--output".equals(args[1]))) {
            writeJson(out, new ErrorReport("creatorflow.gate-error/v0.1", 3,
                    "Usage: ReleaseGateCli <manifest.json> [--output <report.json>]"));
            return 3;
        }

        try {
            CreativeManifest manifest = new ManifestJson().read(Path.of(args[0]));
            ReleaseGate.Report report = new ReleaseGate().evaluate(manifest);
            String json = JSON.writeValueAsString(report) + "\n";
            out.print(json);
            if (args.length == 3) writeOutput(Path.of(args[2]), json);
            return report.passed() ? 0 : 2;
        } catch (Exception failure) {
            String message = failure.getMessage();
            if (message == null || message.isBlank()) message = failure.getClass().getSimpleName();
            writeJson(out, new ErrorReport("creatorflow.gate-error/v0.1", 3, message));
            err.println("CreatorFlow release gate could not evaluate the manifest.");
            return 3;
        }
    }

    private static void writeOutput(Path output, String json) throws IOException {
        Path normalized = output.toAbsolutePath().normalize();
        Path parent = normalized.getParent();
        if (parent != null) Files.createDirectories(parent);
        Files.writeString(normalized, json, StandardCharsets.UTF_8);
    }

    private static void writeJson(PrintStream out, Object value) {
        try {
            out.println(JSON.writeValueAsString(value));
        } catch (IOException impossible) {
            out.println("{\"schema\":\"creatorflow.gate-error/v0.1\",\"exitCode\":3,\"error\":\"JSON serialization failed\"}");
        }
    }

    @JsonPropertyOrder({"schema", "exitCode", "error"})
    private record ErrorReport(String schema, int exitCode, String error) {
    }
}
