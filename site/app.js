/**
 * AniNews Hub — Modern Anime & Japanese Culture News Magazine
 * Production Application Script
 */

const state = {
  payload: null,
  source: "all",
  category: "all",
  query: "",
  language: "all", // Default to 'all' so no publishers or categories are locked out
  sort: "newest",
  view: localStorage.getItem("aninews-view-mode") || "grid",
  page: 1,
  pageSize: 12,
  tickerIndex: 0,
  tickerInterval: null,
  translationGeneration: 0,
  bookmarks: new Set(JSON.parse(localStorage.getItem("aninews-bookmarks-v2") || "[]")),
  readIds: new Set(JSON.parse(localStorage.getItem("aninews-read-stories-v2") || "[]"))
};

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

const esc = value =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const TRANSLATION_ENDPOINTS = [
  "https://translate.argosopentech.com/translate",
  "https://libretranslate.de/translate"
];

/* Toast Notification Utility */
function showToast(message, icon = "✦") {
  const container = $("#toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${esc(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 2400);
}

/* Date & Time Formatting */
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

function isFresh(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const age = Date.now() - date.getTime();
  return age >= 0 && age <= 6 * 60 * 60 * 1000;
}

function estimateReadingTime(text = "") {
  const words = String(text).trim().split(/\s+/).length;
  const mins = Math.max(1, Math.round(words / 45));
  return `${mins} min read`;
}

function hasJapanese(value = "") {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value || ""));
}

/* Translation Cache */
const TRANSLATION_CACHE_LIMIT = 500;

function boundedTranslationCache(cache) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return {};
  const entries = Object.entries(cache);
  return entries.length > TRANSLATION_CACHE_LIMIT
    ? Object.fromEntries(entries.slice(-TRANSLATION_CACHE_LIMIT))
    : cache;
}

function translationCacheRead() {
  try {
    return boundedTranslationCache(
      JSON.parse(localStorage.getItem("aninews-translations-v1") || "{}")
    );
  } catch {
    return {};
  }
}

function translationCacheWrite(cache) {
  try {
    localStorage.setItem(
      "aninews-translations-v1",
      JSON.stringify(boundedTranslationCache(cache))
    );
  } catch {}
}

async function translateText(text) {
  const input = String(text || "").trim();
  if (!input || !hasJapanese(input)) return input;

  for (const endpoint of TRANSLATION_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: input,
          source: "ja",
          target: "en",
          format: "text"
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) continue;

      const data = await response.json();
      const output = String(data?.translatedText || "").trim();
      if (output && output !== input) {
        return output;
      }
    } catch {}
  }
  return input;
}

function translationFingerprint(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

async function ensureTranslation(article) {
  if (!article) return article;

  const titleInput = String(article.title || "").trim();
  const excerptInput = String(article.excerpt || article.description || "").trim();

  const titleJa = hasJapanese(titleInput);
  const excerptJa = hasJapanese(excerptInput);

  if (!titleJa && !excerptJa) {
    return {
      translatedTitle: titleInput,
      translatedExcerpt: excerptInput
    };
  }

  const cache = translationCacheRead();
  let changed = false;

  let translatedTitle = article.translatedTitle;
  if (!translatedTitle && titleJa) {
    const key = "title:" + translationFingerprint(titleInput);
    if (cache[key]) {
      translatedTitle = cache[key];
    } else {
      translatedTitle = await translateText(titleInput);
      if (translatedTitle && translatedTitle !== titleInput) {
        cache[key] = translatedTitle;
        changed = true;
      }
    }
  }

  let translatedExcerpt = article.translatedExcerpt;
  if (!translatedExcerpt && excerptJa) {
    const key = "excerpt:" + translationFingerprint(excerptInput);
    if (cache[key]) {
      translatedExcerpt = cache[key];
    } else {
      translatedExcerpt = await translateText(excerptInput);
      if (translatedExcerpt && translatedExcerpt !== excerptInput) {
        cache[key] = translatedExcerpt;
        changed = true;
      }
    }
  }

  if (changed) {
    translationCacheWrite(cache);
  }

  return {
    translatedTitle: translatedTitle || titleInput,
    translatedExcerpt: translatedExcerpt || excerptInput
  };
}

async function translateVisibleJapanese(articles) {
  const needsTranslation = articles.filter(a => (a.source?.language === "ja" || hasJapanese(a.title)));
  if (!needsTranslation.length) return;

  const generation = ++state.translationGeneration;
  const queue = [...needsTranslation];

  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && generation === state.translationGeneration) {
      const article = queue.shift();
      if (!article) return;

      const translated = await ensureTranslation(article);
      article.translatedTitle = translated.translatedTitle;
      article.translatedExcerpt = translated.translatedExcerpt;
      article.translationReady = true;

      if (generation === state.translationGeneration) {
        const cards = document.querySelectorAll(`[data-article-id="${CSS.escape(article.id)}"]`);
        cards.forEach(card => {
          const title = card.querySelector(".story-title");
          const excerpt = card.querySelector(".story-excerpt");
          const badge = card.querySelector(".story-translation");

          if (title) title.textContent = article.translatedTitle || article.title;
          if (excerpt) excerpt.textContent = article.translatedExcerpt || article.excerpt || "";
          if (badge && (article.translatedTitle !== article.title || article.translatedExcerpt !== article.excerpt)) {
            badge.textContent = "EN";
            badge.title = "Translated from Japanese";
            badge.hidden = false;
          }
        });
      }
    }
  });

  await Promise.all(workers);
}

/* Category Classification */
function articleBelongsToCategory(article, category) {
  if (category === "all") return true;
  if (category === "saved") return state.bookmarks.has(article.id);

  const sourceId = article.source?.id;
  if (category === "anime") {
    return ["ann", "crunchyroll", "mal", "sankaku"].includes(sourceId);
  }
  if (category === "japan") {
    return ["soranews24", "sankaku"].includes(sourceId);
  }
  if (category === "gaming") {
    return ["sankaku"].includes(sourceId);
  }
  if (category === "music") {
    return ["billboardjapan", "barks", "ototoy"].includes(sourceId);
  }
  return true;
}

/* Match Filter & Query */
function matches(article) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;

  return [
    article.title,
    article.excerpt,
    article.description,
    article.translatedTitle,
    article.translatedExcerpt,
    article.source?.name,
    article.source?.short,
    article.source?.category
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

/* Get filtered and sorted stories without filter conflicts */
function getFilteredStories() {
  const allArticles = state.payload?.articles || [];

  return allArticles
    .filter(article => {
      // 1. Category match
      if (!articleBelongsToCategory(article, state.category)) return false;

      // 2. Source match (when specific publisher is chosen)
      if (state.source !== "all" && article.source?.id !== state.source) return false;

      // 3. Language match (only if explicitly filtered by EN or JA)
      if (state.language !== "all") {
        const artLang = article.source?.language || "en";
        if (artLang !== state.language) return false;
      }

      // 4. Search query match
      return matches(article);
    })
    .sort((a, b) => {
      const timeA = new Date(a.publishedAt || 0).getTime();
      const timeB = new Date(b.publishedAt || 0).getTime();
      return state.sort === "oldest" ? timeA - timeB : timeB - timeA;
    });
}

function getPageStories(stories) {
  const start = (state.page - 1) * state.pageSize;
  return stories.slice(start, start + state.pageSize);
}

function getPageCount(total) {
  return Math.max(1, Math.ceil(total / state.pageSize));
}

function resetPage() {
  state.page = 1;
}

/* Bookmark Utilities */
function toggleBookmark(articleId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (state.bookmarks.has(articleId)) {
    state.bookmarks.delete(articleId);
    showToast("Removed from bookmarks", "☆");
  } else {
    state.bookmarks.add(articleId);
    showToast("Added to bookmarks", "★");
  }

  try {
    localStorage.setItem("aninews-bookmarks-v2", JSON.stringify([...state.bookmarks]));
  } catch {}

  updateBookmarkBadges();

  if (state.category === "saved") {
    renderStories();
  }
}

function updateBookmarkBadges() {
  const count = state.bookmarks.size;
  const badge = $("#savedCountBadge");
  if (badge) {
    badge.textContent = count;
    badge.hidden = count === 0;
  }

  $$("[data-bookmark-btn]").forEach(btn => {
    const id = btn.dataset.bookmarkBtn;
    const isBookmarked = state.bookmarks.has(id);
    btn.classList.toggle("bookmarked", isBookmarked);
    btn.setAttribute("aria-label", isBookmarked ? "Remove bookmark" : "Save story");
    btn.setAttribute("title", isBookmarked ? "Remove bookmark" : "Save story");
    btn.innerHTML = `<span aria-hidden="true">${isBookmarked ? "★" : "☆"}</span>`;
  });
}

/* Read Stories Utilities */
function markAsRead(articleId) {
  if (!state.readIds.has(articleId)) {
    state.readIds.add(articleId);
    try {
      localStorage.setItem("aninews-read-stories-v2", JSON.stringify([...state.readIds]));
    } catch {}
    $$(`[data-article-id="${CSS.escape(articleId)}"]`).forEach(el => {
      el.classList.add("is-read");
    });
  }
}

/* Copy Link Utility */
function copyStoryLink(link, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!navigator.clipboard) {
    showToast("Clipboard not available", "⚠");
    return;
  }
  navigator.clipboard.writeText(link).then(() => {
    showToast("Link copied to clipboard!", "🔗");
  }).catch(() => {
    showToast("Could not copy link", "⚠");
  });
}

/* Render Breaking News Ticker */
function setupBreakingTicker() {
  const articles = (state.payload?.articles || [])
    .filter(article => state.language === "all" || (article.source?.language || "en") === state.language)
    .slice(0, 15);
  if (!articles.length) return;

  const itemEl = $("#tickerItem");
  if (!itemEl) return;

  function showTickerStory(index) {
    state.tickerIndex = (index + articles.length) % articles.length;
    const story = articles[state.tickerIndex];
    if (!story) return;

    itemEl.style.opacity = "0";
    setTimeout(() => {
      itemEl.href = story.link;
      itemEl.dataset.articleId = story.id;
      itemEl.innerHTML = `
        <span class="ticker-source" style="color: ${esc(story.source?.accent || '#f07858')}">
          ${esc(story.source?.short || story.source?.name || "NEWS")}
        </span>
        <span class="ticker-title">${esc(story.title)}</span>
        <span class="ticker-time">${esc(relativeDate(story.publishedAt))}</span>
        <span class="ticker-arrow" aria-hidden="true">↗</span>
      `;
      itemEl.style.opacity = "1";
    }, 150);
  }

  showTickerStory(0);

  if (state.tickerInterval) clearInterval(state.tickerInterval);
  state.tickerInterval = setInterval(() => {
    showTickerStory(state.tickerIndex + 1);
  }, 6500);

  $("#tickerPrev").onclick = () => showTickerStory(state.tickerIndex - 1);
  $("#tickerNext").onclick = () => showTickerStory(state.tickerIndex + 1);
}

/* Render the newest stories that have usable artwork. */
function renderSpotlight() {
  const section = $("#spotlightSection");
  const grid = $("#spotlightGrid");
  if (!section || !grid) return;

  // Show spotlight only on page 1 with all categories & no search query
  const shouldShow =
    state.page === 1 &&
    state.category === "all" &&
    state.source === "all" &&
    state.language === "all" &&
    !state.query.trim();

  if (!shouldShow) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  // Select the three newest stories with images, without changing the feed order.
  const allArticles = state.payload?.articles || [];
  const newestFirst = allArticles.slice().sort((a, b) =>
    new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
  );
  const featured = newestFirst.filter(a => !!a.image).slice(0, 3);
  if (featured.length < 3) {
    featured.push(...newestFirst.filter(a => !featured.includes(a)).slice(0, 3 - featured.length));
  }

  if (featured.length === 0) {
    section.style.display = "none";
    return;
  }

  const [lead, sec1, sec2] = featured;

  const leadTitle = (hasJapanese(lead?.title) && lead?.translatedTitle) ? lead.translatedTitle : lead?.title;
  const leadExcerpt = (hasJapanese(lead?.excerpt) && lead?.translatedExcerpt) ? lead.translatedExcerpt : (lead?.excerpt || lead?.description || "");
  const leadAccent = lead?.source?.accent || "#f07858";
  const leadBookmarked = state.bookmarks.has(lead?.id);
  const leadRead = state.readIds.has(lead?.id);

  let html = `
    <!-- Lead Main Feature -->
    <article class="spotlight-lead ${leadRead ? 'is-read' : ''}" data-article-id="${esc(lead?.id)}">
      <a class="spotlight-lead-link" href="${esc(lead?.link)}" target="_blank" rel="noopener noreferrer">
        <div class="spotlight-image-wrap">
          ${lead?.image ? `<img src="${esc(lead.image)}" alt="${esc(leadTitle)}" loading="eager" referrerpolicy="no-referrer" onerror="this.style.display='none';" />` : ''}
          <div class="spotlight-overlay"></div>
        </div>
        <div class="spotlight-lead-content">
          <div class="spotlight-meta">
            <span class="spotlight-badge" style="background: ${esc(leadAccent)}22; color: ${esc(leadAccent)}; border-color: ${esc(leadAccent)}55;">
              ${esc(lead?.source?.short || lead?.source?.name || "NEWS")}
            </span>
            <span class="spotlight-dot">•</span>
            <time class="spotlight-date" datetime="${esc(lead?.publishedAt || '')}" title="${formatDate(lead?.publishedAt)}">
              ${esc(relativeDate(lead?.publishedAt))}
            </time>
            ${isFresh(lead?.publishedAt) ? '<span class="pill-fresh">NEW</span>' : ''}
            <span class="spotlight-readtime">${estimateReadingTime(leadTitle + " " + leadExcerpt)}</span>
          </div>
          <h2 class="spotlight-lead-title">${esc(leadTitle || "Untitled")}</h2>
          <p class="spotlight-lead-excerpt">${esc(leadExcerpt)}</p>
          <div class="spotlight-lead-footer">
            <span class="spotlight-cta">
              <span>Read Full Story</span>
              <span aria-hidden="true">↗</span>
            </span>
          </div>
        </div>
      </a>
      <div class="card-floating-actions">
        <button class="action-btn-circle ${leadBookmarked ? 'bookmarked' : ''}" data-bookmark-btn="${esc(lead?.id)}" type="button" aria-label="Save story" title="Save story">
          <span aria-hidden="true">${leadBookmarked ? '★' : '☆'}</span>
        </button>
        <button class="action-btn-circle" data-share-link="${esc(lead?.link)}" type="button" aria-label="Copy link" title="Copy link">
          <span aria-hidden="true">🔗</span>
        </button>
      </div>
    </article>
  `;

  // Secondary stack
  const secondaryStories = [sec1, sec2].filter(Boolean);
  if (secondaryStories.length) {
    html += `<div class="spotlight-side-stack">`;
    secondaryStories.forEach(sec => {
      const secTitle = (hasJapanese(sec.title) && sec.translatedTitle) ? sec.translatedTitle : sec.title;
      const secAccent = sec.source?.accent || "#f07858";
      const secBookmarked = state.bookmarks.has(sec.id);
      const secRead = state.readIds.has(sec.id);

      html += `
        <article class="spotlight-card ${secRead ? 'is-read' : ''}" data-article-id="${esc(sec.id)}">
          <a class="spotlight-card-link" href="${esc(sec.link)}" target="_blank" rel="noopener noreferrer">
            <div class="spotlight-card-thumb">
              ${sec.image ? `<img src="${esc(sec.image)}" alt="${esc(secTitle)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';" />` : ''}
              <div class="spotlight-thumb-overlay"></div>
            </div>
            <div class="spotlight-card-body">
              <div class="spotlight-meta">
                <span class="spotlight-badge" style="background: ${esc(secAccent)}22; color: ${esc(secAccent)}; border-color: ${esc(secAccent)}55;">
                  ${esc(sec.source?.short || sec.source?.name || "NEWS")}
                </span>
                <span class="spotlight-dot">•</span>
                <time class="spotlight-date" datetime="${esc(sec.publishedAt || '')}" title="${formatDate(sec.publishedAt)}">
                  ${esc(relativeDate(sec.publishedAt))}
                </time>
              </div>
              <h3 class="spotlight-card-title">${esc(secTitle)}</h3>
              <span class="spotlight-read-link">Read story ↗</span>
            </div>
          </a>
          <div class="card-floating-actions">
            <button class="action-btn-circle ${secBookmarked ? 'bookmarked' : ''}" data-bookmark-btn="${esc(sec.id)}" type="button" aria-label="Save story" title="Save story">
              <span aria-hidden="true">${secBookmarked ? '★' : '☆'}</span>
            </button>
          </div>
        </article>
      `;
    });
    html += `</div>`;
  }

  grid.innerHTML = html;

  // Bind actions
  grid.querySelectorAll("[data-bookmark-btn]").forEach(btn => {
    btn.addEventListener("click", e => toggleBookmark(btn.dataset.bookmarkBtn, e));
  });

  grid.querySelectorAll("[data-share-link]").forEach(btn => {
    btn.addEventListener("click", e => copyStoryLink(btn.dataset.shareLink, e));
  });

  grid.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => {
      const parent = a.closest("[data-article-id]");
      if (parent) markAsRead(parent.dataset.articleId);
    });
  });

  translateVisibleJapanese(featured);
}

const PUBLISHER_DISPLAY_ORDER = [
  "crunchyroll",
  "ann",
  "mal",
  "soranews24",
  "sankaku",
  "barks",
  "billboardjapan",
  "ototoy"
];

function sortPublishersForDisplay(sources) {
  const rank = new Map(PUBLISHER_DISPLAY_ORDER.map((id, index) => [id, index]));
  return [...sources].sort((a, b) =>
    (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
    (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

/* Render Publishers Directory in Sidebar */
function renderPublishersDirectory() {
  const sourcesEl = $("#sources");
  if (!sourcesEl) return;

  let allSources = sortPublishersForDisplay(state.payload?.sources || []);
  if (state.language !== "all") {
    allSources = allSources.filter(source =>
      (source.language || "en") === state.language
    );
  }
  $(".sidebar-badge").textContent = `${allSources.length} PUBLISHERS`;
  const results = state.payload?.sourceResults || [];
  const articles = state.payload?.articles || [];

  sourcesEl.innerHTML = allSources.map(source => {
    const res = results.find(item => item.id === source.id);
    const count = state.language === "all"
      ? (res?.count ?? 0)
      : articles.filter(article => article.source?.id === source.id).length;
    const accent = source.accent || "#f07858";
    const isFiltered = state.source === source.id;

    return `
      <div class="source-directory-item ${isFiltered ? 'is-selected' : ''}" style="--pub-accent: ${esc(accent)}">
        <button type="button" class="source-filter-trigger" data-source-select="${esc(source.id)}" aria-pressed="${isFiltered}">
          <span class="source-accent-dot" style="background: ${esc(accent)}"></span>
          <div class="source-info">
            <span class="source-title">${esc(source.name)}</span>
            <span class="source-category-tag">${esc(source.category || 'News')} · ${count} stories</span>
          </div>
        </button>
        <a class="source-rss-badge" href="rss/${encodeURIComponent(source.id)}.xml" target="_blank" rel="noopener noreferrer" title="${esc(source.name)} RSS feed" aria-label="${esc(source.name)} RSS feed">
          <span>RSS</span>
        </a>
      </div>
    `;
  }).join("");

  sourcesEl.querySelectorAll("[data-source-select]").forEach(btn => {
    btn.addEventListener("click", () => {
      const srcId = btn.dataset.sourceSelect;
      // Selecting a specific publisher clears category and language conflict
      if (state.source === srcId) {
        state.source = "all";
      } else {
        state.source = srcId;
        state.category = "all";
        const selectedSrc = allSources.find(s => s.id === srcId);
        if (selectedSrc) state.language = selectedSrc.language || "en";
      }
      resetPage();
      syncFilterUI();
      setupBreakingTicker();
      renderPublisherChips();
      renderLanguageTabs();
      renderStories();
    });
  });
}

/* Render Filter Chips (Publishers Bar) */
function renderPublisherChips() {
  const container = $("#filters");
  if (!container) return;

  let visibleSources = sortPublishersForDisplay(state.payload?.sources || []);
  if (state.language !== "all") {
    visibleSources = visibleSources.filter(source =>
      (source.language || "en") === state.language
    );
  }
  if (state.category !== "all" && state.category !== "saved") {
    visibleSources = visibleSources.filter(src => {
      if (state.category === "anime") return ["ann", "crunchyroll", "mal", "sankaku"].includes(src.id);
      if (state.category === "japan") return ["soranews24", "sankaku"].includes(src.id);
      if (state.category === "gaming") return ["sankaku"].includes(src.id);
      if (state.category === "music") return ["billboardjapan", "barks", "ototoy"].includes(src.id);
      return true;
    });
  }

  const articles = state.payload?.articles || [];
  const countForSource = sourceId => articles.filter(article =>
    (!sourceId || article.source?.id === sourceId) &&
    (state.language === "all" || (article.source?.language || "en") === state.language)
  ).length;

  const allButton = `
    <button type="button" class="filter-chip ${state.source === 'all' ? 'active' : ''}" data-source="all" aria-pressed="${state.source === 'all'}">
      <span class="chip-label">All Publishers</span>
      <span class="chip-count">${countForSource()}</span>
    </button>
  `;

  const sourceChips = visibleSources.map(source => {
    const accent = source.accent || "#f07858";
    const count = countForSource(source.id);
    const isActive = state.source === source.id;

    return `
      <button type="button" class="filter-chip ${isActive ? 'active' : ''}" data-source="${esc(source.id)}" style="--chip-accent: ${esc(accent)}" aria-pressed="${isActive}">
        <span class="chip-dot" style="background: ${esc(accent)}"></span>
        <span class="chip-label">${esc(source.short || source.name)}</span>
        ${count ? `<span class="chip-count">${count}</span>` : ''}
      </button>
    `;
  }).join("");

  container.innerHTML = allButton + sourceChips;

  container.querySelectorAll(".filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const srcId = btn.dataset.source;
      state.source = srcId;
      // If clicking a publisher outside current category, reset category to all
      if (srcId !== "all") {
        const src = (state.payload?.sources || []).find(s => s.id === srcId);
        if (src && state.language !== "all") state.language = src.language || "en";
      }
      resetPage();
      setupBreakingTicker();
      renderLanguageTabs();
      renderPublisherChips();
      renderPublishersDirectory();
      syncFilterUI();
      renderStories();
    });
  });
}

/* Render Language Segmented Toggle */
function renderLanguageTabs() {
  const container = $("#languageTabs");
  if (!container) return;

  const totalCount = (state.payload?.articles || []).length;
  const enCount = (state.payload?.articles || []).filter(a => (a.source?.language || "en") === "en").length;
  const jaCount = (state.payload?.articles || []).filter(a => a.source?.language === "ja").length;

  container.innerHTML = `
    <button type="button" class="lang-tab ${state.language === 'all' ? 'active' : ''}" data-lang="all" aria-pressed="${state.language === 'all'}">
      <span>All (${totalCount})</span>
    </button>
    <button type="button" class="lang-tab ${state.language === 'en' ? 'active' : ''}" data-lang="en" aria-pressed="${state.language === 'en'}">
      <span>English (${enCount})</span>
    </button>
    <button type="button" class="lang-tab ${state.language === 'ja' ? 'active' : ''}" data-lang="ja" aria-pressed="${state.language === 'ja'}">
      <span>日本語 → EN (${jaCount})</span>
    </button>
  `;

  container.querySelectorAll(".lang-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.lang;
      if (next === state.language) return;

      state.language = next;
      const selectedSource = (state.payload?.sources || []).find(source => source.id === state.source);
      if (selectedSource && next !== "all" && (selectedSource.language || "en") !== next) {
        state.source = "all";
      }
      resetPage();
      state.translationGeneration++;

      renderStats();
      setupBreakingTicker();
      renderLanguageTabs();
      renderPublisherChips();
      renderPublishersDirectory();
      syncFilterUI();
      renderStories();
    });
  });
}

/* Sync Filter UI States */
function syncFilterUI() {
  // Category tabs
  $$(".category-tab").forEach(tab => {
    const isSelected = tab.dataset.category === state.category;
    tab.classList.toggle("active", isSelected);
    tab.setAttribute("aria-selected", isSelected);
  });

  // Source chips
  $$(".filter-chip").forEach(chip => {
    const isActive = chip.dataset.source === state.source;
    chip.classList.toggle("active", isActive);
    chip.setAttribute("aria-pressed", isActive);
  });

  // Sidebar source items
  $$(".source-directory-item").forEach(item => {
    const trigger = item.querySelector("[data-source-select]");
    const isSelected = trigger?.dataset.sourceSelect === state.source;
    item.classList.toggle("is-selected", isSelected);
    trigger?.setAttribute("aria-pressed", isSelected);
  });

  // Saved button
  $("#savedBtn")?.classList.toggle("active", state.category === "saved");

  // Dynamic Page Heading
  const heading = $("#heading");
  if (heading) {
    if (state.category === "saved") {
      heading.textContent = "Saved Bookmarks";
    } else if (state.query) {
      heading.textContent = `Search results for "${state.query}"`;
    } else if (state.source !== "all") {
      const src = state.payload?.sources?.find(s => s.id === state.source);
      heading.textContent = src?.name || "Publisher stories";
    } else if (state.category !== "all") {
      const catMap = {
        anime: "Anime & Manga News",
        japan: "Japan & Culture",
        gaming: "Gaming & Tech",
        music: "Japanese Music"
      };
      heading.textContent = catMap[state.category] || "Stories";
    } else if (state.language === "ja") {
      heading.textContent = "Japanese News (Auto-Translated)";
    } else if (state.language === "en") {
      heading.textContent = "English Stories";
    } else {
      heading.textContent = "All Stories";
    }
  }
}

/* Thumbnail Helper with Reliable Fallback */
function renderThumbnail(article) {
  const sourceLabel = article.source?.short || "NEWS";
  const accent = article.source?.accent || "#f07858";

  if (!article.image) {
    return `
      <div class="story-image fallback" style="--fallback-accent: ${esc(accent)}">
        <span class="fallback-icon" aria-hidden="true">✦</span>
        <strong class="fallback-brand">AniNews Hub</strong>
        <span class="fallback-source-pill">${esc(sourceLabel)}</span>
      </div>
    `;
  }

  return `
    <div class="story-image">
      <img src="${esc(article.image)}" alt="${esc(article.title || '')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
      <div class="story-image fallback fallback-inner" style="display: none; --fallback-accent: ${esc(accent)}; position: absolute; inset: 0;">
        <span class="fallback-icon" aria-hidden="true">✦</span>
        <strong class="fallback-brand">AniNews Hub</strong>
        <span class="fallback-source-pill">${esc(sourceLabel)}</span>
      </div>
    </div>
  `;
}

/* Render Main Story Cards */
function renderStories() {
  const stories = getFilteredStories();
  const pageCount = getPageCount(stories.length);

  if (state.page > pageCount) {
    state.page = pageCount;
  }

  const visibleStories = getPageStories(stories);

  // Update counts
  const countEl = $("#count");
  if (countEl) {
    countEl.textContent = `${stories.length.toLocaleString()} ${stories.length === 1 ? 'story' : 'stories'}`;
  }

  // Handle empty state
  const emptyEl = $("#empty");
  const gridEl = $("#grid");

  if (stories.length === 0) {
    emptyEl.hidden = false;
    emptyEl.style.display = "flex";
    gridEl.innerHTML = "";

    const titleEl = $("#emptyTitle");
    const msgEl = $("#emptyMsg");

    if (state.category === "saved") {
      titleEl.textContent = "No saved bookmarks yet";
      msgEl.textContent = "Click the star icon (★) on any story to save it to your personal reading list.";
    } else if (state.query) {
      titleEl.textContent = `No stories found for "${state.query}"`;
      msgEl.textContent = "Try different keywords or check spelling.";
    } else {
      titleEl.textContent = "No stories match current filters";
      msgEl.textContent = "Try clearing active filters to see all available news.";
    }

    renderPagination(0);
    renderSpotlight();
    return;
  }

  emptyEl.hidden = true;
  emptyEl.style.display = "none";

  // Render Spotlight banner
  renderSpotlight();

  // Render cards
  gridEl.className = `story-list view-${state.view}`;
  gridEl.innerHTML = visibleStories.map(article => {
    const fresh = isFresh(article.publishedAt);
    const sourceAccent = article.source?.accent || "#f07858";
    const isBookmarked = state.bookmarks.has(article.id);
    const isRead = state.readIds.has(article.id);

    const title = (hasJapanese(article.title) && article.translatedTitle)
      ? article.translatedTitle
      : article.title;

    const excerptText = (hasJapanese(article.excerpt) && article.translatedExcerpt)
      ? article.translatedExcerpt
      : (article.excerpt || article.description || "Click to read the complete story on the publisher's website.");

    return `
      <article class="story-card ${isRead ? 'is-read' : ''}" data-article-id="${esc(article.id)}">
        <a class="story-card-link" href="${esc(article.link)}" target="_blank" rel="noopener noreferrer">
          ${renderThumbnail(article)}
          <div class="story-card-body">
            <div class="story-meta" style="--source-accent: ${esc(sourceAccent)}">
              <span class="story-source-badge">
                <span class="story-source-dot"></span>
                <span>${esc(article.source?.short || article.source?.name || "News")}</span>
              </span>
              <span class="story-divider">•</span>
              <time datetime="${esc(article.publishedAt || '')}" title="${formatDate(article.publishedAt)}">
                ${esc(relativeDate(article.publishedAt))}
              </time>
              ${fresh ? '<span class="pill-fresh">NEW</span>' : ''}
              ${hasJapanese(article.title) ? `<span class="story-translation" title="${article.translatedTitle && article.translatedTitle !== article.title ? 'Translated from Japanese' : 'Original Japanese shown; translation unavailable'}">${article.translatedTitle && article.translatedTitle !== article.title ? 'EN' : 'JP'}</span>` : ''}
              <span class="story-readtime">${estimateReadingTime(title + " " + excerptText)}</span>
              <div class="card-floating-actions">
                <button class="action-btn-circle ${isBookmarked ? 'bookmarked' : ''}" data-bookmark-btn="${esc(article.id)}" type="button" aria-label="${isBookmarked ? 'Remove bookmark' : 'Save story'}" title="${isBookmarked ? 'Remove bookmark' : 'Save story'}">
                  <span aria-hidden="true">${isBookmarked ? '★' : '☆'}</span>
                </button>
                <button class="action-btn-circle" data-share-link="${esc(article.link)}" type="button" aria-label="Copy link" title="Copy link">
                  <span aria-hidden="true">🔗</span>
                </button>
              </div>
            </div>

            <h3 class="story-title" title="${esc(title)}">${esc(title || "Untitled")}</h3>
            <p class="story-excerpt">${esc(excerptText)}</p>

            <div class="story-card-footer">
              <span class="story-read-action">
                <span>Read Story</span>
                <span class="story-arrow" aria-hidden="true">↗</span>
              </span>
            </div>
          </div>
        </a>

      </article>
    `;
  }).join("");

  // Bind Card Interactivity
  gridEl.querySelectorAll("[data-bookmark-btn]").forEach(btn => {
    btn.addEventListener("click", e => toggleBookmark(btn.dataset.bookmarkBtn, e));
  });

  gridEl.querySelectorAll("[data-share-link]").forEach(btn => {
    btn.addEventListener("click", e => copyStoryLink(btn.dataset.shareLink, e));
  });

  gridEl.querySelectorAll(".story-card-link").forEach(a => {
    a.addEventListener("click", () => {
      const card = a.closest("[data-article-id]");
      if (card) markAsRead(card.dataset.articleId);
    });
  });

  renderPagination(stories.length);
  translateVisibleJapanese(visibleStories);
}

/* Render Pagination */
function renderPagination(total) {
  const pagination = $("#pagination");
  const paginationTop = $("#paginationTop");
  const paginationInfo = $("#paginationInfo");

  if (!pagination) return;

  const pageCount = getPageCount(total);

  if (pageCount <= 1) {
    pagination.innerHTML = "";
    pagination.hidden = true;
    if (paginationTop) {
      paginationTop.innerHTML = "";
      paginationTop.hidden = true;
    }
    if (paginationInfo) paginationInfo.textContent = "";
    return;
  }

  pagination.hidden = false;
  if (paginationTop) paginationTop.hidden = false;

  const startStory = (state.page - 1) * state.pageSize + 1;
  const endStory = Math.min(total, state.page * state.pageSize);
  if (paginationInfo) {
    paginationInfo.textContent = `Showing ${startStory}–${endStory} of ${total} stories · Page ${state.page} of ${pageCount}`;
  }

  function buildButtons() {
    const buttons = [];

    // Prev Button
    buttons.push(`
      <button type="button" class="page-button page-prev" ${state.page === 1 ? 'disabled' : ''} data-page="${state.page - 1}" aria-label="Previous page">
        ‹ Prev
      </button>
    `);

    let start = Math.max(1, state.page - 2);
    let end = Math.min(pageCount, state.page + 2);

    if (start > 1) {
      buttons.push(`<button type="button" class="page-button" data-page="1" aria-label="Page 1">1</button>`);
      if (start > 2) buttons.push(`<span class="page-ellipsis" aria-hidden="true">…</span>`);
    }

    for (let p = start; p <= end; p++) {
      const isCur = p === state.page;
      buttons.push(`
        <button type="button" class="page-button ${isCur ? 'active' : ''}" data-page="${p}" aria-label="Page ${p}" ${isCur ? 'aria-current="page"' : ''}>
          ${p}
        </button>
      `);
    }

    if (end < pageCount) {
      if (end < pageCount - 1) buttons.push(`<span class="page-ellipsis" aria-hidden="true">…</span>`);
      buttons.push(`<button type="button" class="page-button" data-page="${pageCount}" aria-label="Page ${pageCount}">${pageCount}</button>`);
    }

    // Next Button
    buttons.push(`
      <button type="button" class="page-button page-next" ${state.page === pageCount ? 'disabled' : ''} data-page="${state.page + 1}" aria-label="Next page">
        Next ›
      </button>
    `);

    return buttons.join("");
  }

  const html = buildButtons();
  pagination.innerHTML = html;
  if (paginationTop) paginationTop.innerHTML = html;

  [pagination, paginationTop].forEach(container => {
    container?.querySelectorAll(".page-button").forEach(btn => {
      btn.addEventListener("click", () => {
        const p = parseInt(btn.dataset.page, 10);
        if (!p || p === state.page || p < 1 || p > pageCount) return;
        state.page = p;
        renderStories();
        const grid = $("#grid");
        if (grid) {
          grid.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  });
}

/* Render Quick Stats */
function renderStats() {
  const sources = state.payload?.sources || [];
  const results = state.payload?.sourceResults;
  const genTime = state.payload?.generatedAt;

  if (Array.isArray(results) && results.length) {
    const refreshed = results.filter(result => result.status === "ok").length;
    $("#status").textContent = `${refreshed} of ${results.length} publishers refreshed`;
    $(".status-live-dot")?.classList.toggle("is-partial", refreshed < results.length);
  } else {
    $("#status").textContent = `${sources.length} publishers in the mix`;
    $(".status-live-dot")?.classList.remove("is-partial");
  }
  $("#updated").textContent = genTime ? `Updated ${relativeDate(genTime)}` : "Live";
}

/* View Mode Toggling (Grid vs List) */
function setViewMode(mode) {
  state.view = mode;
  try {
    localStorage.setItem("aninews-view-mode", mode);
  } catch {}

  const isGrid = mode === "grid";
  $("#viewGrid")?.classList.toggle("active", isGrid);
  $("#viewGrid")?.setAttribute("aria-pressed", isGrid);
  $("#viewList")?.classList.toggle("active", !isGrid);
  $("#viewList")?.setAttribute("aria-pressed", !isGrid);

  const grid = $("#grid");
  if (grid) {
    grid.className = `story-list view-${mode}`;
  }
}

/* Theme Toggle */
function setupTheme() {
  const themeBtn = $("#theme");
  const stored = localStorage.getItem("aninews-theme");

  if (stored === "light") {
    document.documentElement.classList.add("light");
    themeBtn.innerHTML = `<span class="action-icon">◑</span><span class="action-label">Dark</span>`;
  } else {
    themeBtn.innerHTML = `<span class="action-icon">◐</span><span class="action-label">Light</span>`;
  }

  themeBtn?.addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
    const isLight = document.documentElement.classList.contains("light");
    try {
      localStorage.setItem("aninews-theme", isLight ? "light" : "dark");
    } catch {}
    themeBtn.innerHTML = `<span class="action-icon">${isLight ? "◑" : "◐"}</span><span class="action-label">${isLight ? "Dark" : "Light"}</span>`;
    showToast(`Switched to ${isLight ? "Light" : "Dark"} theme`, isLight ? "☼" : "☾");
  });
}

/* Main Data Load */
async function load() {
  $("#status").textContent = "Refreshing news...";

  try {
    const response = await fetch("data/articles.json?ts=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);

    state.payload = await response.json();

    renderStats();
    setupBreakingTicker();
    renderLanguageTabs();
    renderPublisherChips();
    renderPublishersDirectory();
    syncFilterUI();
    renderStories();
    updateBookmarkBadges();
  } catch (error) {
    console.error("Failed to load news:", error);
    $("#status").textContent = "Unable to load feed";
    $("#grid").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠</div>
        <h3>Unable to load news</h3>
        <p>Please check your connection and refresh.</p>
        <button id="retryBtn" class="reset-button" type="button">Try Again</button>
      </div>
    `;
    $("#retryBtn")?.addEventListener("click", load);
  }
}

/* Reset All Filters Utility */
function resetAllFilters() {
  state.category = "all";
  state.source = "all";
  state.language = "all";
  state.query = "";
  const searchInput = $("#search");
  const clearBtn = $("#searchClear");
  if (searchInput) {
    searchInput.value = "";
    if (clearBtn) clearBtn.hidden = true;
  }
  resetPage();
  syncFilterUI();
  renderLanguageTabs();
  renderPublisherChips();
  renderPublishersDirectory();
  renderStories();
  showToast("Filters reset to All Stories", "✦");
}

/* Event Listeners Setup */
function setupEvents() {
  // Search input with 120ms debounce
  const searchInput = $("#search");
  const clearBtn = $("#searchClear");
  let searchDebounce;

  searchInput?.addEventListener("input", e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.query = e.target.value;
      clearBtn.hidden = !state.query;
      resetPage();
      syncFilterUI();
      renderStories();
    }, 120);
  });

  clearBtn?.addEventListener("click", () => {
    searchInput.value = "";
    state.query = "";
    clearBtn.hidden = true;
    resetPage();
    syncFilterUI();
    renderStories();
    searchInput.focus();
  });

  // Category Tabs: Selecting a category automatically clears publisher filter conflict
  $$(".category-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const cat = tab.dataset.category;
      state.category = cat;
      state.source = "all"; // Clear specific publisher to prevent conflicting empty intersection
      resetPage();
      syncFilterUI();
      renderPublisherChips();
      renderStories();
    });
  });

  // Saved Bookmarks Button in Topbar
  $("#savedBtn")?.addEventListener("click", () => {
    state.category = state.category === "saved" ? "all" : "saved";
    state.source = "all";
    resetPage();
    syncFilterUI();
    renderPublisherChips();
    renderStories();
  });

  // Sort Dropdown
  $("#sortSelect")?.addEventListener("change", e => {
    state.sort = e.target.value;
    resetPage();
    renderStories();
  });

  // Reset Filters Button in Empty State
  $("#resetFilters")?.addEventListener("click", resetAllFilters);

  // View Switchers
  $("#viewGrid")?.addEventListener("click", () => setViewMode("grid"));
  $("#viewList")?.addEventListener("click", () => setViewMode("list"));

  // Refresh Button
  $("#refresh")?.addEventListener("click", () => {
    const icon = $(".refresh-icon");
    if (icon) icon.classList.add("rotating");
    load().finally(() => {
      setTimeout(() => icon?.classList.remove("rotating"), 600);
      showToast("Stories refreshed", "↻");
    });
  });

  // Keyboard Shortcuts
  window.addEventListener("keydown", e => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      if (e.key === "Escape") {
        document.activeElement.blur();
      }
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      searchInput?.focus();
    } else if (e.key === "g" || e.key === "G") {
      setViewMode("grid");
      showToast("Grid card view", "⊞");
    } else if (e.key === "l" || e.key === "L") {
      setViewMode("list");
      showToast("Compact list view", "☰");
    } else if (e.key === "Escape") {
      resetAllFilters();
    }
  });
}

/* Initialization */
setupTheme();
setViewMode(state.view);
setupEvents();
load();

