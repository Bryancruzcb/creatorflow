package creatorflow.server;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrlPattern;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import creatorflow.TestMedia;
import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.CommentRepository;
import creatorflow.server.repo.RegisteredAssetRepository;
import creatorflow.server.repo.UserAccountRepository;
import creatorflow.server.service.ApiKeys;
import creatorflow.server.service.GalleryService;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
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
class VersionReviewTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private RegisteredAssetRepository assets;

    @Autowired
    private CommentRepository comments;

    @Autowired
    private GalleryService gallery;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Test
    void newVersion_linksStack_andGalleryShowsOnlyLatest() throws Exception {
        webAccount("stacker");
        long v1 = publish(pngBytes(61), "walker.png", "stacker", "Walker sprite");

        MvcResult result = mvc.perform(multipart("/assets/" + v1 + "/versions")
                        .file(new MockMultipartFile("file", "walker_v2.png", "image/png",
                                revisedPngBytes(61)))
                        .param("description", "Cleaned the outline")
                        .param("ownershipDeclared", "true")
                        .with(user("stacker")).with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrlPattern("/assets/*"))
                .andReturn();
        long v2 = idFromRedirect(result);

        RegisteredAsset first = assets.findById(v1).orElseThrow();
        RegisteredAsset second = assets.findById(v2).orElseThrow();
        assertEquals(first.getId(), first.getRootIdOrSelf());
        assertEquals(first.getId(), second.getRootIdOrSelf());
        assertEquals(2, second.getVersionNumberOrOne());
        assertTrue(second.isLatestVersion());
        assertFalse(first.isLatestVersion());
        assertEquals("Walker sprite", second.getDisplayTitle(), "title inherited");

        var page = gallery.browse("", "", false, 0);
        boolean v1Listed = page.getContent().stream().anyMatch(a -> a.getId().equals(first.getId()));
        boolean v2Listed = page.getContent().stream().anyMatch(a -> a.getId().equals(second.getId()));
        assertTrue(v2Listed, "latest version in gallery");
        assertFalse(v1Listed, "superseded version hidden");

        mvc.perform(get("/assets/" + v2))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("V2")))
                .andExpect(content().string(containsString("Version lineage")));
    }

    @Test
    void lineage_isNotFlagged_butForeignSimilarityStillIs() throws Exception {
        webAccount("author_a");
        webAccount("borrower");
        long v1 = publish(pngBytes(71), "scene.png", "author_a", "Canyon scene");

        MvcResult result = mvc.perform(multipart("/assets/" + v1 + "/versions")
                        .file(new MockMultipartFile("file", "scene_v2.png", "image/png",
                                revisedPngBytes(71)))
                        .param("ownershipDeclared", "true")
                        .with(user("author_a")).with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andReturn();
        RegisteredAsset v2 = assets.findById(idFromRedirect(result)).orElseThrow();
        assertEquals("CLEAR", v2.getVerdict(), "in-stack similarity is lineage, not a flag");

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(TestMedia.resize(TestMedia.structuredImage(71), 192, 192), "png", out);
        MvcResult stolen = mvc.perform(multipart("/upload")
                        .file(new MockMultipartFile("file", "scene_copy.png", "image/png",
                                out.toByteArray()))
                        .param("title", "")
                        .param("license", "Unknown")
                        .param("ownershipDeclared", "true")
                        .with(user("borrower")).with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andReturn();
        RegisteredAsset copy = assets.findById(idFromRedirect(stolen)).orElseThrow();
        assertEquals("SIMILAR", copy.getVerdict(), "outside the stack the flag still applies");
    }

    @Test
    void newVersion_rejectsNonOwner_andByteIdenticalRepeat() throws Exception {
        webAccount("owner_v");
        webAccount("intruder");
        byte[] png = pngBytes(72);
        long v1 = publish(png, "art.png", "owner_v", "Art");
        long before = assets.count();

        mvc.perform(multipart("/assets/" + v1 + "/versions")
                        .file(new MockMultipartFile("file", "hijack.png", "image/png",
                                revisedPngBytes(72)))
                        .param("ownershipDeclared", "true")
                        .with(user("intruder")).with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .redirectedUrl("/assets/" + v1));
        assertEquals(before, assets.count(), "non-owner cannot add versions");

        mvc.perform(multipart("/assets/" + v1 + "/versions")
                        .file(new MockMultipartFile("file", "same.png", "image/png", png))
                        .param("ownershipDeclared", "true")
                        .with(user("owner_v")).with(csrf()))
                .andExpect(status().is3xxRedirection());
        assertEquals(before, assets.count(), "identical bytes are not a new version");
    }

    @Test
    void comments_requireLogin_andPersistPins() throws Exception {
        webAccount("artist_c");
        webAccount("reviewer_c");
        long id = publish(pngBytes(73), "pinned.png", "artist_c", "Pinned piece");

        mvc.perform(post("/assets/" + id + "/comments")
                        .param("body", "nice").with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrlPattern("**/login"));

        mvc.perform(post("/assets/" + id + "/comments")
                        .param("body", "Shadow direction flips on the left edge.")
                        .param("pinX", "0.25").param("pinY", "0.75")
                        .with(user("reviewer_c")).with(csrf()))
                .andExpect(status().is3xxRedirection());

        var list = comments.findByAssetIdOrderByCreatedAtAsc(id);
        assertEquals(1, list.size());
        assertTrue(list.get(0).isPinned());
        assertEquals(0.25, list.get(0).getPinX());

        mvc.perform(get("/assets/" + id))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("Shadow direction flips")))
                .andExpect(content().string(containsString("data-comment")));
    }

    @Test
    void feedbackToggle_isOwnerOnly_andFiltersGallery() throws Exception {
        webAccount("asker");
        webAccount("passerby");
        long id = publish(pngBytes(74), "wip.png", "asker", "WIP tile");

        mvc.perform(post("/assets/" + id + "/feedback")
                        .with(user("passerby")).with(csrf()))
                .andExpect(status().is3xxRedirection());
        assertFalse(assets.findById(id).orElseThrow().isFeedbackWanted());

        mvc.perform(post("/assets/" + id + "/feedback")
                        .with(user("asker")).with(csrf()))
                .andExpect(status().is3xxRedirection());
        assertTrue(assets.findById(id).orElseThrow().isFeedbackWanted());

        var page = gallery.browse("", "", true, 0);
        assertTrue(page.getContent().stream().anyMatch(a -> a.getId().equals(id)));
    }

    @Test
    void compare_worksInsideAStack_and404sAcrossStacks() throws Exception {
        webAccount("differ");
        long v1 = publish(pngBytes(75), "iter.png", "differ", "Iteration");
        MvcResult result = mvc.perform(multipart("/assets/" + v1 + "/versions")
                        .file(new MockMultipartFile("file", "iter2.png", "image/png",
                                revisedPngBytes(75)))
                        .param("ownershipDeclared", "true")
                        .with(user("differ")).with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andReturn();
        long v2 = idFromRedirect(result);

        mvc.perform(get("/assets/" + v2 + "/compare/" + v1))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("difference")))
                .andExpect(content().string(containsString("pixels changed")));
        mvc.perform(get("/diffs/" + v1 + "/" + v2))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG));

        long stranger = publish(pngBytes(76), "other.png", "differ", "Other stack");
        mvc.perform(get("/assets/" + v2 + "/compare/" + stranger))
                .andExpect(status().isNotFound());
        mvc.perform(get("/diffs/" + stranger + "/" + v2))
                .andExpect(status().isNotFound());
    }

    /* ---- helpers -------------------------------------------------------- */

    private long publish(byte[] bytes, String fileName, String username, String title)
            throws Exception {
        MvcResult result = mvc.perform(multipart("/upload")
                        .file(new MockMultipartFile("file", fileName, "image/png", bytes))
                        .param("title", title)
                        .param("license", "CC0 (public domain)")
                        .param("ownershipDeclared", "true")
                        .with(user(username)).with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andReturn();
        return idFromRedirect(result);
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

    /** Same structured image with a small deterministic patch — an iteration, not a copy. */
    private static byte[] revisedPngBytes(long seed) throws Exception {
        BufferedImage img = TestMedia.structuredImage(seed);
        Graphics2D g = img.createGraphics();
        g.setColor(new Color(235, 220, 160));
        g.fillRect(12, 12, 30, 30);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return out.toByteArray();
    }

    private static long idFromRedirect(MvcResult result) {
        String location = result.getResponse().getRedirectedUrl();
        assertNotNull(location);
        return Long.parseLong(location.substring(location.lastIndexOf('/') + 1));
    }
}
