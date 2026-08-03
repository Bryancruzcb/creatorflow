package creatorflow.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.LinkedHashMap;
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
 * The provenance log's honesty properties, asserted rather than trusted to review.
 *
 * <p>Each of these exists because its opposite would be a false-accusation vector:
 * <ul>
 *   <li>no verdict, score, distance or rank field is ever emitted;</li>
 *   <li>a re-share is idempotent, returns the STORED claim, and says so when the request's
 *       declarations differ — a silent 200 would let a changed declaration look recorded;</li>
 *   <li>retract removes the claim from every future lookup, and re-sharing afterwards creates a
 *       genuinely new row (a DB UNIQUE would have made the tombstone a permanent block);</li>
 *   <li>the lookup never filters by {@code algorithmVersion} — the client classifies, so an
 *       unrecognized version can be shown as unknown instead of silently dropped.</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ProvenanceClaimApiTest {

    private static final String FINGERPRINT = "a".repeat(64);
    private static final String OTHER_FINGERPRINT = "b".repeat(64);
    private static final String V1 = "creatorflow.motion-fingerprint/v1";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Test
    void sharingRecordsAnObservationAndNothingResemblingAVerdict() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");

        MvcResult shared = share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201);
        JsonNode claim = readTree(shared).get("claim");

        assertEquals("courier_run", claim.get("clipName").asText());
        assertEquals(V1, claim.get("algorithmVersion").asText());
        assertTrue(claim.get("isYours").asBoolean());
        // The whole point of the schema. If any of these ever appear, the store has started
        // emitting judgements and the honesty ceiling is gone.
        for (String forbidden : new String[]{"verdict", "score", "distance", "rank", "similarity",
                "decision", "status", "outcome", "confidence"}) {
            assertFalse(claim.has(forbidden),
                    "a claim must carry no " + forbidden + " field — a judgement has to stay underivable");
        }
    }

    @Test
    void aRepeatedShareIsIdempotentAndReturnsTheStoredClaim() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");

        long firstId = readTree(share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201))
                .get("claim").get("id").asLong();

        MvcResult repeat = share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 200);
        JsonNode body = readTree(repeat);
        assertEquals(firstId, body.get("claim").get("id").asLong(), "a retry must not create a second row");
        assertTrue(body.get("alreadyShared").asBoolean());
        assertFalse(body.get("declarationsDiffer").asBoolean());
    }

    /**
     * The stale-declaration guard. Re-sharing with different declared text does NOT overwrite an
     * append-only row — it answers with what is actually stored and flags the difference, so the
     * UI can say "already shared — retract to change" instead of implying the new text landed.
     */
    @Test
    void aRepeatedShareWithChangedDeclarationsSaysSoInsteadOfSilentlyDroppingThem() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");
        share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201);

        Map<String, Object> changed = claim(FINGERPRINT, V1, "courier_run");
        changed.put("declaredLicense", "CC-BY-4.0");
        JsonNode body = readTree(share(owner, teamId, changed, 200));

        assertTrue(body.get("declarationsDiffer").asBoolean(),
                "a changed declaration must be reported, not quietly discarded");
        assertTrue(body.get("claim").get("declaredLicense").isNull(),
                "the response must be the STORED claim, not the request's version of it");
    }

    @Test
    void retractRemovesTheClaimFromFutureLookupsAndReSharingCreatesANewRow() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");
        long claimId = readTree(share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201))
                .get("claim").get("id").asLong();

        retract(owner, teamId, claimId, "Wrong clip — shared the wrong export.", 200);
        assertEquals(0, lookup(owner, teamId, FINGERPRINT).size(),
                "a retracted claim must not appear in any future lookup");

        // No DB UNIQUE constraint, so the tombstone does not permanently occupy the key: re-share
        // after retract is the only append-only-consistent way to correct a wrong declaration.
        long reshared = readTree(share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201))
                .get("claim").get("id").asLong();
        assertNotEquals(claimId, reshared, "re-share after retract must create a new row");
        assertEquals(1, lookup(owner, teamId, FINGERPRINT).size());
    }

    @Test
    void retractingTwiceIsANoOpRatherThanAnError() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");
        long claimId = readTree(share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201))
                .get("claim").get("id").asLong();

        retract(owner, teamId, claimId, "First reason.", 200);
        retract(owner, teamId, claimId, "Second reason.", 200);
        assertEquals(0, lookup(owner, teamId, FINGERPRINT).size());
    }

    @Test
    void anOwnerCanRetractSomeoneElsesClaimButAPlainMemberCannot() throws Exception {
        String owner = createAccount("owner");
        String member = createAccount("member");
        String bystander = createAccount("bystander");
        long teamId = createTeam(owner, "Harbor Studio");
        joinTeam(member, mintJoinCode(owner, teamId));
        joinTeam(bystander, mintJoinCode(owner, teamId));

        long claimId = readTree(share(member, teamId, claim(FINGERPRINT, V1, "courier_run"), 201))
                .get("claim").get("id").asLong();

        // A third member cannot silence someone else's record...
        retract(bystander, teamId, claimId, "I do not like it.", 403);
        // ...but the owner is the kill switch's second operator, and can.
        retract(owner, teamId, claimId, "Reported as inaccurate by the subject.", 200);
        assertEquals(0, lookup(owner, teamId, FINGERPRINT).size());
    }

    @Test
    void aRetractNeedsAReason() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");
        long claimId = readTree(share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201))
                .get("claim").get("id").asLong();

        mvc.perform(post("/api/v1/teams/" + teamId + "/provenance-claims/" + claimId + "/retract")
                        .header("X-Api-Key", owner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    /**
     * Rows recorded under a different fingerprint version are RETURNED, not filtered out. The
     * client classifies them ("recorded under a different fingerprint version — not comparable"),
     * which it cannot do for rows the server never sent.
     */
    @Test
    void theLookupNeverFiltersByAlgorithmVersion() throws Exception {
        String owner = createAccount("owner");
        String member = createAccount("member");
        long teamId = createTeam(owner, "Harbor Studio");
        joinTeam(member, mintJoinCode(owner, teamId));

        share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201);
        share(member, teamId, claim(FINGERPRINT, "creatorflow.motion-fingerprint/v2", "courier_run"), 201);

        JsonNode rows = lookup(owner, teamId, FINGERPRINT);
        assertEquals(2, rows.size());
        boolean sawV2 = false;
        for (JsonNode row : rows) {
            if (row.get("algorithmVersion").asText().endsWith("/v2")) sawV2 = true;
        }
        assertTrue(sawV2,
                "a row under another fingerprint version must still be returned for the client to classify");
    }

    @Test
    void claimsAreOrderedByUsernameSoTheOrderImpliesNoPriority() throws Exception {
        String zoe = createAccount("zoe");
        String amir = createAccount("amir");
        long teamId = createTeam(zoe, "Harbor Studio");
        joinTeam(amir, mintJoinCode(zoe, teamId));

        // zoe shares first; amir must still sort first.
        share(zoe, teamId, claim(FINGERPRINT, V1, "courier_run"), 201);
        share(amir, teamId, claim(FINGERPRINT, V1, "courier_run"), 201);

        JsonNode rows = lookup(zoe, teamId, FINGERPRINT);
        assertEquals(2, rows.size());
        assertTrue(rows.get(0).get("memberUsername").asText().startsWith("amir_"),
                "rows must sort by username, not by who recorded first");
    }

    @Test
    void aDepartedMembersClaimsStayInTheRecord() throws Exception {
        String owner = createAccount("owner");
        String leaver = createAccount("leaver");
        long teamId = createTeam(owner, "Harbor Studio");
        joinTeam(leaver, mintJoinCode(owner, teamId));
        share(leaver, teamId, claim(FINGERPRINT, V1, "courier_run"), 201);

        long leaverId = accountIdOf(owner, teamId, "leaver");
        mvc.perform(delete("/api/v1/teams/" + teamId + "/members/" + leaverId)
                        .header("X-Api-Key", leaver))
                .andExpect(status().isNoContent());

        JsonNode rows = lookup(owner, teamId, FINGERPRINT);
        assertEquals(1, rows.size(), "deleting a departed member's observations would rewrite the record");
        assertTrue(rows.get(0).get("memberUsername").asText().startsWith("leaver_"));
    }

    @Test
    void aFingerprintIsNormalizedThenValidated() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");
        share(owner, teamId, claim(FINGERPRINT.toUpperCase(java.util.Locale.ROOT), V1, "courier_run"), 201);

        // Written upper-case, found lower-case: either case is accepted and lowercased, the same
        // shape RegistryController.requireSha has always used.
        assertEquals(1, lookup(owner, teamId, FINGERPRINT).size());

        mvc.perform(get("/api/v1/teams/" + teamId + "/provenance-claims")
                        .header("X-Api-Key", owner)
                        .param("fingerprint", "not-a-fingerprint"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aLookupWithoutAFingerprintIsRefusedRatherThanListingEverything() throws Exception {
        String owner = createAccount("owner");
        long teamId = createTeam(owner, "Harbor Studio");
        share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201);

        mvc.perform(get("/api/v1/teams/" + teamId + "/provenance-claims").header("X-Api-Key", owner))
                .andExpect(status().isBadRequest());

        mvc.perform(get("/api/v1/teams/" + teamId + "/provenance-claims")
                        .header("X-Api-Key", owner)
                        .param("mine", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void anOutsiderCanNeitherLookUpNorShare() throws Exception {
        String owner = createAccount("owner");
        String outsider = createAccount("outsider");
        long teamId = createTeam(owner, "Harbor Studio");
        share(owner, teamId, claim(FINGERPRINT, V1, "courier_run"), 201);

        // 404, not 403: otherwise a non-member could confirm both the team id and, by probing,
        // which fingerprints it holds.
        mvc.perform(get("/api/v1/teams/" + teamId + "/provenance-claims")
                        .header("X-Api-Key", outsider)
                        .param("fingerprint", FINGERPRINT))
                .andExpect(status().isNotFound());
        share(outsider, teamId, claim(OTHER_FINGERPRINT, V1, "sneaky"), 404);
    }

    // --------------------------------------------------------------- helpers

    private static Map<String, Object> claim(String fingerprint, String algorithmVersion, String clipName) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("fingerprint", fingerprint);
        body.put("algorithmVersion", algorithmVersion);
        body.put("clipName", clipName);
        body.put("durationSeconds", 1.25);
        return body;
    }

    private JsonNode readTree(MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString());
    }

    private MvcResult share(String apiKey, long teamId, Map<String, Object> body, int expectedStatus)
            throws Exception {
        return mvc.perform(post("/api/v1/teams/" + teamId + "/provenance-claims")
                        .header("X-Api-Key", apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(body)))
                .andExpect(status().is(expectedStatus))
                .andReturn();
    }

    private void retract(String apiKey, long teamId, long claimId, String reason, int expectedStatus)
            throws Exception {
        mvc.perform(post("/api/v1/teams/" + teamId + "/provenance-claims/" + claimId + "/retract")
                        .header("X-Api-Key", apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("reason", reason))))
                .andExpect(status().is(expectedStatus));
    }

    private JsonNode lookup(String apiKey, long teamId, String fingerprint) throws Exception {
        return readTree(mvc.perform(get("/api/v1/teams/" + teamId + "/provenance-claims")
                        .header("X-Api-Key", apiKey)
                        .param("fingerprint", fingerprint))
                .andExpect(status().isOk())
                .andReturn());
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
