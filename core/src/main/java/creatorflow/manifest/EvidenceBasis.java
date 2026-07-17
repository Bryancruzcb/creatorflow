package creatorflow.manifest;

/**
 * The provenance basis for one piece of manifest evidence.
 *
 * <p><strong>Honesty constraint (load-bearing):</strong>
 * <ul>
 *   <li>{@code VERIFIED} means CreatorFlow computed this value itself — a fingerprint match, a
 *       motion score. It does <em>not</em> mean "original", "owned", or "non-infringing"; the
 *       badge/label for this value must never imply originality or ownership.</li>
 *   <li>{@code DECLARED} means a human typed this claim (source/license, a release decision).</li>
 *   <li>{@code NOT_VERIFIED} means CreatorFlow did not or cannot check this condition. This is an
 *       honest "unknown", never a negative verdict.</li>
 * </ul>
 */
public enum EvidenceBasis {
    VERIFIED,
    DECLARED,
    NOT_VERIFIED
}
