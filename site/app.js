const state = {
  payload: null,
  source: "all",
  query: ""
};

const $ = selector => document.querySelector(selector);

const esc = value =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function formatDate(value) {
  if (!value) return "Date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unknown";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function relativeDate(value) {
  if (!value) return "unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";

  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return formatDate(value);
}

function renderNavigation() {
  const sources = state.payload?.sources || [];

  $("#sourceNav").innerHTML = sources.map(source => `
    <a href="${esc(source.siteUrl)}"
       target="_blank"
       rel="noopener noreferrer">
      ${esc(source.name)}
    </a>
  `).join("");

  $("#sources").innerHTML = sources.map(source => {
    const result = state.payload?.sourceResults?.find(
      item => item.id === source.id
    );

    const mode = result?.mode === "google-news-recent"
      ? "fallback · recent"
      : source.category;

    return `
      <a class="source-item"
         href="${esc(source.siteUrl)}"
         target="_blank"
         rel="noopener noreferrer">
        <span class="source-name">${esc(source.name)}</span>
        <span class="source-meta">${esc(mode)}</span>
      </a>
    `;
  }).join("");
}

function renderFilters() {
  const sources = state.payload?.sources || [];

  $("#filters").innerHTML = [
    `<button type="button" class="active" data-source="all">All</button>`,
    ...sources.map(source => `
      <button type="button" data-source="${esc(source.id)}">
        ${esc(source.short)}
      </button>
    `)
  ].join("");

  $("#filters").querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      state.source = button.dataset.source;
      syncFilters();
      renderStories();
    });
  });
}

function syncFilters() {
  $("#filters").querySelectorAll("button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.source === state.source
    );
  });

  const source = state.payload?.sources?.find(
    item => item.id === state.source
  );

  $("#heading").textContent = source?.name || "All stories";
}

function matches(article) {
  const query = state.query.trim().toLowerCase();

  if (!query) return true;

  return [
    article.title,
    article.excerpt,
    article.source?.name,
    article.source?.category
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function getStories() {
  return (state.payload?.articles || []).filter(article => {
    const sourceMatches =
      state.source === "all" ||
      article.source?.id === state.source;

    return sourceMatches && matches(article);
  });
}

function thumbnail(article) {
  if (!article.image) {
    return `
      <div class="story-image fallback">
        <span>${esc(article.source?.short || "NEWS")}</span>
      </div>
    `;
  }

  return `
    <div class="story-image">
      <img src="${esc(article.image)}"
           alt=""
           loading="lazy"
           referrerpolicy="no-referrer"
           onerror="this.style.opacity='0'">
    </div>
  `;
}

function renderStories() {
  const stories = getStories();

  $("#count").textContent =
    `${stories.length.toLocaleString()} ${stories.length === 1 ? "story" : "stories"}`;

  $("#empty").hidden = stories.length > 0;

  $("#grid").innerHTML = stories.map(article => `
    <a class="story"
       href="reader.html?id=${encodeURIComponent(article.id)}">
      <div class="story-index">
        <span>${esc(article.source?.short || "News")}</span>
        <small>${esc(relativeDate(article.publishedAt))}</small>
      </div>

      ${thumbnail(article)}

      <div class="story-content">
        <div class="story-source">${esc(article.source?.name || "Publisher")}</div>
        <h3>${esc(article.title)}</h3>
        <p>${esc(article.excerpt || "Open the reader for this story.")}</p>
      </div>

      <span class="story-arrow">↗</span>
    </a>
  `).join("");
}

function renderStats() {
  const payload = state.payload;
  const articles = payload?.articles || [];
  const newest = articles.find(article => article.publishedAt);
  const failed = payload?.stats?.failedSources || 0;

  $("#storyCount").textContent = articles.length.toLocaleString();
  $("#sourceCount").textContent =
    String(payload?.stats?.sourceCount ?? "—");
  $("#latest").textContent =
    newest ? relativeDate(newest.publishedAt) : "—";

  $("#updated").textContent = payload?.generatedAt
    ? `updated ${relativeDate(payload.generatedAt)}`
    : "waiting for update";

  $("#status").textContent = failed
    ? `${failed} source${failed === 1 ? "" : "s"} unavailable`
    : "all configured sources refreshed";
}

async function load() {
  $("#status").textContent = "Refreshing";

  try {
    const response = await fetch(
      `data/articles.json?ts=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    state.payload = await response.json();

    renderStats();
    renderNavigation();
    renderFilters();
    syncFilters();
    renderStories();
  } catch (error) {
    console.error(error);
    $("#status").textContent = "Unable to load news";
    $("#grid").innerHTML = `
      <div class="empty">
        <h3>No story data yet.</h3>
        <p>Run the GitHub Actions refresh.</p>
      </div>
    `;
  }
}

$("#search").addEventListener("input", event => {
  state.query = event.target.value;
  renderStories();
});

$("#refresh").addEventListener("click", load);

$("#theme").addEventListener("click", () => {
  document.documentElement.classList.toggle("light");
  const light = document.documentElement.classList.contains("light");
  localStorage.setItem("aninews-theme", light ? "light" : "dark");
  $("#theme").textContent = light ? "Dark" : "Light";
});

window.addEventListener("keydown", event => {
  if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
    event.preventDefault();
    $("#search").focus();
  }
});

if (localStorage.getItem("aninews-theme") === "light") {
  document.documentElement.classList.add("light");
  $("#theme").textContent = "Dark";
}

load();
