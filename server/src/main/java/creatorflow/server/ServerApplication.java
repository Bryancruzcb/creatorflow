package creatorflow.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * CreatorFlow's self-hosted team provenance store.
 *
 * <p>One question, one answer: which members of <em>your team</em> recorded this exact 64-hex
 * motion curve fingerprint. Clients never upload files, curves or scan paths — a claim is a
 * fingerprint plus what a person chose to declare about it.
 *
 * <p>What this server deliberately cannot do: emit a verdict. There is no score, distance,
 * ranking or decision field anywhere in the schema, and the pre-redirect similarity judge
 * ({@code /verify}, {@code /assets*}, mappings) is created only when
 * {@code creatorflow.legacy-registry.enabled=true} — off by default, kept solely so the frozen
 * Rojo plugin does not break silently.
 *
 * <p>Run it on a studio LAN or a member's box. There is no TLS, proxy config or multi-tenancy
 * here; see {@code server/README.md}.
 */
@SpringBootApplication
public class ServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(ServerApplication.class, args);
    }
}
