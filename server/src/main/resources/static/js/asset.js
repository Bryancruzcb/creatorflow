// Asset page: pin-a-point comments and marker navigation.
(function () {
    var stage = document.getElementById("stage");
    var media = document.getElementById("stage-media");
    var img = media ? media.querySelector("img") : null;
    var toggle = document.getElementById("pin-toggle");
    var status = document.getElementById("pin-status");
    var pinX = document.getElementById("pinX");
    var pinY = document.getElementById("pinY");
    var pinning = false;
    var temp = null;

    function setPinning(on) {
        pinning = on;
        if (stage) {
            stage.classList.toggle("pinning", on);
        }
        if (toggle) {
            toggle.textContent = on ? "Click the artwork to place the pin…"
                : "Pin a point on the artwork";
        }
    }

    function clearPin() {
        if (pinX) { pinX.value = ""; }
        if (pinY) { pinY.value = ""; }
        if (temp && temp.parentNode) { temp.parentNode.removeChild(temp); }
        temp = null;
        if (status) { status.textContent = ""; }
    }

    if (toggle && img && pinX && pinY) {
        toggle.addEventListener("click", function () { setPinning(!pinning); });

        img.addEventListener("click", function (e) {
            if (!pinning) { return; }
            var rect = img.getBoundingClientRect();
            var x = (e.clientX - rect.left) / rect.width;
            var y = (e.clientY - rect.top) / rect.height;
            x = Math.min(1, Math.max(0, x));
            y = Math.min(1, Math.max(0, y));
            pinX.value = x.toFixed(4);
            pinY.value = y.toFixed(4);
            if (!temp) {
                temp = document.createElement("span");
                temp.className = "pin-marker temp";
                temp.textContent = "+";
                media.appendChild(temp);
            }
            temp.style.left = (x * 100) + "%";
            temp.style.top = (y * 100) + "%";
            setPinning(false);
            if (status) {
                status.innerHTML = " Pin set — it publishes with your comment. ";
                var clear = document.createElement("button");
                clear.type = "button";
                clear.className = "linklike";
                clear.textContent = "Clear pin";
                clear.addEventListener("click", clearPin);
                status.appendChild(clear);
            }
        });
    }

    // Clicking a numbered marker scrolls to (and briefly highlights) its comment.
    var markers = document.querySelectorAll(".pin-marker[data-comment]");
    for (var i = 0; i < markers.length; i++) {
        markers[i].addEventListener("click", function () {
            var target = document.getElementById("comment-" + this.getAttribute("data-comment"));
            if (!target) { return; }
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.add("highlight");
            setTimeout(function () { target.classList.remove("highlight"); }, 1800);
        });
    }
})();
