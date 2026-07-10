package creatorflow.ui.util;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

/** Display formatting shared across the UI. */
public final class Formats {

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("MMM d, uuuu");

    private Formats() {
    }

    public static String bytes(long bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        }
        double kb = bytes / 1024.0;
        if (kb < 1024) {
            return String.format("%.0f KB", kb);
        }
        double mb = kb / 1024.0;
        if (mb < 1024) {
            return String.format("%.1f MB", mb);
        }
        return String.format("%.2f GB", mb / 1024.0);
    }

    public static String relative(Instant instant) {
        LocalDate then = instant.atZone(ZoneId.systemDefault()).toLocalDate();
        long days = ChronoUnit.DAYS.between(then, LocalDate.now());
        if (days <= 0) {
            return "today";
        }
        if (days == 1) {
            return "yesterday";
        }
        if (days < 30) {
            return days + "d ago";
        }
        return DATE.format(then);
    }

    public static String shortSha(String sha256) {
        return sha256.length() <= 12 ? sha256 : sha256.substring(0, 12) + "…";
    }
}
