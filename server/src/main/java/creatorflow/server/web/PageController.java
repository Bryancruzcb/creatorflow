package creatorflow.server.web;

import creatorflow.server.domain.Comment;
import creatorflow.server.domain.Dispute;
import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.CommentRepository;
import creatorflow.server.repo.DisputeRepository;
import creatorflow.server.repo.RegisteredAssetRepository;
import creatorflow.server.repo.UserAccountRepository;
import creatorflow.server.service.DiffService;
import creatorflow.server.service.GalleryService;
import java.io.IOException;
import java.security.Principal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

/** The gallery site: browse, asset pages, upload, profiles, and the member library. */
@Controller
public class PageController {

    private final GalleryService gallery;
    private final RegisteredAssetRepository assets;
    private final UserAccountRepository accounts;
    private final DisputeRepository disputes;
    private final CommentRepository comments;
    private final DiffService diffs;

    public PageController(GalleryService gallery, RegisteredAssetRepository assets,
                          UserAccountRepository accounts, DisputeRepository disputes,
                          CommentRepository comments, DiffService diffs) {
        this.gallery = gallery;
        this.assets = assets;
        this.accounts = accounts;
        this.disputes = disputes;
        this.comments = comments;
        this.diffs = diffs;
    }

    @GetMapping("/")
    public String index(@RequestParam(defaultValue = "") String q,
                        @RequestParam(defaultValue = "") String type,
                        @RequestParam(defaultValue = "false") boolean feedback,
                        @RequestParam(defaultValue = "0") int page,
                        Model model) {
        model.addAttribute("assets", gallery.browse(q, type, feedback, page));
        model.addAttribute("q", q);
        model.addAttribute("type", type);
        model.addAttribute("feedback", feedback);
        return "index";
    }

    @GetMapping("/assets/{id}")
    public String asset(@PathVariable long id, Model model, Principal principal) {
        RegisteredAsset asset = galleryAsset(id);
        List<RegisteredAsset> versions = gallery.versionsOf(asset);
        boolean isOwner = principal != null
                && asset.getOwner().getUsername().equalsIgnoreCase(principal.getName());
        model.addAttribute("asset", asset);
        model.addAttribute("report", gallery.report(asset));
        model.addAttribute("versions", versions);
        model.addAttribute("latest", versions.get(0));
        model.addAttribute("commentList", comments.findByAssetIdOrderByCreatedAtAsc(id));
        model.addAttribute("isOwner", isOwner);
        model.addAttribute("openDisputes",
                disputes.countByAssetIdAndStatus(id, Dispute.STATUS_OPEN));
        model.addAttribute("canDispute", principal != null && !isOwner);
        return "asset";
    }

    @PostMapping("/assets/{id}/versions")
    public String newVersion(@PathVariable long id, @RequestParam MultipartFile file,
                             @RequestParam(defaultValue = "") String description,
                             @RequestParam(defaultValue = "false") boolean ownershipDeclared,
                             Principal principal, RedirectAttributes redirect) {
        UserAccount user = requireAccount(principal);
        GalleryService.UploadOutcome outcome;
        try {
            outcome = gallery.publishNewVersion(user, id, file, description, ownershipDeclared);
        } catch (IOException e) {
            redirect.addFlashAttribute("versionError",
                    "The file could not be read (" + e.getMessage() + ").");
            return "redirect:/assets/" + id;
        }
        if (outcome.published()) {
            redirect.addFlashAttribute("published", outcome.verdict());
            redirect.addFlashAttribute("versionPublished",
                    outcome.asset().getVersionLabel());
            return "redirect:/assets/" + outcome.asset().getId();
        }
        redirect.addFlashAttribute("versionError", outcome.blockReason());
        return "redirect:/assets/" + id;
    }

    @GetMapping("/assets/{id}/compare/{otherId}")
    public String compare(@PathVariable long id, @PathVariable long otherId, Model model)
            throws IOException {
        RegisteredAsset to = galleryAsset(id);
        RegisteredAsset from = galleryAsset(otherId);
        if (!from.getRootIdOrSelf().equals(to.getRootIdOrSelf())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Those assets are not versions of the same stack.");
        }
        DiffService.Diff diff = diffs.compare(from, to);
        model.addAttribute("from", from);
        model.addAttribute("to", to);
        model.addAttribute("diff", diff);
        return "compare";
    }

    @PostMapping("/assets/{id}/comments")
    public String comment(@PathVariable long id, @RequestParam String body,
                          @RequestParam(required = false) Double pinX,
                          @RequestParam(required = false) Double pinY,
                          Principal principal, RedirectAttributes redirect) {
        UserAccount user = requireAccount(principal);
        RegisteredAsset asset = galleryAsset(id);
        String text = body == null ? "" : body.strip();
        if (text.isEmpty() || text.length() > 1000) {
            redirect.addFlashAttribute("commentError",
                    "Comments need 1–1000 characters.");
        } else {
            boolean pinned = pinX != null && pinY != null
                    && pinX >= 0 && pinX <= 1 && pinY >= 0 && pinY <= 1;
            comments.save(new Comment(asset, user, text,
                    pinned ? pinX : null, pinned ? pinY : null));
        }
        return "redirect:/assets/" + id + "#comments";
    }

    @PostMapping("/assets/{id}/feedback")
    public String toggleFeedback(@PathVariable long id, Principal principal,
                                 RedirectAttributes redirect) {
        UserAccount user = requireAccount(principal);
        RegisteredAsset asset = galleryAsset(id);
        if (!asset.getOwner().getId().equals(user.getId())) {
            redirect.addFlashAttribute("commentError",
                    "Only the owner can toggle feedback requests.");
        } else {
            asset.toggleFeedbackWanted();
            assets.save(asset);
        }
        return "redirect:/assets/" + id;
    }

    @GetMapping("/u/{username}")
    public String profile(@PathVariable String username, Model model) {
        UserAccount user = accounts.findByUsernameIgnoreCase(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No member named " + username));
        List<RegisteredAsset> uploads =
                assets.findByOwnerIdAndHasFileTrueOrderByCreatedAtDesc(user.getId());
        model.addAttribute("profileUser", user);
        model.addAttribute("uploads", uploads);
        model.addAttribute("registeredCount", assets.countByOwnerId(user.getId()));
        return "profile";
    }

    @GetMapping("/upload")
    public String uploadForm(Model model) {
        model.addAttribute("licenses", GalleryService.LICENSES);
        return "upload";
    }

    @PostMapping("/upload")
    public String upload(@RequestParam MultipartFile file,
                         @RequestParam(defaultValue = "") String title,
                         @RequestParam(defaultValue = "") String description,
                         @RequestParam(defaultValue = "") String license,
                         @RequestParam(defaultValue = "false") boolean ownershipDeclared,
                         Principal principal, Model model, RedirectAttributes redirect) {
        UserAccount user = requireAccount(principal);
        GalleryService.UploadOutcome outcome;
        try {
            outcome = gallery.upload(user, file, title, description, license, ownershipDeclared);
        } catch (IOException e) {
            return uploadFormWithError(model, "The file could not be read (" + e.getMessage()
                    + "). Try again.", title, description, license);
        }
        if (outcome.published()) {
            redirect.addFlashAttribute("published", outcome.verdict());
            return "redirect:/assets/" + outcome.asset().getId();
        }
        model.addAttribute("licenses", GalleryService.LICENSES);
        model.addAttribute("outcome", outcome);
        model.addAttribute("title", title);
        model.addAttribute("description", description);
        model.addAttribute("license", license);
        return "upload";
    }

    @GetMapping("/me")
    public String me(Principal principal, Model model) {
        UserAccount user = requireAccount(principal);
        List<RegisteredAsset> uploads =
                assets.findByOwnerIdAndHasFileTrueOrderByCreatedAtDesc(user.getId());
        model.addAttribute("account", user);
        model.addAttribute("uploads", uploads);
        model.addAttribute("fingerprintOnly", assets.countByOwnerId(user.getId()) - uploads.size());
        model.addAttribute("disputesFiled",
                disputes.findByClaimantIdOrderByCreatedAtDesc(user.getId()));
        model.addAttribute("disputesReceived",
                disputes.findByAsset_Owner_IdOrderByCreatedAtDesc(user.getId()));
        return "me";
    }

    @PostMapping("/assets/{id}/dispute")
    public String dispute(@PathVariable long id, @RequestParam String reason,
                          Principal principal, RedirectAttributes redirect) {
        UserAccount user = requireAccount(principal);
        RegisteredAsset asset = galleryAsset(id);
        if (asset.getOwner().getId().equals(user.getId())) {
            redirect.addFlashAttribute("disputeError", "You cannot dispute your own asset.");
        } else if (reason == null || reason.strip().length() < 10) {
            redirect.addFlashAttribute("disputeError",
                    "Explain the claim in at least 10 characters.");
        } else {
            disputes.save(new Dispute(asset, user, reason.strip()));
            redirect.addFlashAttribute("disputeFiled", true);
        }
        return "redirect:/assets/" + id;
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public String tooLarge(Model model) {
        return uploadFormWithError(model, "That file is over the 25 MB upload limit.", "", "", "");
    }

    private RegisteredAsset galleryAsset(long id) {
        return assets.findById(id)
                .filter(RegisteredAsset::isGalleryAsset)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No published asset with id " + id));
    }

    private UserAccount requireAccount(Principal principal) {
        return accounts.findByUsernameIgnoreCase(principal.getName())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                        "Account not found"));
    }

    private String uploadFormWithError(Model model, String error, String title,
                                       String description, String license) {
        model.addAttribute("licenses", GalleryService.LICENSES);
        model.addAttribute("outcome", GalleryService.UploadOutcome.blocked(error, null,
                List.of(), List.of()));
        model.addAttribute("title", title);
        model.addAttribute("description", description);
        model.addAttribute("license", license);
        return "upload";
    }
}
