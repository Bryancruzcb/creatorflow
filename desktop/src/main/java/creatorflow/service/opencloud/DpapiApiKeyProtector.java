package creatorflow.service.opencloud;

import com.sun.jna.platform.win32.Crypt32Util;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Protects the API key with Windows DPAPI ({@code CryptProtectData}) so it is ciphertext at rest,
 * bound to the current Windows user account. The ciphertext is base64-encoded for storage in a
 * plain properties file.
 *
 * <p>This class only loads on Windows; {@link ApiKeyProtector#forCurrentOs()} never selects it
 * elsewhere, so the JNA native library is not touched off-Windows.
 */
final class DpapiApiKeyProtector implements ApiKeyProtector {

    @Override
    public KeyStorageMode mode() {
        return KeyStorageMode.DPAPI_WINDOWS;
    }

    @Override
    public String protect(String plaintext) {
        byte[] ciphertext = Crypt32Util.cryptProtectData(plaintext.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(ciphertext);
    }

    @Override
    public String unprotect(String stored) {
        byte[] ciphertext = Base64.getDecoder().decode(stored);
        byte[] plaintext = Crypt32Util.cryptUnprotectData(ciphertext);
        return new String(plaintext, StandardCharsets.UTF_8);
    }
}
