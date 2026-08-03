package creatorflow.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.server.domain.Team;
import creatorflow.server.domain.TeamJoinCode;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.TeamJoinCodeRepository;
import creatorflow.server.repo.TeamMembershipRepository;
import creatorflow.server.repo.TeamRepository;
import creatorflow.server.repo.UserAccountRepository;
import creatorflow.server.service.ApiKeys;
import creatorflow.server.service.JoinCodes;
import creatorflow.server.service.TeamService;
import creatorflow.server.web.ApiException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * The two things "single-use, 24 hours" has to survive, driven through the service rather than
 * MockMvc because both need real transaction boundaries.
 *
 * <p>Deliberately <strong>not</strong> {@code @Transactional}: the concurrency case is meaningless
 * inside one shared test transaction, and the expiry case needs a row that is actually committed.
 * Each test therefore uses freshly generated accounts and cleans up nothing — the in-memory
 * database is discarded with the context.
 */
@SpringBootTest
class JoinCodeLifecycleTest {

    @Autowired
    private TeamService teams;

    @Autowired
    private TeamRepository teamRepository;

    @Autowired
    private TeamJoinCodeRepository joinCodes;

    @Autowired
    private TeamMembershipRepository memberships;

    @Autowired
    private UserAccountRepository accounts;

    /**
     * The TTL, which nothing else exercised. A code that has aged out is refused with the same flat
     * message an unknown one gets — telling them apart would say whether a code ever existed.
     */
    @Test
    void anExpiredCodeIsRefusedWithTheSameMessageAsAnUnknownOne() {
        UserAccount owner = newAccount("owner");
        UserAccount joiner = newAccount("joiner");
        long teamId = teams.createTeam(owner.getId(), "Harbor Studio").id();
        Team team = teamRepository.findById(teamId).orElseThrow();

        // Minted an hour past its own 24 h window.
        String rawCode = JoinCodes.newCode();
        joinCodes.save(new TeamJoinCode(team, JoinCodes.hash(rawCode), owner,
                Instant.now().minus(Duration.ofHours(1))));

        ApiException expired = assertThrows(ApiException.class,
                () -> teams.redeemJoinCode(joiner.getId(), rawCode));
        ApiException unknown = assertThrows(ApiException.class,
                () -> teams.redeemJoinCode(joiner.getId(), "not-a-real-code"));

        assertEquals(404, expired.status().value());
        assertEquals(unknown.getMessage(), expired.getMessage(),
                "an expired code must be indistinguishable from one that never existed");
        assertTrue(memberships.findByTeamIdAndAccountId(teamId, joiner.getId()).isEmpty());
    }

    /**
     * Two different accounts presenting the same code at the same instant.
     *
     * <p>Read → check → write is not atomic under H2's READ_COMMITTED, and
     * {@code UNIQUE(team_id, account_id)} does not help — it only stops the same account twice. So
     * without the {@code @Version} on {@link TeamJoinCode} both would see the code unspent and both
     * would join, quietly making "single-use" false. Unlike the concurrent-double-share case, which
     * the design accepts on the record because a duplicate observation is harmless, an invitation
     * that admits two people is not a harmless duplicate.
     *
     * <p>The assertion is on the invariant, not on the timing: exactly one membership, whether the
     * two attempts genuinely raced or the database serialized them.
     */
    @Test
    void twoAccountsRedeemingTheSameCodeAtOnceYieldExactlyOneMembership() throws Exception {
        UserAccount owner = newAccount("owner");
        UserAccount first = newAccount("first");
        UserAccount second = newAccount("second");
        long teamId = teams.createTeam(owner.getId(), "Harbor Studio").id();
        String code = teams.issueJoinCode(teamId, owner.getId()).code();

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<Boolean>> results = pool.invokeAll(List.of(
                    attempt(first.getId(), code), attempt(second.getId(), code)));
            long joined = 0;
            for (Future<Boolean> result : results) if (result.get()) joined++;
            assertEquals(1, joined, "a single-use code admitted more than one account");
        } finally {
            pool.shutdownNow();
        }

        // owner + exactly one redeemer.
        assertEquals(2, memberships.countByTeamId(teamId));
    }

    private Callable<Boolean> attempt(long accountId, String code) {
        return () -> {
            try {
                teams.redeemJoinCode(accountId, code);
                return true;
            } catch (RuntimeException refused) {
                return false;
            }
        };
    }

    private UserAccount newAccount(String prefix) {
        return accounts.save(new UserAccount(
                prefix + "_" + UUID.randomUUID().toString().substring(0, 8), ApiKeys.newKey()));
    }
}
