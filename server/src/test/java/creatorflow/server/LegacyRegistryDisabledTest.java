package creatorflow.server;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * The default posture: no similarity judge. The test resources deliberately
 * leave {@code creatorflow.legacy-registry.enabled} unset, so this exercises the
 * {@code matchIfMissing = false} path the shipped default depends on: the legacy
 * beans are never created and the routes the frozen Rojo plugin and the desktop
 * {@code HttpRegistryClient} call are simply not there — the server is
 * structurally incapable of returning a copied/not-copied verdict. Accounts and
 * health stay up, because the team layer needs them.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LegacyRegistryDisabledTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ApplicationContext context;

    @Autowired
    private ObjectMapper json;

    @Test
    void legacyBeans_areAbsent_byDefault() {
        assertFalse(context.containsBean("registryService"), "RegistryService must not be created");
        assertFalse(context.containsBean("registryController"), "RegistryController must not be created");
        assertFalse(context.containsBean("mappingController"), "MappingController must not be created");
    }

    /** A valid key gets 404, not 401 — the routes are absent, not merely guarded. */
    @Test
    void legacyRoutes_areGone_butAccountsAndHealthRemain() throws Exception {
        String key = createAccount();

        mvc.perform(post("/api/v1/verify")
                        .header("X-Api-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("sha256", "a".repeat(64)))))
                .andExpect(status().isNotFound());

        mvc.perform(get("/api/v1/assets/mine").header("X-Api-Key", key))
                .andExpect(status().isNotFound());

        mvc.perform(post("/api/v1/assets/1/mappings")
                        .header("X-Api-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(
                                Map.of("context", "group:12345", "robloxAssetId", 111))))
                .andExpect(status().isNotFound());

        mvc.perform(get("/api/v1/health")).andExpect(status().isOk());
    }

    /**
     * With {@code spring.web.resources.add-mappings=false} an unmatched path
     * reaches no handler at all, so it cannot fall through to the static-resource
     * handler mapped at {@code /**} — which would run behind
     * {@code SecurityConfig}'s deny-by-default rule and serve whatever a
     * classpath resource happened to sit at. Even a bogus key gets a plain 404.
     */
    @Test
    void unmatchedApiPaths_reachNoHandler_ratherThanTheStaticResourceHandler() throws Exception {
        mvc.perform(get("/api/v1/assets/mine").header("X-Api-Key", "not-a-real-key"))
                .andExpect(status().isNotFound());

        mvc.perform(get("/api/v1/no/such/route")).andExpect(status().isNotFound());
    }

    private String createAccount() throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of(
                                "username", "user_" + UUID.randomUUID().toString().substring(0, 8)))))
                .andExpect(status().isCreated())
                .andReturn();
        return json.readTree(result.getResponse().getContentAsString()).get("apiKey").asText();
    }
}
