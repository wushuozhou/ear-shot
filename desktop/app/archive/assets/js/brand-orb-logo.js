(function () {
  if (!/\/work\/?$/.test(window.location.pathname)) {
    return;
  }

  function createOrb(position) {
    var root = document.createElement("div");
    root.className = "brand-orb-logo brand-orb-logo--" + position;
    root.setAttribute("aria-hidden", "true");

    var shield = document.createElement("div");
    shield.className = "brand-orb-logo__shield";

    var orb = document.createElement("div");
    orb.className = "brand-orb-logo__orb";

    shield.appendChild(orb);
    root.appendChild(shield);
    return root;
  }

  function mount() {
    if (document.querySelector(".brand-orb-logo")) {
      return;
    }

    document.body.appendChild(createOrb("top"));
    document.body.appendChild(createOrb("bottom"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
