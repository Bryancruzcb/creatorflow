package creatorflow.server;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

/** The legacy registry judge, exercised with its flag forced on. */
@SpringBootTest(properties = "creatorflow.legacy-registry.enabled=true")
@AutoConfigureMockMvc
@Transactional
class RegistryApiTest {

    private static final String SHA_A = "a".repeat(64);
    private static final String SHA_B = "b".repeat(64);
    private static final String SHA_C = "c".repeat(64);

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Test
    void accountCreation_returnsKey_andRejectsDuplicates() throws Exception {
        String name = uniqueName();
        mvc.perform(post("/api/v1/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("username", name))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value(name))
                .andExpect(jsonPath("$.apiKey").isNotEmpty());

        mvc.perform(post("/api/v1/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("username", name.toUpperCase()))))
                .andExpect(status().isConflict());
    }

    @Test
    void protectedEndpoints_require_apiKey() throws Exception {
        mvc.perform(post("/api/v1/verify")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("sha256", SHA_A))))
                .andExpect(status().isUnauthorized());

        mvc.perform(get("/api/v1/assets/mine").header("X-Api-Key", "nope"))
                .andExpect(status().isUnauthorized());

        mvc.perform(get("/api/v1/health")).andExpect(status().isOk());
    }

    @Test
    void registerAndListAssets() throws Exception {
        String key = createAccount();
        registerAsset(key, "hero_sprite.png", SHA_A, 100L, 200L, null);

        mvc.perform(get("/api/v1/assets/mine").header("X-Api-Key", key))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].fileName").value("hero_sprite.png"))
                .andExpect(jsonPath("$[0].sha256").value(SHA_A));
    }

    @Test
    void verify_flagsExactDuplicate_acrossAccounts() throws Exception {
        String owner = createAccount();
        registerAsset(owner, "original.png", SHA_A, 100L, 200L, null);

        String uploader = createAccount();
        mvc.perform(post("/api/v1/verify")
                        .header("X-Api-Key", uploader)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("sha256", SHA_A))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verdict").value("DUPLICATE"))
                .andExpect(jsonPath("$.matches", hasSize(1)))
                .andExpect(jsonPath("$.matches[0].layer").value("sha256"))
                .andExpect(jsonPath("$.matches[0].distance").value(0));
    }

    @Test
    void verify_flagsPerceptuallySimilarImage() throws Exception {
        String owner = createAccount();
        long pHash = 0b1010_1100_0011L;
        registerAsset(owner, "artwork.png", SHA_A, 9999L, pHash, null);

        String uploader = createAccount();
        long nearPHash = pHash ^ 0b101L; // 2 bits flipped => Hamming distance 2
        Map<String, Object> body = new HashMap<>();
        body.put("sha256", SHA_B);
        body.put("dHash", 123456789L);
        body.put("pHash", nearPHash);
        mvc.perform(post("/api/v1/verify")
                        .header("X-Api-Key", uploader)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verdict").value("SIMILAR"))
                .andExpect(jsonPath("$.matches[0].layer").value("phash"))
                .andExpect(jsonPath("$.matches[0].distance").value(2));
    }

    @Test
    void verify_clearWhenNothingMatches() throws Exception {
        String key = createAccount();
        registerAsset(key, "artwork.png", SHA_A, 0L, 0L, null);

        Map<String, Object> body = new HashMap<>();
        body.put("sha256", SHA_C);
        body.put("dHash", ~0L);
        body.put("pHash", ~0L);
        mvc.perform(post("/api/v1/verify")
                        .header("X-Api-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verdict").value("CLEAR"))
                .andExpect(jsonPath("$.matches", hasSize(0)));
    }

    private String uniqueName() {
        return "user_" + UUID.randomUUID().toString().substring(0, 8);
    }

    private String createAccount() throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("username", uniqueName()))))
                .andExpect(status().isCreated())
                .andReturn();
        return json.readTree(result.getResponse().getContentAsString()).get("apiKey").asText();
    }

    private long registerAsset(String apiKey, String fileName, String sha256,
                               Long dHash, Long pHash, Long audioFp) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("fileName", fileName);
        body.put("fileType", "png");
        body.put("sizeBytes", 1234);
        body.put("sha256", sha256);
        body.put("dHash", dHash);
        body.put("pHash", pHash);
        body.put("audioFp", audioFp);
        body.put("license", "All rights reserved");
        body.put("ownershipDeclared", true);
        MvcResult result = mvc.perform(post("/api/v1/assets")
                        .header("X-Api-Key", apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode node = json.readTree(result.getResponse().getContentAsString());
        return node.get("id").asLong();
    }
}
