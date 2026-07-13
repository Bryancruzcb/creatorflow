package creatorflow.server;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class MappingApiTest {

    private static final String SHA_A = "a".repeat(64);

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Test
    void addListAndUpsertMappings() throws Exception {
        String key = createAccount();
        long assetId = registerAsset(key, "walk_cycle", SHA_A);

        putMapping(key, assetId, "User:98765", 111L)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.context").value("user:98765"))
                .andExpect(jsonPath("$.robloxAssetId").value(111));

        putMapping(key, assetId, "group:12345", 222L)
                .andExpect(status().isCreated());

        mvc.perform(get("/api/v1/assets/" + assetId + "/mappings").header("X-Api-Key", key))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].context").value("group:12345"))
                .andExpect(jsonPath("$[1].context").value("user:98765"));

        // re-upload under the group: same context replaces the id instead of duplicating
        putMapping(key, assetId, "group:12345", 333L)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.robloxAssetId").value(333));

        mvc.perform(get("/api/v1/assets/" + assetId + "/mappings").header("X-Api-Key", key))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].robloxAssetId").value(333));
    }

    @Test
    void mappings_areInvisibleToOtherAccounts() throws Exception {
        String owner = createAccount();
        long assetId = registerAsset(owner, "walk_cycle", SHA_A);
        putMapping(owner, assetId, "group:12345", 222L).andExpect(status().isCreated());

        String stranger = createAccount();
        mvc.perform(get("/api/v1/assets/" + assetId + "/mappings").header("X-Api-Key", stranger))
                .andExpect(status().isNotFound());
        putMapping(stranger, assetId, "group:12345", 999L)
                .andExpect(status().isNotFound());
    }

    @Test
    void rejectsInvalidInput() throws Exception {
        String key = createAccount();
        long assetId = registerAsset(key, "walk_cycle", SHA_A);

        putMapping(key, assetId, "  ", 111L).andExpect(status().isBadRequest());
        putMapping(key, assetId, "group:12345", 0L).andExpect(status().isBadRequest());
        putMapping(key, assetId, "x".repeat(81), 111L).andExpect(status().isBadRequest());
        putMapping(key, 999_999L, "group:12345", 111L).andExpect(status().isNotFound());
    }

    private org.springframework.test.web.servlet.ResultActions putMapping(
            String apiKey, long assetId, String context, long robloxAssetId) throws Exception {
        return mvc.perform(post("/api/v1/assets/" + assetId + "/mappings")
                .header("X-Api-Key", apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(
                        Map.of("context", context, "robloxAssetId", robloxAssetId))));
    }

    private String createAccount() throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(
                                Map.of("username", "user_" + UUID.randomUUID().toString().substring(0, 8)))))
                .andExpect(status().isCreated())
                .andReturn();
        return json.readTree(result.getResponse().getContentAsString()).get("apiKey").asText();
    }

    private long registerAsset(String apiKey, String fileName, String sha256) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("fileName", fileName);
        body.put("fileType", "roblox-animation");
        body.put("sizeBytes", 1234);
        body.put("sha256", sha256);
        body.put("license", "Team-internal");
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
