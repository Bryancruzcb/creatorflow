package creatorflow.server.service;

import java.util.UUID;

/** Issues the opaque per-account API keys used by desktop and API clients. */
public final class ApiKeys {

    private ApiKeys() {
    }

    public static String newKey() {
        return UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", "");
    }
}
