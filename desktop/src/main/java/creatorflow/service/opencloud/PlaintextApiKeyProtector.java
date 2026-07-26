package creatorflow.service.opencloud;

/**
 * The fallback protector for platforms without an OS credential facility CreatorFlow uses: the key
 * is stored as-is. Paired with {@link KeyStorageMode#PLAINTEXT} so the UI states plainly that the
 * key is not encrypted here — the honesty invariant forbids implying protection that isn't applied.
 */
final class PlaintextApiKeyProtector implements ApiKeyProtector {

    @Override
    public KeyStorageMode mode() {
        return KeyStorageMode.PLAINTEXT;
    }

    @Override
    public String protect(String plaintext) {
        return plaintext;
    }

    @Override
    public String unprotect(String stored) {
        return stored;
    }
}
