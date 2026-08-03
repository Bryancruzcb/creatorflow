package creatorflow.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Teams, join codes and the membership rules the provenance log depends on.
 *
 * <p>Three of these are load-bearing rather than routine:
 * <ul>
 *   <li>a join code is shown once and redeemable once;</li>
 *   <li>non-membership answers 404, never 403, so team ids cannot be probed;</li>
 *   <li>the last owner cannot leave — a team with no owner loses the second operator of the
 *       retract kill switch.</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class TeamApiTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Test
    void creatorBecomesOwnerAndSeesTheTeamInTheirList() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");

        mvc.perform(get("/api/v1/teams").header("X-Api-Key", owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value((int) teamId))
                .andExpect(jsonPath("$[0].name").value("Harbor Studio"))
                .andExpect(jsonPath("$[0].role").value("OWNER"))
                .andExpect(jsonPath("$[0].memberCount").value(1));
    }

    @Test
    void aJoinCodeIsReturnedOnceAndRedeemedOnce() throws Exception {
        String owner = createAccount("owner");
        String joiner = createAccount("joiner");
        String second = createAccount("second");
        long teamId = createTeam(owner, "Harbor Studio");

        String code = mintJoinCode(owner, teamId);

        mvc.perform(post("/api/v1/teams/join")
                        .header("X-Api-Key", joiner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("code", code))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value((int) teamId))
                .andExpect(jsonPath("$.role").value("MEMBER"));

        // Single-use: the same code cannot bring a second person in.
        mvc.perform(post("/api/v1/teams/join")
                        .header("X-Api-Key", second)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("code", code))))
                .andExpect(status().isNotFound());
    }

    /** Two mints must never collide, or "single-use" would be a coin flip. */
    @Test
    void everyJoinCodeIsDistinct() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");
        assertNotEquals(mintJoinCode(owner, teamId), mintJoinCode(owner, teamId));
    }

    @Test
    void anUnknownCodeIsIndistinguishableFromAUsedOne() throws Exception {
        String joiner = createAccount("joiner");
        mvc.perform(post("/api/v1/teams/join")
                        .header("X-Api-Key", joiner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("code", "not-a-real-code"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void onlyAnOwnerCanMintAJoinCode() throws Exception {
        String owner = createAccount("owner");
        String member = createAccount("member");
        long teamId = createTeam(owner, "Harbor Studio");
        joinTeam(member, mintJoinCode(owner, teamId));

        mvc.perform(post("/api/v1/teams/" + teamId + "/join-codes").header("X-Api-Key", member))
                .andExpect(status().isForbidden());
    }

    /**
     * The probing rule. An outsider gets the same 404 for a team that exists as for one that never
     * did — a 403 would confirm the id.
     */
    @Test
    void anOutsiderGets404NotForbidden() throws Exception {
        String owner = createAccount("owner");
        String outsider = createAccount("outsider");
        long teamId = createTeam(owner, "Harbor Studio");

        mvc.perform(get("/api/v1/teams/" + teamId + "/members").header("X-Api-Key", outsider))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/teams/999999/members").header("X-Api-Key", outsider))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/teams/" + teamId + "/join-codes").header("X-Api-Key", outsider))
                .andExpect(status().isNotFound());
    }

    @Test
    void membersAreListedByUsername() throws Exception {
        String zoe = createAccount("zoe");
        String amir = createAccount("amir");
        long teamId = createTeam(zoe, "Harbor Studio");
        joinTeam(amir, mintJoinCode(zoe, teamId));

        MvcResult result = mvc.perform(get("/api/v1/teams/" + teamId + "/members").header("X-Api-Key", zoe))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode members = readTree(result);
        assertEquals(2, members.size());
        // Sorted by username, not by join order: ordering must not imply seniority or priority.
        assertTrue(members.get(0).get("username").asText()
                .compareToIgnoreCase(members.get(1).get("username").asText()) < 0,
                "members are not ordered by username");
    }

    @Test
    void theLastOwnerCannotLeave() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");
        long ownerAccountId = accountIdOf(owner, teamId, "owner");

        mvc.perform(delete("/api/v1/teams/" + teamId + "/members/" + ownerAccountId)
                        .header("X-Api-Key", owner))
                .andExpect(status().isConflict());
    }

    @Test
    void aMemberCanLeaveAndAnOwnerCanRemoveThem() throws Exception {
        String owner = createAccount("owner");
        String member = createAccount("member");
        String other = createAccount("other");
        long teamId = createTeam(owner, "Harbor Studio");
        joinTeam(member, mintJoinCode(owner, teamId));
        joinTeam(other, mintJoinCode(owner, teamId));

        long memberId = accountIdOf(owner, teamId, "member");
        long otherId = accountIdOf(owner, teamId, "other");

        // Self-leave.
        mvc.perform(delete("/api/v1/teams/" + teamId + "/members/" + memberId)
                        .header("X-Api-Key", member))
                .andExpect(status().isNoContent());
        // Owner removes someone else.
        mvc.perform(delete("/api/v1/teams/" + teamId + "/members/" + otherId)
                        .header("X-Api-Key", owner))
                .andExpect(status().isNoContent());

        MvcResult result = mvc.perform(get("/api/v1/teams/" + teamId + "/members").header("X-Api-Key", owner))
                .andExpect(status().isOk())
                .andReturn();
        assertEquals(1, readTree(result).size());
    }

    @Test
    void aPlainMemberCannotRemoveSomeoneElse() throws Exception {
        String owner = createAccount("owner");
        String member = createAccount("member");
        String other = createAccount("other");
        long teamId = createTeam(owner, "Harbor Studio");
        joinTeam(member, mintJoinCode(owner, teamId));
        joinTeam(other, mintJoinCode(owner, teamId));

        mvc.perform(delete("/api/v1/teams/" + teamId + "/members/" + accountIdOf(owner, teamId, "other"))
                        .header("X-Api-Key", member))
                .andExpect(status().isForbidden());
    }

    @Test
    void everyTeamRouteNeedsAnApiKey() throws Exception {
        mvc.perform(get("/api/v1/teams")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/teams")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("name", "Nope"))))
                .andExpect(status().isUnauthorized());
    }

    // --------------------------------------------------------------- helpers

    private JsonNode readTree(MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString());
    }

    private String createAccount(String prefix) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of(
                                "username", prefix + "_" + UUID.randomUUID().toString().substring(0, 8)))))
                .andExpect(status().isCreated())
                .andReturn();
        return readTree(result).get("apiKey").asText();
    }

    private long createTeam(String apiKey, String name) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/teams")
                        .header("X-Api-Key", apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("name", name))))
                .andExpect(status().isCreated())
                .andReturn();
        return readTree(result).get("id").asLong();
    }

    private String mintJoinCode(String apiKey, long teamId) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/teams/" + teamId + "/join-codes")
                        .header("X-Api-Key", apiKey))
                .andExpect(status().isCreated())
                .andReturn();
        return readTree(result).get("code").asText();
    }

    private void joinTeam(String apiKey, String code) throws Exception {
        mvc.perform(post("/api/v1/teams/join")
                        .header("X-Api-Key", apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("code", code))))
                .andExpect(status().isOk());
    }

    /** The accountId of the member whose username starts with {@code prefix}. */
    private long accountIdOf(String viewerKey, long teamId, String prefix) throws Exception {
        MvcResult result = mvc.perform(get("/api/v1/teams/" + teamId + "/members")
                        .header("X-Api-Key", viewerKey))
                .andExpect(status().isOk())
                .andReturn();
        for (JsonNode member : readTree(result)) {
            if (member.get("username").asText().startsWith(prefix + "_")) {
                return member.get("accountId").asLong();
            }
        }
        throw new AssertionError("no member whose username starts with " + prefix);
    }
}
