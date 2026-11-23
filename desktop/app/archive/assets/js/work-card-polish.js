(function () {
  if (!/\/work\/?$/.test(window.location.pathname)) {
    return;
  }

  var projects = [
    ["E.C.H.O.", "AI installation", "2024", "echo"],
    ["Discover your Patronus", "WebGL experience", "2023", "discover-your-patronus"],
    ["20 Years of Xbox", "Interactive museum", "2021", "xbox-museum"],
    ["Million Piece Mission", "Multiplayer campaign", "2020", "million-piece-mission"],
    ["Chile 20", "Immersive story", "2020", "chile-20"],
    ["Kandinsky", "VR experiment", "2019", "kaninsky-vr"],
    ["Paper Planes", "Global web experiment", "2016", "paper-planes"],
    ["Racer", "Chrome experiment", "2013", "racer"],
    ["Prometheus", "Interactive film", "2012", "prometheus"],
    ["Secret Sky", "Virtual festival", "2020", "secret-sky"],
    ["Frontier Within", "Biometric journey", "2021", "frontier-within"],
    ["Harmonic State", "Generative audio", "2022", "harmonic-state"],
    ["Sustainable Horizons", "Data storytelling", "2022", "sustainable-horizons"],
    ["Welcome to Hogwarts", "Magical portal", "2023", "welcome-to-hogwarts"]
  ];

  function createCard(project, index) {
    var link = document.createElement("a");
    link.className = "work-card-polish__card";
    link.href = "/work/" + project[3];
    link.style.animationDelay = Math.min(index * 0.045, 0.42) + "s";

    var number = document.createElement("span");
    number.className = "work-card-polish__index";
    number.textContent = String(index + 1).padStart(2, "0");

    var body = document.createElement("span");
    body.className = "work-card-polish__body";

    var name = document.createElement("span");
    name.className = "work-card-polish__name";
    name.textContent = project[0];

    var meta = document.createElement("span");
    meta.className = "work-card-polish__meta";

    var type = document.createElement("span");
    type.textContent = project[1];

    var year = document.createElement("span");
    year.textContent = project[2];

    var arrow = document.createElement("span");
    arrow.className = "work-card-polish__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = ">";

    meta.append(type, year);
    body.append(name, meta);
    link.append(number, body, arrow);

    return link;
  }

  function mount() {
    if (document.querySelector(".work-card-polish")) {
      return;
    }

    var root = document.createElement("section");
    root.className = "work-card-polish";
    root.setAttribute("aria-label", "Featured work");

    var head = document.createElement("div");
    head.className = "work-card-polish__head";

    var eyebrow = document.createElement("span");
    eyebrow.className = "work-card-polish__eyebrow";
    eyebrow.textContent = "Selected Work";

    var title = document.createElement("h1");
    title.className = "work-card-polish__title";
    title.textContent = "Work";

    var deck = document.createElement("p");
    deck.className = "work-card-polish__deck";
    deck.textContent = "Interactive projects, spatial stories, games, and strange little portals built for the screen.";

    var list = document.createElement("div");
    list.className = "work-card-polish__list";

    projects.forEach(function (project, index) {
      list.appendChild(createCard(project, index));
    });

    head.append(eyebrow, title, deck);
    root.append(head, list);
    document.body.appendChild(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
