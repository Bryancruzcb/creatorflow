package creatorflow.server;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * The optional registration gate.
 *
 * <p>This server is meant to sit on a studio LAN, where "anyone who can reach the box can mint an
 * account" is a real hole. Setting {@code creatorflow.signup.token} closes it without introducing
 * a second auth mechanism. Leaving it unset keeps the open behaviour every other test exercises —
 * {@code TeamApiTest} and friends deliberately do not set it, which is what proves the default is
 * still open.
 */
@SpringBootTest(properties = "creatorflow.signup.token=shared-lan-secret")
@AutoConfigureMockMvc
@Transactional
class SignupTokenTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Test
    void registrationIsRefusedWithoutTheToken() throws Exception {
        mvc.perform(signup(null)).andExpect(status().isForbidden());
    }

    @Test
    void registrationIsRefusedWithTheWrongToken() throws Exception {
        mvc.perform(signup("not-the-secret")).andExpect(status().isForbidden());
    }

    @Test
    void registrationSucceedsWithTheRightToken() throws Exception {
        mvc.perform(signup("shared-lan-secret")).andExpect(status().isCreated());
    }

    /** The gate is on registration only — liveness stays open so a teammate can test the URL. */
    @Test
    void healthStaysOpen() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/v1/health"))
                .andExpect(status().isOk());
    }

    private org.springframework.test.web.servlet.RequestBuilder signup(String token) {
        var request = post("/api/v1/accounts")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                        "username", "user_" + UUID.randomUUID().toString().substring(0, 8))));
        return token == null ? request : request.header("X-Signup-Token", token);
    }
}
