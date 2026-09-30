const state = { payload: null, source: "all", query: "" };
const $ = selector => document.querySelector(selector);

const escapeHtml = value => String(value ?? "")
  .replaceAll("&","&amp;")
  .replaceAll("<","&lt;")
  .replaceAll(">","&gt;")
  .replaceAll('"',"&quot;")
  .replaceAll("'","&#039;");

function formatDate(value) {
  if (!value) return "Date unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return new Intl.DateTimeFormat(undefined,{
    month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"
  }).format(date);
}

function relativeDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : formatDate(value);
}

function initials(name) {
  const words = String(name || "News").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0,2).toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
}

function renderSourceNav() {
  $("#sourceNav").innerHTML = (state.payload?.sources || []).map(source => `
    <a href="${escapeHtml(source.siteUrl)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(source.name)}
    </a>
  `).join("");
}

function renderFilters() {
  const sources = state.payload?.sources || [];
  $("#filters").innerHTML = [
    `<button type="button" class="active" data-source="all">All</button>`,
    ...sources.map(source => `<button type="button" data-source="${escapeHtml(source.id)}">${escapeHtml(source.short)}</button>`)
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
    button.classList.toggle("active", button.dataset.source === state.source);
  });
  const selected = state.payload?.sources?.find(source => source.id === state.source);
  $("#heading").textContent = selected?.name || "All stories";
}

function renderSources() {
  $("#sources").innerHTML = (state.payload?.sources || []).map(source => `
    <a class="source-item" href="${escapeHtml(source.siteUrl)}" target="_blank" rel="noopener noreferrer">
      <span class="source-name">${escapeHtml(source.name)}</span>
      <span class="source-meta">${escapeHtml(source.category)}</span>
    </a>
  `).join("");
}

function matches(article) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return [
    article.title,
    article.excerpt,
    article.source?.name,
    article.source?.category
  ].join(" ").toLowerCase().includes(query);
}

function visibleArticles() {
  return (state.payload?.articles || []).filter(article => {
    const sourceMatch = state.source === "all" || article.source?.id === state.source;
    return sourceMatch && matches(article);
  });
}

function imageMarkup(article) {
  if (!article.image) {
    return `
      <div class="story-image">
        <div class="image-fallback">${escapeHtml(initials(article.source?.name))}</div>
        <div class="source-mark">${escapeHtml(article.source?.short || "NEWS")}</div>
      </div>
    `;
  }

  return `
    <div class="story-image">
      <img src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
      <div class="source-mark">${escapeHtml(article.source?.short || "NEWS")}</div>
    </div>
  `;
}

function renderStories() {
  const stories = visibleArticles();
  $("#count").textContent = `${stories.length.toLocaleString()} ${stories.length === 1 ? "story" : "stories"}`;
  $("#empty").hidden = stories.length > 0;

  $("#grid").innerHTML = stories.map(article => `
    <a class="story-card" href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(article.title)}">
      ${imageMarkup(article)}
      <div class="story-copy">
        <div class="story-meta">
          <span>${escapeHtml(article.source?.name || "Publisher")}</span>
          <span>·</span>
          <span title="${escapeHtml(formatDate(article.publishedAt))}">${escapeHtml(relativeDate(article.publishedAt))}</span>
        </div>
        <h3 class="story-title">${escapeHtml(article.title)}</h3>
        <p class="story-excerpt">${escapeHtml(article.excerpt || "Open the original publisher for the complete story.")}</p>
        <div class="story-source">Original publisher: <strong>${escapeHtml(article.source?.name || "Publisher")}</strong></div>
      </div>
    </a>
  `).join("");
}

function renderSummary() {
  const payload = state.payload;
  const articles = payload?.articles || [];
  const newest = articles.find(article => article.publishedAt);

  $("#storyCount").textContent = articles.length.toLocaleString();
  $("#sourceCount").textContent = String(payload?.stats?.sourceCount ?? "—");
  $("#latest").textContent = newest ? relativeDate(newest.publishedAt) : "—";
  $("#updated").textContent = payload?.generatedAt ? `updated ${relativeDate(payload.generatedAt)}` : "waiting for first refresh";

  const failed = payload?.stats?.failedSources || 0;
  $("#status").textContent = failed
    ? `${failed} source${failed === 1 ? "" : "s"} unavailable; available feeds are still shown`
    : "all configured sources refreshed";
}

async function load() {
  $("#status").textContent = "Refreshing stories…";

  try {
    const response = await fetch(`data/articles.json?ts=${Date.now()}`, { cache:"no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    state.payload = await response.json();
    renderSummary();
    renderSourceNav();
    renderFilters();
    renderSources();
    syncFilters();
    renderStories();
  } catch (error) {
    console.error(error);
    $("#status").textContent = "Story data is unavailable";
    $("#updated").textContent = "Run the GitHub Actions refresh";
    $("#grid").innerHTML = `
      <div class="empty">
        <h3>No story data yet.</h3>
        <p>Run the GitHub Actions workflow to populate the reader.</p>
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
  document.documentElement.classList.toggle("dark");
  const dark = document.documentElement.classList.contains("dark");
  localStorage.setItem("aninews-theme", dark ? "dark" : "light");
  $("#theme").textContent = dark ? "Light" : "Dark";
});

window.addEventListener("keydown", event => {
  if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
    event.preventDefault();
    $("#search").focus();
  }
});

if (localStorage.getItem("aninews-theme") === "dark") {
  document.documentElement.classList.add("dark");
  $("#theme").textContent = "Light";
}

load();
