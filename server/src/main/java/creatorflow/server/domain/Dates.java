package creatorflow.server.domain;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Human dates for templates ("11 Jul 2026"). */
final class Dates {

    private static final DateTimeFormatter DISPLAY =
            DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
                    .withZone(ZoneId.systemDefault());

    private Dates() {
    }

    static String display(Instant instant) {
        return instant == null ? "" : DISPLAY.format(instant);
    }
}
