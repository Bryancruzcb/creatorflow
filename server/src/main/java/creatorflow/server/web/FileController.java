package creatorflow.server.web;

import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.repo.RegisteredAssetRepository;
import creatorflow.server.storage.FileStore;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.server.ResponseStatusException;

/**
 * Serves stored gallery files and thumbnails. Because storage is content-addressed,
 * the SHA-256 doubles as a perfect ETag. User-supplied SVG is the risky case —
 * it can embed script — so every file response carries a no-script CSP and is
 * only ever embedded through {@code <img>}/{@code <audio>}, which never execute it.
 */
@Controller
public class FileController {

    private final RegisteredAssetRepository assets;
    private final FileStore files;

    public FileController(RegisteredAssetRepository assets, FileStore files) {
        this.assets = assets;
        this.files = files;
    }

    @GetMapping("/files/{id}")
    public ResponseEntity<Resource> file(@PathVariable long id,
                                         @RequestParam(defaultValue = "false") boolean download,
                                         WebRequest request) {
        RegisteredAsset asset = galleryAsset(id);
        Path path = existing(files.fileFor(asset.getSha256()));
        if (request.checkNotModified(asset.getSha256())) {
            return null;
        }
        String disposition = (download ? "attachment" : "inline")
                + "; filename=\"" + safeFileName(asset.getFileName()) + "\"";
        return ResponseEntity.ok()
                .contentType(mediaType(asset))
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition)
                .header("Content-Security-Policy",
                        "default-src 'none'; style-src 'unsafe-inline'")
                .eTag('"' + asset.getSha256() + '"')
                .cacheControl(CacheControl.maxAge(30, TimeUnit.DAYS))
                .body(new FileSystemResource(path));
    }

    @GetMapping("/thumbs/{id}")
    public ResponseEntity<Resource> thumb(@PathVariable long id, WebRequest request) {
        RegisteredAsset asset = galleryAsset(id);
        if (request.checkNotModified("thumb-" + asset.getSha256())) {
            return null;
        }
        Path thumb = files.thumbFor(asset.getSha256());
        boolean hasThumb = Files.isRegularFile(thumb);
        Path path = hasThumb ? thumb : existing(files.fileFor(asset.getSha256()));
        return ResponseEntity.ok()
                .contentType(hasThumb ? MediaType.IMAGE_PNG : mediaType(asset))
                .header("Content-Security-Policy",
                        "default-src 'none'; style-src 'unsafe-inline'")
                .eTag("\"thumb-" + asset.getSha256() + '"')
                .cacheControl(CacheControl.maxAge(30, TimeUnit.DAYS))
                .body(new FileSystemResource(path));
    }

    private RegisteredAsset galleryAsset(long id) {
        return assets.findById(id)
                .filter(RegisteredAsset::isGalleryAsset)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No published asset with id " + id));
    }

    private static Path existing(Path path) {
        if (!Files.isRegularFile(path)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Stored file is missing");
        }
        return path;
    }

    private static MediaType mediaType(RegisteredAsset asset) {
        try {
            return MediaType.parseMediaType(asset.getMimeType());
        } catch (Exception e) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
    }

    private static String safeFileName(String name) {
        return name.replaceAll("[\"\\\\\r\n]", "_");
    }
}
