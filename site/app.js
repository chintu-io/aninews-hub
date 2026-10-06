const state = {
  payload: null,
  source: "all",
  query: "",
  page: 1,
  pageSize: 12
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

  if (Number.isNaN(date.getTime())) {
    return "Date unknown";
  }

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

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return hours + "h ago";

  const days = Math.floor(hours / 24);

  if (days < 7) return days + "d ago";

  return formatDate(value);
}

function isFresh(value) {
  if (!value) return false;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const age = Date.now() - date.getTime();

  return age >= 0 && age <= 6 * 60 * 60 * 1000;
}

function renderNavigation() {
  const sources = state.payload?.sources || [];

  $("#sourceNav").innerHTML = sources.map(source =>
    "<a href=\"" + esc(source.siteUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
      esc(source.name) +
    "</a>"
  ).join("");

  $("#sources").innerHTML = sources.map(source => {
    const result = state.payload?.sourceResults?.find(
      item => item.id === source.id
    );

    const status =
      result?.status === "ok"
        ? result.count + " stories"
        : "unavailable";

    return (
      "<div class=\"source-item\">" +
        "<a class=\"source-link\" href=\"" + esc(source.siteUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
          "<span class=\"source-name\">" + esc(source.name) + "</span>" +
          "<span class=\"source-meta\">" + esc(status) + "</span>" +
        "</a>" +
        "<a class=\"source-rss\" href=\"rss/" + encodeURIComponent(source.id) + ".xml\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"" + esc(source.name) + " RSS feed\" aria-label=\"" + esc(source.name) + " RSS feed\">RSS</a>" +
      "</div>"
    );
  }).join("");
}

function renderFilters() {
  const sources = state.payload?.sources || [];

  $("#filters").innerHTML = [
    "<button type=\"button\" class=\"active\" data-source=\"all\">All</button>"
  ].concat(
    sources.map(source =>
      "<button type=\"button\" data-source=\"" + esc(source.id) + "\">" +
        esc(source.short) +
      "</button>"
    )
  ).join("");

  $("#filters").querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      state.source = button.dataset.source;
      resetPage();
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

  $("#heading").textContent =
    source?.name || "All stories";
}

function matches(article) {
  const query = state.query.trim().toLowerCase();

  if (!query) return true;

  return [
    article.title,
    article.excerpt,
    article.description,
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

function getPageStories(stories) {
  const start =
    (state.page - 1) *
    state.pageSize;

  return stories.slice(
    start,
    start + state.pageSize
  );
}

function getPageCount(total) {
  return Math.max(
    1,
    Math.ceil(
      total / state.pageSize
    )
  );
}

function resetPage() {
  state.page = 1;
}

function renderPagination(total) {
  const pagination =
    document.querySelector("#pagination");

  if (!pagination) {
    return;
  }

  const pageCount =
    getPageCount(total);

  if (pageCount <= 1) {
    pagination.innerHTML = "";
    pagination.hidden = true;
    return;
  }

  pagination.hidden = false;

  const pages = [];
  const addPage = page => {
    if (!pages.includes(page)) {
      pages.push(page);
    }
  };

  addPage(1);

  for (
    let page = Math.max(2, state.page - 2);
    page <= Math.min(pageCount - 1, state.page + 2);
    page++
  ) {
    addPage(page);
  }

  if (pageCount > 1) {
    addPage(pageCount);
  }

  let html = "";

  html +=
    "<button class=\"page-button\" type=\"button\" data-page=\"" +
    (state.page - 1) +
    "\" aria-label=\"Previous page\" " +
    (state.page === 1 ? "disabled" : "") +
    ">‹</button>";

  let previous = null;

  pages.forEach(page => {
    if (
      previous !== null &&
      page - previous > 1
    ) {
      html +=
        "<span class=\"page-ellipsis\" aria-hidden=\"true\">…</span>";
    }

    html +=
      "<button class=\"page-button" +
      (page === state.page ? " active" : "") +
      "\" type=\"button\" data-page=\"" +
      page +
      "\" aria-label=\"Page " +
      page +
      "\">" +
      page +
      "</button>";

    previous = page;
  });

  html +=
    "<button class=\"page-button\" type=\"button\" data-page=\"" +
    (state.page + 1) +
    "\" aria-label=\"Next page\" " +
    (state.page === pageCount ? "disabled" : "") +
    ">›</button>";

  pagination.innerHTML = html;

  pagination.querySelectorAll(".page-button").forEach(button => {
    if (button.disabled) {
      return;
    }

    button.addEventListener("click", () => {
      const requested =
        Number(button.dataset.page);

      if (
        requested >= 1 &&
        requested <= pageCount &&
        requested !== state.page
      ) {
        state.page = requested;
        renderStories();
        document.querySelector(".section-head")?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  });

  const first =
    (state.page - 1) * state.pageSize + 1;

  const last =
    Math.min(
      state.page * state.pageSize,
      total
    );

  const info =
    document.querySelector("#paginationInfo");

  if (info) {
    info.textContent =
      "Showing " +
      first.toLocaleString() +
      "–" +
      last.toLocaleString() +
      " of " +
      total.toLocaleString();
  }
}

function thumbnail(article) {
  const sourceLabel =
    article.source?.short ||
    "NEWS";

  if (!article.image) {
    return (
      "<div class=\"story-image fallback\">" +
        "<span>" + esc(sourceLabel) + "</span>" +
      "</div>"
    );
  }

  return (
    "<div class=\"story-image\">" +
      "<img src=\"" + esc(article.image) + "\" alt=\"\" loading=\"lazy\" referrerpolicy=\"no-referrer\" onerror=\"this.remove();this.parentElement.classList.add('fallback')\" />" +
      "<span class=\"image-fallback-label\" aria-hidden=\"true\">" + esc(sourceLabel) + "</span>" +
    "</div>"
  );
}

function renderStories() {
  const stories = getStories();
  const pageCount = getPageCount(stories.length);

  if (state.page > pageCount) {
    state.page = pageCount;
  }

  const visibleStories =
    getPageStories(stories);

  $("#count").textContent =
    stories.length.toLocaleString() + " " +
    (stories.length === 1 ? "story" : "stories");

  $("#empty").hidden =
    stories.length > 0;

  $("#grid").innerHTML =
    visibleStories.map((article, index) => {
      const featured =
        state.page === 1 &&
        index === 0;

      const fresh =
        isFresh(article.publishedAt);

      const sourceAccent =
        article.source?.accent ||
        "#b892ff";

      const excerptText =
        article.excerpt ||
        article.description ||
        "Open the original publisher for the complete story.";

      return (
        "<a class=\"story" +
        (featured ? " featured" : "") +
        "\" href=\"" +
        esc(article.link) +
        "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
          thumbnail(article) +
          "<div class=\"story-body\">" +
            "<div class=\"story-meta\" style=\"--source-accent:" +
            esc(sourceAccent) +
            "\">" +
              "<span class=\"story-dot\" aria-hidden=\"true\"></span>" +
              "<span class=\"story-source-name\">" +
              esc(article.source?.name || "Publisher") +
              "</span>" +
              "<span>•</span>" +
              "<time datetime=\"" +
              esc(article.publishedAt || "") +
              "\">" +
              esc(relativeDate(article.publishedAt)) +
              "</time>" +
              (fresh ? "<span class=\"story-fresh\">NEW</span>" : "") +
            "</div>" +
            "<div class=\"story-content\">" +
              "<h3>" +
              esc(article.title || "Untitled") +
              "</h3>" +
              "<p>" +
              esc(excerptText) +
              "</p>" +
            "</div>" +
            "<div class=\"story-footer\">" +
              "<span class=\"story-read\">Read original</span>" +
              "<span class=\"story-arrow\" aria-hidden=\"true\">↗</span>" +
            "</div>" +
          "</div>" +
        "</a>"
      );
    }).join("");

  renderPagination(stories.length);
}

function renderStats() {
  const payload = state.payload;
  const articles = payload?.articles || [];
  const newest = articles.find(article => article.publishedAt);

  const failed = payload?.stats?.failedSources || 0;

  $("#storyCount").textContent =
    articles.length.toLocaleString();

  $("#sourceCount").textContent =
    String(payload?.stats?.sourceCount ?? "—");

  $("#latest").textContent =
    newest ? relativeDate(newest.publishedAt) : "—";

  $("#updated").textContent =
    payload?.generatedAt
      ? "updated " + relativeDate(payload.generatedAt)
      : "waiting for update";

  $("#status").textContent =
    failed
      ? failed + " source" + (failed === 1 ? "" : "s") + " unavailable"
      : "all configured sources refreshed";
}

async function load() {
  $("#status").textContent = "Refreshing";

  try {
    const response = await fetch(
      "data/articles.json?ts=" + Date.now(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    state.payload = await response.json();

    renderStats();
    renderNavigation();
    renderFilters();
    syncFilters();
    renderStories();
  } catch (error) {
    console.error(error);

    $("#status").textContent = "Unable to load news";

    $("#grid").innerHTML =
      "<div class=\"empty\">" +
        "<div class=\"empty-icon\" aria-hidden=\"true\">✧</div>" +
        "<h3>No story data yet.</h3>" +
        "<p>Run the GitHub Actions refresh.</p>" +
      "</div>";
  }
}

$("#search").addEventListener("input", event => {
  state.query = event.target.value;
  resetPage();
  renderStories();
});

$("#refresh").addEventListener("click", load);

$("#theme").addEventListener("click", () => {
  document.documentElement.classList.toggle("light");

  const light =
    document.documentElement.classList.contains("light");

  localStorage.setItem(
    "aninews-theme",
    light ? "light" : "dark"
  );

  $("#theme").innerHTML =
    "<span aria-hidden=\"true\">" +
    (light ? "◑" : "◐") +
    "</span><span>" +
    (light ? "Dark" : "Light") +
    "</span>";
});

window.addEventListener("keydown", event => {
  if (
    event.key === "/" &&
    document.activeElement?.tagName !== "INPUT" &&
    document.activeElement?.tagName !== "TEXTAREA"
  ) {
    event.preventDefault();
    $("#search").focus();
  }
});

if (localStorage.getItem("aninews-theme") === "light") {
  document.documentElement.classList.add("light");
  $("#theme").innerHTML =
    "<span aria-hidden=\"true\">◑</span><span>Dark</span>";
}

load();