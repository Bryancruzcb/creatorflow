package creatorflow.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * Canonical text form for the timestamp columns.
 *
 * <p>CreatorFlow stores instants as TEXT and orders by those columns directly
 * ({@code ORDER BY created_at DESC}, {@code recorded_at}, {@code checked_at}, …). SQLite compares
 * TEXT lexicographically, so that ordering is only chronological if every value has the
 * <em>same width</em>.
 *
 * <p>{@link Instant#toString()} does not: it omits trailing zeros in the fractional second, so it
 * emits {@code 2026-07-21T02:35:21Z}, {@code …:21.5Z} and {@code …:21.397452600Z} for three
 * instants one second apart. Lexicographically {@code '.'} (0x2E) sorts before {@code 'Z'} (0x5A),
 * so {@code …:21.5Z} sorts BEFORE {@code …:21Z} even though it is 0.5s later — every
 * "latest wins" query (the current decision on an asset, the newest source evidence, the most
 * recent ownership verification) could silently return a stale row. The id tiebreakers those
 * queries carry do not help, because they only apply when the timestamps compare exactly equal.
 *
 * <p>This formatter always writes exactly nine fractional digits, so all values are the same
 * width and lexicographic order is chronological order. Values remain valid ISO-8601 instants and
 * still parse with {@link Instant#parse}.
 */
public final class Timestamps {

    private static final DateTimeFormatter SORTABLE_UTC =
            DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSSSSSSSS'Z'").withZone(ZoneOffset.UTC);

    private Timestamps() {
    }

    /** The canonical, fixed-width, lexicographically sortable text form of {@code instant}. */
    public static String text(Instant instant) {
        return SORTABLE_UTC.format(instant);
    }
}
