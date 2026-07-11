package creatorflow.server;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrlPattern;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import creatorflow.TestMedia;
import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.RegisteredAssetRepository;
import creatorflow.server.repo.UserAccountRepository;
import creatorflow.server.service.ApiKeys;
import creatorflow.server.storage.FileStore;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class GalleryWebTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private RegisteredAssetRepository assets;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private FileStore files;

    @Test
    void signup_createsWebAccount_withPasswordAndApiKey() throws Exception {
        mvc.perform(post("/signup").with(csrf())
                        .param("username", "web_maker")
                        .param("displayName", "Web Maker")
                        .param("password", "correct-horse")
                        .param("confirm", "correct-horse"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/login?created"));

        UserAccount account = accounts.findByUsernameIgnoreCase("web_maker").orElseThrow();
        assertNotNull(account.getPasswordHash());
        assertNotNull(account.getApiKey());
        assertEquals("Web Maker", account.getPublicName());
    }

    @Test
    void signup_rejectsTakenUsername() throws Exception {
        webAccount("taken_name");
        mvc.perform(post("/signup").with(csrf())
                        .param("username", "TAKEN_NAME")
                        .param("password", "longenough")
                        .param("confirm", "longenough"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("is taken")));
    }

    @Test
    void uploadPage_requiresLogin() throws Exception {
        mvc.perform(get("/upload"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrlPattern("**/login"));
    }

    @Test
    void cleanUpload_publishes_andAppearsInGallery() throws Exception {
        webAccount("maker_one");
        byte[] png = pngBytes(11);

        MvcResult result = mvc.perform(multipart("/upload")
                        .file(new MockMultipartFile("file", "hero_sprite.png", "image/png", png))
                        .param("title", "Hero sprite")
                        .param("description", "Pixel hero, three frames")
                        .param("license", "CC0 (public domain)")
                        .param("ownershipDeclared", "true")
                        .with(user("maker_one")).with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrlPattern("/assets/*"))
                .andReturn();

        long id = idFromRedirect(result);
        RegisteredAsset asset = assets.findById(id).orElseThrow();
        assertTrue(asset.isGalleryAsset());
        assertEquals("CLEAR", asset.getVerdict());
        assertEquals("image/png", asset.getMimeType());
        assertTrue(Files.isRegularFile(files.fileFor(asset.getSha256())), "stored file");
        assertTrue(Files.isRegularFile(files.thumbFor(asset.getSha256())), "thumbnail");

        mvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("Hero sprite")));
        mvc.perform(get("/").param("q", "hero"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("Hero sprite")));
        mvc.perform(get("/assets/" + id))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("No conflicts")));
    }

    @Test
    void exactDuplicate_byAnotherUser_isNeverPublished() throws Exception {
        webAccount("original_artist");
        webAccount("reposter");
        byte[] png = pngBytes(22);

        mvc.perform(upload(png, "artwork.png", "original_artist"))
                .andExpect(status().is3xxRedirection());
        long before = assets.count();

        mvc.perform(upload(png, "totally_mine.png", "reposter"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("Not published")))
                .andExpect(content().string(containsString("Byte-identical")));
        assertEquals(before, assets.count(), "no new row for the blocked upload");
    }

    @Test
    void perceptuallySimilarUpload_publishesFlagged() throws Exception {
        webAccount("first_artist");
        webAccount("remixer");

        mvc.perform(upload(pngBytes(33), "landscape.png", "first_artist"))
                .andExpect(status().is3xxRedirection());

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(TestMedia.resize(TestMedia.structuredImage(33), 192, 192), "png", out);
        MvcResult result = mvc.perform(upload(out.toByteArray(), "landscape_small.png", "remixer"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrlPattern("/assets/*"))
                .andReturn();

        RegisteredAsset asset = assets.findById(idFromRedirect(result)).orElseThrow();
        assertEquals("SIMILAR", asset.getVerdict());
        mvc.perform(get("/assets/" + asset.getId()))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("flagged similar")))
                .andExpect(content().string(containsString("Visually similar")));
    }

    @Test
    void desktopFingerprintRegistration_isUpgradedByOwnUpload() throws Exception {
        UserAccount owner = webAccount("desktop_user");
        byte[] png = pngBytes(44);
        String sha = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(png));
        assets.save(new RegisteredAsset(owner, "sprite.png", "png", png.length, sha,
                null, null, null, "All rights reserved", true));
        assertEquals(1, assets.countByOwnerId(owner.getId()));

        mvc.perform(upload(png, "sprite.png", "desktop_user"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrlPattern("/assets/*"));

        assertEquals(1, assets.countByOwnerId(owner.getId()), "row upgraded, not duplicated");
        RegisteredAsset upgraded = assets.findByOwnerIdAndHasFileTrueOrderByCreatedAtDesc(
                owner.getId()).get(0);
        assertEquals(sha, upgraded.getSha256());
        assertTrue(upgraded.isGalleryAsset());
    }

    @Test
    void storedFiles_areServedWithTypeCachingAndNoSniff() throws Exception {
        webAccount("file_owner");
        MvcResult result = mvc.perform(upload(pngBytes(55), "served.png", "file_owner"))
                .andExpect(status().is3xxRedirection())
                .andReturn();
        long id = idFromRedirect(result);

        mvc.perform(get("/files/" + id))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().exists("ETag"))
                .andExpect(header().string("Content-Disposition", containsString("inline")));
        mvc.perform(get("/files/" + id).param("download", "true"))
                .andExpect(header().string("Content-Disposition", containsString("attachment")));
        mvc.perform(get("/thumbs/" + id))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG));
    }

    @Test
    void apiEndpoints_keepWorking_underWebSecurity() throws Exception {
        // no CSRF token, no session — the API contract is unchanged
        mvc.perform(post("/api/v1/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"api_client\"}"))
                .andExpect(status().isCreated());
        mvc.perform(get("/api/v1/assets/mine"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder upload(
            byte[] bytes, String fileName, String username) {
        return multipart("/upload")
                .file(new MockMultipartFile("file", fileName, "image/png", bytes))
                .param("title", "")
                .param("license", "All rights reserved")
                .param("ownershipDeclared", "true")
                .with(user(username)).with(csrf());
    }

    private UserAccount webAccount(String username) {
        UserAccount account = new UserAccount(username, ApiKeys.newKey());
        account.setPasswordHash(passwordEncoder.encode("test-password"));
        return accounts.save(account);
    }

    private static byte[] pngBytes(long seed) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(TestMedia.structuredImage(seed), "png", out);
        return out.toByteArray();
    }

    private static long idFromRedirect(MvcResult result) {
        String location = result.getResponse().getRedirectedUrl();
        return Long.parseLong(location.substring(location.lastIndexOf('/') + 1));
    }
}
