package creatorflow.service.opencloud;

import java.util.Optional;

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
     * Resolve a persisted mode id back to an enum, or {@link Optional#empty()} when the id is
     * missing or not one this build knows.
     *
     * <p><strong>Never defaults to {@link #PLAINTEXT}.</strong> The mode is how the stored value is
     * <em>decoded</em>, so assuming plaintext for an unknown label would read DPAPI ciphertext back
     * as the key itself and send it to Roblox verbatim as an {@code x-api-key}. An unidentifiable
     * mode means the value cannot be decoded at all; the caller must degrade to "not configured"
     * (see {@link OpenCloudSettings}) rather than invent a key.
     */
    static Optional<KeyStorageMode> fromId(String id) {
        for (KeyStorageMode mode : values()) {
            if (mode.name().equals(id)) {
                return Optional.of(mode);
            }
        }
        return Optional.empty();
    }
}
