package creatorflow.service.opencloud;

/**
 * How an Open Cloud API key is protected where it is stored on disk.
 *
 * <p>The mode is persisted alongside the key so a reload knows how to decode it, and it is
 * surfaced in the Settings UI so the user is told the truth about their key's protection —
 * never a reassuring label that the platform can't back up.
 */
public enum KeyStorageMode {

    /**
     * Windows DPAPI ({@code CryptProtectData}). The key is stored as base64 ciphertext bound to
     * the current Windows user account — it cannot be read by another user or on another machine.
     */
    DPAPI_WINDOWS("encrypted (Windows DPAPI)"),

    /**
     * No OS credential protection is available on this platform, so the key is stored as
     * plaintext. The label makes this explicit rather than implying a protection that isn't there.
     */
    PLAINTEXT("not encrypted on this OS");

    private final String label;

    KeyStorageMode(String label) {
        this.label = label;
    }

    /** Human-readable, honest description of the at-rest protection, for the Settings UI. */
    public String label() {
        return label;
    }

    /**
     * Resolve a persisted mode id back to an enum, tolerating an unknown or missing value by
     * assuming {@link #PLAINTEXT} — the safe reading, since it never claims encryption that
     * wasn't applied.
     */
    static KeyStorageMode fromId(String id) {
        for (KeyStorageMode mode : values()) {
            if (mode.name().equals(id)) {
                return mode;
            }
        }
        return PLAINTEXT;
    }
}
