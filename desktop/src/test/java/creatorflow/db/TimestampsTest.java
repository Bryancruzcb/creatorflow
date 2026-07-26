package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class TimestampsTest {

    /** The three widths {@link Instant#toString()} emits for instants one second apart. */
    private static final Instant WHOLE_SECOND = Instant.parse("2026-07-21T02:35:21Z");
    private static final Instant HALF_SECOND_LATER = Instant.parse("2026-07-21T02:35:21.5Z");
    private static final Instant NANOS_LATER = Instant.parse("2026-07-21T02:35:21.397452600Z");

    @Test
    void instantToStringSortsWrongAcrossFractionalWidths() {
        // Pins the bug this class exists to fix: ".5Z" sorts BEFORE "Z" because '.' < 'Z'.
        assertTrue(HALF_SECOND_LATER.toString().compareTo(WHOLE_SECOND.toString()) < 0,
                "expected Instant.toString() to mis-order these — if this fails the JDK changed and "
                        + "the premise of Timestamps should be re-checked");
        assertTrue(HALF_SECOND_LATER.isAfter(WHOLE_SECOND), "…21.5Z really is later than …21Z");
    }

    @Test
    void canonicalTextIsFixedWidthAndSortsChronologically() {
        assertEquals("2026-07-21T02:35:21.000000000Z", Timestamps.text(WHOLE_SECOND));
        assertEquals("2026-07-21T02:35:21.500000000Z", Timestamps.text(HALF_SECOND_LATER));
        assertEquals(Timestamps.text(WHOLE_SECOND).length(), Timestamps.text(NANOS_LATER).length());

        List<Instant> chronological = List.of(WHOLE_SECOND, NANOS_LATER, HALF_SECOND_LATER);
        List<String> lexicographic = new ArrayList<>(chronological.stream().map(Timestamps::text).toList());
        lexicographic.sort(String::compareTo);

        assertEquals(chronological.stream().map(Timestamps::text).toList(), lexicographic,
                "lexicographic order of the canonical text must equal chronological order");
    }

    @Test
    void canonicalTextRoundTripsThroughInstantParse() {
        for (Instant instant : List.of(WHOLE_SECOND, HALF_SECOND_LATER, NANOS_LATER, Instant.EPOCH)) {
            assertEquals(instant, Instant.parse(Timestamps.text(instant)));
        }
    }
}
