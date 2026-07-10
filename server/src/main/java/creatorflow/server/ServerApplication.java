package creatorflow.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * CreatorFlow's shared fingerprint registry.
 *
 * <p>Clients never upload files — only fingerprints (SHA-256, perceptual image
 * hashes, audio fingerprint). Verification compares those against every
 * account's registered assets using the exact same engine code the desktop
 * app runs locally ({@code creatorflow-core}).
 */
@SpringBootApplication
public class ServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(ServerApplication.class, args);
    }
}
