// Upload form niceties: show the chosen file, preview images, block double submits.
(function () {
    var input = document.getElementById("file");
    var chosen = document.getElementById("file-chosen");
    var preview = document.getElementById("upload-preview");
    var form = input ? input.closest("form") : null;
    if (!input || !form) {
        return;
    }

    input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) {
            return;
        }
        chosen.textContent = file.name + " · " + Math.max(1, Math.round(file.size / 1024)) + " KB";
        if (file.type.indexOf("image/") === 0) {
            preview.src = URL.createObjectURL(file);
            preview.style.display = "inline-block";
        } else {
            preview.style.display = "none";
        }
        var title = document.getElementById("title");
        if (title && !title.value) {
            title.value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
        }
    });

    form.addEventListener("submit", function () {
        var submit = document.getElementById("upload-submit");
        if (submit) {
            submit.disabled = true;
            submit.textContent = "Checking against the registry…";
        }
    });
})();
