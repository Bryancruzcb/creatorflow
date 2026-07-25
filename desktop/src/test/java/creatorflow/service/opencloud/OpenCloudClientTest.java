package creatorflow.service.opencloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import creatorflow.ownership.GroupMembership;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * {@link OpenCloudClient} is the only component that talks to Roblox. These tests drive it against
 * a local {@link HttpServer} stub returning the exact response bodies observed in the Task 0 spike
 * note — never the live API. They pin the field paths, the bare-userId vs. users/{id}-path
 * asymmetry, the empty-membership-list "not a member" shape, the 404 shape, 429 -> a dedicated
 * {@link RateLimitedException}, other 4xx -> {@link OpenCloudException} with the status, and the
 * {@code x-api-key} header.
 *
 * <p>The membership tests also pin the tri-state contract: the spike note (line 48) records that the
 * membership-<em>entry</em> shape was never observed live, so every way the rank can fail to resolve
 * is exercised and must yield {@code MEMBER_RANK_UNKNOWN} — only an empty list is "not a member".
 */
class OpenCloudClientTest {

    @TempDir
    Path dir;

    private static final String API_KEY = "oc-test-key-abc123";

    private HttpServer server;
    private String baseUrl;
    private final List<String> sentApiKeys = new CopyOnWriteArrayList<>();

    // ---- exact bodies from the spike note ---------------------------------------------------

    private static final String ASSET_USER_CREATOR = """
            {
              "path": "assets/507766388",
              "revisionId": "17",
              "revisionCreateTime": "2026-06-23T20:14:26.688Z",
              "assetId": "507766388",
              "displayName": "R15Idle",
              "description": "R15Idle",
              "assetType": "Animation",
              "creationContext": { "creator": { "userId": "1" } },
              "moderationResult": { "moderationState": "Approved" },
              "state": "Active"
            }
            """;

    // group-created asset: spike says the client must handle creator.groupId too (inferred shape)
    private static final String ASSET_GROUP_CREATOR = """
            {
              "path": "assets/900001",
              "assetId": "900001",
              "assetType": "Animation",
              "creationContext": { "creator": { "groupId": "295182" } },
              "moderationResult": { "moderationState": "Reviewing" },
              "state": "Active"
            }
            """;

    private static final String ASSET_NOT_FOUND = """
            {"code":"NOT_FOUND","message":"AssetId 999 is not found"}
            """;

    private static final String UNIVERSE_USER_OWNER = """
            {
              "path": "universes/90110",
              "id": "90110",
              "user": "users/82914",
              "rootPlace": "universes/90110/places/1818"
            }
            """;

    private static final String UNIVERSE_GROUP_OWNER = """
            {
              "path": "universes/383310974",
              "id": "383310974",
              "group": "groups/295182",
              "rootPlace": "universes/383310974/places/9999"
            }
            """;

    // membership entry shape when a member: docs say entries carry user + role resource paths
    private static final String MEMBERSHIP_IS_MEMBER = """
            {
              "groupMemberships": [
                {
                  "path": "groups/295182/memberships/ABC",
                  "createTime": "2024-01-01T00:00:00Z",
                  "updateTime": "2024-01-01T00:00:00Z",
                  "user": "users/82914",
                  "role": "groups/295182/roles/98765"
                }
              ],
              "nextPageToken": ""
            }
            """;

    // a real member, but the entry carries no role reference at all
    private static final String MEMBERSHIP_MEMBER_NO_ROLE_FIELD = """
            {
              "groupMemberships": [
                {
                  "path": "groups/295182/memberships/ABC",
                  "user": "users/82914"
                }
              ],
              "nextPageToken": ""
            }
            """;

    // a real member, but "role" is an object rather than the documented resource-path string.
    // The spike note (line 48) never observed this entry shape live, so a divergence is a live risk.
    private static final String MEMBERSHIP_MEMBER_ROLE_OBJECT = """
            {
              "groupMemberships": [
                {
                  "path": "groups/295182/memberships/ABC",
                  "user": "users/82914",
                  "role": { "path": "groups/295182/roles/98765", "id": "98765" }
                }
              ],
              "nextPageToken": ""
            }
            """;

    // empty list = NOT a member (a 200, not an error)
    private static final String MEMBERSHIP_NOT_MEMBER = """
            {"groupMemberships":[],"nextPageToken":""}
            """;

    private static final String GROUP_ROLES = """
            {
              "groupRoles": [
                {"path":"groups/295182/roles/12","id":"12","displayName":"Guest","rank":0,"memberCount":100},
                {"path":"groups/295182/roles/98765","id":"98765","displayName":"Builder","rank":150,"memberCount":5}
              ],
              "nextPageToken": ""
            }
            """;

    // the member's role id (98765) is NOT in this listing — e.g. the role was deleted between the
    // memberships call and the roles call
    private static final String GROUP_ROLES_WITHOUT_THE_MEMBERS_ROLE = """
            {
              "groupRoles": [
                {"path":"groups/295182/roles/12","id":"12","displayName":"Guest","rank":0,"memberCount":100}
              ],
              "nextPageToken": ""
            }
            """;

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopStub() {
        server.stop(0);
    }

    // ---- getAsset ---------------------------------------------------------------------------

    @Test
    void getAssetParsesUserCreatorAssetTypeAndModeration() throws IOException {
        stub("/assets/v1/assets/507766388", 200, ASSET_USER_CREATOR);

        OpenCloudClient.AssetInfo asset = client().getAsset(507766388L);

        assertEquals("USER", asset.creatorType());
        assertEquals(1L, asset.creatorId());
        assertEquals("Animation", asset.assetType());
        assertEquals("Approved", asset.moderationState());
        assertEquals("Active", asset.state());
    }

    @Test
    void getAssetParsesGroupCreator() throws IOException {
        stub("/assets/v1/assets/900001", 200, ASSET_GROUP_CREATOR);

        OpenCloudClient.AssetInfo asset = client().getAsset(900001L);

        assertEquals("GROUP", asset.creatorType());
        assertEquals(295182L, asset.creatorId());
        assertEquals("Reviewing", asset.moderationState());
    }

    @Test
    void getAssetSendsApiKeyHeader() throws IOException {
        stub("/assets/v1/assets/507766388", 200, ASSET_USER_CREATOR);

        client().getAsset(507766388L);

        assertEquals(1, sentApiKeys.size());
        assertEquals(API_KEY, sentApiKeys.get(0), "the x-api-key header must carry the configured key");
    }

    @Test
    void getAssetOn404ThrowsOpenCloudExceptionWithStatusAndMessage() throws IOException {
        stub("/assets/v1/assets/999", 404, ASSET_NOT_FOUND);

        OpenCloudException thrown = assertThrows(OpenCloudException.class, () -> client().getAsset(999L));
        assertEquals(404, thrown.status());
        assertTrue(thrown.getMessage().contains("not found"), thrown.getMessage());
    }

    @Test
    void getAssetOn401ThrowsOpenCloudExceptionWithStatus() throws IOException {
        stub("/assets/v1/assets/1", 401, "{\"code\":\"UNAUTHENTICATED\",\"message\":\"missing key\"}");

        OpenCloudException thrown = assertThrows(OpenCloudException.class, () -> client().getAsset(1L));
        assertEquals(401, thrown.status());
        assertFalse(thrown instanceof RateLimitedException, "401 is not a rate-limit");
    }

    @Test
    void getAssetOn403ThrowsOpenCloudExceptionWithStatus() throws IOException {
        stub("/assets/v1/assets/2", 403, "{\"code\":\"PERMISSION_DENIED\",\"message\":\"no scope\"}");

        OpenCloudException thrown = assertThrows(OpenCloudException.class, () -> client().getAsset(2L));
        assertEquals(403, thrown.status());
    }

    @Test
    void getAssetOn429ThrowsRateLimitedException() throws IOException {
        server.createContext("/assets/v1/assets/3", exchange -> {
            exchange.getResponseHeaders().add("Retry-After", "30");
            respond(exchange, 429, "{\"code\":\"RESOURCE_EXHAUSTED\",\"message\":\"slow down\"}");
        });

        RateLimitedException thrown = assertThrows(RateLimitedException.class, () -> client().getAsset(3L));
        assertEquals(429, thrown.status());
        assertEquals(Optional.of(java.time.Duration.ofSeconds(30)), Optional.ofNullable(thrown.retryAfter()));
    }

    // ---- getUniverse ------------------------------------------------------------------------

    @Test
    void getUniverseParsesUserOwnerFromPathString() throws IOException {
        stub("/cloud/v2/universes/90110", 200, UNIVERSE_USER_OWNER);

        OpenCloudClient.UniverseOwner owner = client().getUniverse(90110L);

        assertEquals("USER", owner.ownerType());
        assertEquals(82914L, owner.ownerId());
    }

    @Test
    void getUniverseParsesGroupOwnerFromPathString() throws IOException {
        stub("/cloud/v2/universes/383310974", 200, UNIVERSE_GROUP_OWNER);

        OpenCloudClient.UniverseOwner owner = client().getUniverse(383310974L);

        assertEquals("GROUP", owner.ownerType());
        assertEquals(295182L, owner.ownerId());
    }

    // ---- groupMembership --------------------------------------------------------------------

    @Test
    void groupMembershipReturnsTheMembersRoleRank() throws IOException {
        stub("/cloud/v2/groups/295182/memberships", 200, MEMBERSHIP_IS_MEMBER);
        stub("/cloud/v2/groups/295182/roles", 200, GROUP_ROLES);

        GroupMembership membership = client().groupMembership(295182L, 82914L);

        assertEquals(GroupMembership.Status.MEMBER_RANK_KNOWN, membership.status());
        assertEquals(150, membership.rank());
    }

    @Test
    void groupMembershipIsNotAMemberOnlyWhenTheMembershipListIsEmpty() throws IOException {
        stub("/cloud/v2/groups/295182/memberships", 200, MEMBERSHIP_NOT_MEMBER);

        GroupMembership membership = client().groupMembership(295182L, 111L);

        assertEquals(GroupMembership.Status.NOT_A_MEMBER, membership.status(),
                "an empty membership list means not-a-member, not an error");
        assertFalse(membership.isMember());
    }

    @Test
    void groupMembershipRefusesToCallAnUnreadableResponseNotAMember() {
        // No groupMemberships field at all — NOT the 200-with-empty-list shape the spike note
        // observed. We did not observe an absence, so we must not claim one; an unreadable response
        // is a failed lookup, which OwnershipVerifier folds into UNVERIFIABLE.
        stub("/cloud/v2/groups/295182/memberships", 200, "{\"nextPageToken\":\"\"}");

        assertThrows(IOException.class, () -> client().groupMembership(295182L, 111L),
                "a missing memberships array is an unreadable response, not a confirmed absence");
    }

    // An observed membership entry whose RANK cannot be resolved must degrade to MEMBER_RANK_UNKNOWN.
    // Collapsing these into "not a member" would let CreatorFlow publish a VERIFIED MISMATCH against
    // a real group member — a false accusation, the worst possible output.

    @Test
    void groupMembershipWithNoRoleFieldIsMemberWithUnknownRank() throws IOException {
        stub("/cloud/v2/groups/295182/memberships", 200, MEMBERSHIP_MEMBER_NO_ROLE_FIELD);
        stub("/cloud/v2/groups/295182/roles", 200, GROUP_ROLES);

        GroupMembership membership = client().groupMembership(295182L, 82914L);

        assertEquals(GroupMembership.Status.MEMBER_RANK_UNKNOWN, membership.status(),
                "a missing role field hides the rank; it does not disprove membership");
        assertTrue(membership.isMember());
        assertNull(membership.rank());
    }

    @Test
    void groupMembershipWithAnUnexpectedRoleShapeIsMemberWithUnknownRank() throws IOException {
        stub("/cloud/v2/groups/295182/memberships", 200, MEMBERSHIP_MEMBER_ROLE_OBJECT);
        stub("/cloud/v2/groups/295182/roles", 200, GROUP_ROLES);

        GroupMembership membership = client().groupMembership(295182L, 82914L);

        assertEquals(GroupMembership.Status.MEMBER_RANK_UNKNOWN, membership.status(),
                "the entry shape was never observed live; a divergence must read as unknown, not absent");
        assertTrue(membership.isMember());
        assertNull(membership.rank());
    }

    @Test
    void groupMembershipWithARoleMissingFromTheRolesListingIsMemberWithUnknownRank() throws IOException {
        stub("/cloud/v2/groups/295182/memberships", 200, MEMBERSHIP_IS_MEMBER);
        stub("/cloud/v2/groups/295182/roles", 200, GROUP_ROLES_WITHOUT_THE_MEMBERS_ROLE);

        GroupMembership membership = client().groupMembership(295182L, 82914L);

        assertEquals(GroupMembership.Status.MEMBER_RANK_UNKNOWN, membership.status(),
                "a role deleted between the two calls hides the rank; membership was still observed");
        assertTrue(membership.isMember());
        assertNull(membership.rank());
    }

    @Test
    void groupMembershipIsMemberWithUnknownRankWhenRolePagingHitsTheCap() throws IOException {
        stub("/cloud/v2/groups/295182/memberships", 200, MEMBERSHIP_IS_MEMBER);
        AtomicInteger rolePages = new AtomicInteger();
        // every page hands back another token and never the member's role -> the cap is reached
        server.createContext("/cloud/v2/groups/295182/roles", exchange -> {
            rolePages.incrementAndGet();
            respond(exchange, 200, """
                    {"groupRoles":[{"path":"groups/295182/roles/12","id":"12","rank":0}],
                     "nextPageToken":"more"}
                    """);
        });

        GroupMembership membership = client().groupMembership(295182L, 82914L);

        assertEquals(GroupMembership.Status.MEMBER_RANK_UNKNOWN, membership.status(),
                "exhausting the paging cap hides the rank; it does not disprove membership");
        assertTrue(membership.isMember());
        assertNull(membership.rank());
        assertEquals(OpenCloudClient.MAX_ROLE_PAGES, rolePages.get(), "the page loop stays bounded");
    }

    // ---- isConfigured -----------------------------------------------------------------------

    @Test
    void isConfiguredDelegatesToSettings() {
        OpenCloudSettings unconfigured = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        assertFalse(new OpenCloudClient(unconfigured, baseUrl).isConfigured());

        OpenCloudSettings configured = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        configured.save(API_KEY);
        assertTrue(new OpenCloudClient(configured, baseUrl).isConfigured());
    }

    // ---- testConnection ---------------------------------------------------------------------

    @Test
    void testConnectionReportsOkWhenTheProbeAssetLoads() {
        stub("/assets/v1/assets/507766388", 200, ASSET_USER_CREATOR);
        assertEquals(OpenCloudClient.ConnectionStatus.OK, client().testConnection());
    }

    @Test
    void testConnectionReportsKeyRejectedOn401() {
        stub("/assets/v1/assets/507766388", 401, "{\"code\":\"UNAUTHENTICATED\",\"message\":\"missing key\"}");
        assertEquals(OpenCloudClient.ConnectionStatus.KEY_REJECTED, client().testConnection());
    }

    @Test
    void testConnectionReportsRateLimitedOn429() {
        server.createContext("/assets/v1/assets/507766388", exchange -> {
            exchange.getResponseHeaders().add("Retry-After", "30");
            respond(exchange, 429, "{\"code\":\"RESOURCE_EXHAUSTED\",\"message\":\"slow down\"}");
        });
        assertEquals(OpenCloudClient.ConnectionStatus.RATE_LIMITED, client().testConnection());
    }

    @Test
    void unknownUniverseOwnerYieldsNullOwner() throws IOException {
        stub("/cloud/v2/universes/5", 200, "{\"path\":\"universes/5\",\"id\":\"5\"}");

        OpenCloudClient.UniverseOwner owner = client().getUniverse(5L);

        assertNull(owner.ownerType());
        assertNull(owner.ownerId());
    }

    // ---- helpers ----------------------------------------------------------------------------

    private OpenCloudClient client() {
        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        settings.save(API_KEY);
        return new OpenCloudClient(settings, baseUrl);
    }

    private void stub(String path, int status, String body) {
        server.createContext(path, exchange -> {
            sentApiKeys.add(exchange.getRequestHeaders().getFirst("x-api-key"));
            respond(exchange, status, body);
        });
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
