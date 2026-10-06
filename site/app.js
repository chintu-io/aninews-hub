const state = {
  payload: null,
  source: "all",
  query: "",
  language: "en",
  page: 1,
  pageSize: 12,
  translationGeneration: 0
};

const $ = selector => document.querySelector(selector);

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

  const minutes =
    Math.floor(
      (Date.now() - date.getTime()) /
      60000
    );

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

  const age =
    Date.now() -
    date.getTime();

  return (
    age >= 0 &&
    age <= 6 * 60 * 60 * 1000
  );
}

function hasJapanese(value = "") {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(
    String(value || "")
  );
}

function translationCacheRead() {
  try {
    return JSON.parse(
      localStorage.getItem(
        "aninews-translations-v1"
      ) || "{}"
    );
  } catch {
    return {};
  }
}

function translationCacheWrite(cache) {
  try {
    localStorage.setItem(
      "aninews-translations-v1",
      JSON.stringify(cache)
    );
  } catch {
    /*
     * Translation remains usable for
     * the current session even if
     * persistent storage is unavailable.
     */
  }
}

async function translateText(text) {
  const input =
    String(text || "").trim();

  if (
    !input ||
    !hasJapanese(input)
  ) {
    return input;
  }

  for (
    const endpoint of
      TRANSLATION_ENDPOINTS
  ) {
    try {
      const response =
        await fetch(
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              q: input,
              source: "ja",
              target: "en",
              format: "text"
            }),
            signal:
              AbortSignal.timeout(
                15000
              )
          }
        );

      if (!response.ok) {
        continue;
      }

      const data =
        await response.json();

      const translated =
        String(
          data?.translatedText ||
          ""
        ).trim();

      if (translated) {
        return translated;
      }
    } catch {
      /*
       * Try the next translation
       * endpoint.
       */
    }
  }

  return input;
}

async function ensureTranslation(article) {
  if (
    article.source?.language !==
    "ja"
  ) {
    return article;
  }

  if (
    article.translatedTitle &&
    article.translatedExcerpt
  ) {
    return article;
  }

  const cache =
    translationCacheRead();

  const originalKey =
    [
      article.title || "",
      article.excerpt || ""
    ].join("\n");

  const key =
    article.id +
    ":" +
    btoa(
      unescape(
        encodeURIComponent(
          originalKey
        )
      )
    )
      .replace(
        /[^a-zA-Z0-9]/g,
        ""
      )
      .slice(
        0,
        48
      );

  if (cache[key]) {
    return {
      ...article,
      translatedTitle:
        cache[key].title,
      translatedExcerpt:
        cache[key].excerpt
    };
  }

  const translatedTitle =
    await translateText(
      article.title || ""
    );

  const translatedExcerpt =
    await translateText(
      article.excerpt || ""
    );

  const value = {
    title:
      translatedTitle ||
      article.title ||
      "",
    excerpt:
      translatedExcerpt ||
      article.excerpt ||
      ""
  };

  cache[key] =
    value;

  translationCacheWrite(
    cache
  );

  return {
    ...article,
    translatedTitle:
      value.title,
    translatedExcerpt:
      value.excerpt
  };
}

async function translateVisibleJapanese(
  articles
) {
  if (
    state.language !==
    "ja" ||
    !articles.length
  ) {
    return;
  }

  const generation =
    ++state.translationGeneration;

  const queue =
    [
      ...articles
    ];

  const workers =
    Array.from(
      {
        length:
          Math.min(
            3,
            queue.length
          )
      },
      async () => {
        while (
          queue.length &&
          generation ===
            state.translationGeneration
        ) {
          const article =
            queue.shift();

          if (!article) {
            return;
          }

          const translated =
            await ensureTranslation(
              article
            );

          article.translatedTitle =
            translated.translatedTitle;

          article.translatedExcerpt =
            translated.translatedExcerpt;

          article.translationReady =
            true;

          if (
            generation ===
            state.translationGeneration
          ) {
            const card =
              document.querySelector(
                '[data-article-id="' +
                  CSS.escape(
                    article.id
                  ) +
                '"]'
              );

            if (card) {
              const title =
                card.querySelector(
                  ".story-title"
                );

              const excerpt =
                card.querySelector(
                  ".story-excerpt"
                );

              const badge =
                card.querySelector(
                  ".story-translation"
                );

              if (title) {
                title.textContent =
                  article.translatedTitle ||
                  article.title;
              }

              if (excerpt) {
                excerpt.textContent =
                  article.translatedExcerpt ||
                  article.excerpt ||
                  "";
              }

              if (
                badge &&
                (
                  article.translatedTitle !==
                    article.title ||
                  article.translatedExcerpt !==
                    article.excerpt
                )
              ) {
                badge.hidden = false;
              }
            }
          }
        }
      }
    );

  await Promise.all(
    workers
  );
}

function renderNavigation() {
  const allSources =
    state.payload?.sources || [];

  const sources =
    allSources.filter(
      source =>
        (source.language || "en") ===
        state.language
    );

  $("#sourceNav").innerHTML =
    sources.map(
      source =>
        "<a href=\"" +
        esc(source.siteUrl) +
        "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
        esc(source.name) +
        "</a>"
    ).join("");

  $("#sources").innerHTML =
    sources.map(
      source => {
        const result =
          state.payload?.sourceResults?.find(
            item =>
              item.id ===
              source.id
          );

        const status =
          result?.status === "ok"
            ? result.count +
              " stories"
            : "unavailable";

        return (
          "<div class=\"source-item\">" +
            "<a class=\"source-link\" href=\"" +
              esc(source.siteUrl) +
              "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
              "<span class=\"source-name\">" +
                esc(source.name) +
              "</span>" +
              "<span class=\"source-meta\">" +
                esc(status) +
              "</span>" +
            "</a>" +
            "<a class=\"source-rss\" href=\"rss/" +
              encodeURIComponent(source.id) +
              ".xml\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"" +
              esc(source.name) +
              " RSS feed\" aria-label=\"" +
              esc(source.name) +
              " RSS feed\">RSS</a>" +
          "</div>"
        );
      }
    ).join("");
}

function renderLanguageTabs() {
  const tabs =
    document.querySelector(
      "#languageTabs"
    );

  if (!tabs) return;

  const englishCount =
    (
      state.payload?.sources ||
      []
    ).filter(
      source =>
        (source.language || "en") ===
        "en"
    ).length;

  const japaneseCount =
    (
      state.payload?.sources ||
      []
    ).filter(
      source =>
        source.language ===
        "ja"
    ).length;

  tabs.innerHTML =
    "<button type=\"button\" class=\"language-tab" +
    (state.language === "en"
      ? " active"
      : "") +
    "\" data-language=\"en\">" +
      "<span class=\"language-tab-main\">English</span>" +
      "<span class=\"language-tab-sub\">" +
        englishCount +
        " sources" +
      "</span>" +
    "</button>" +
    "<button type=\"button\" class=\"language-tab" +
    (state.language === "ja"
      ? " active"
      : "") +
    "\" data-language=\"ja\">" +
      "<span class=\"language-tab-main\">日本語 → English</span>" +
      "<span class=\"language-tab-sub\">" +
        japaneseCount +
        " sources · auto translated" +
      "</span>" +
    "</button>";

  tabs
    .querySelectorAll(
      ".language-tab"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          () => {
            const next =
              button.dataset.language;

            if (
              next ===
              state.language
            ) {
              return;
            }

            state.language =
              next;

            state.source =
              "all";

            resetPage();
            state.translationGeneration++;

            renderLanguageTabs();
            renderNavigation();
            renderFilters();
            syncFilters();
            renderStories();
          }
        );
      }
    );
}

function renderFilters() {
  const sources =
    (
      state.payload?.sources ||
      []
    ).filter(
      source =>
        (source.language || "en") ===
        state.language
    );

  $("#filters").innerHTML =
    [
      "<button type=\"button\" class=\"active\" data-source=\"all\">All</button>"
    ].concat(
      sources.map(
        source =>
          "<button type=\"button\" data-source=\"" +
          esc(source.id) +
          "\">" +
          esc(source.short) +
          "</button>"
      )
    ).join("");

  $("#filters")
    .querySelectorAll(
      "button"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          () => {
            state.source =
              button.dataset.source;

            resetPage();
            syncFilters();
            renderStories();
          }
        );
      }
    );
}

function syncFilters() {
  $("#filters")
    .querySelectorAll(
      "button"
    )
    .forEach(
      button => {
        button.classList.toggle(
          "active",
          button.dataset.source ===
            state.source
        );
      }
    );

  const source =
    state.payload?.sources?.find(
      item =>
        item.id ===
        state.source
    );

  if (
    state.language ===
    "ja"
  ) {
    $("#heading").textContent =
      source?.name ||
      "Japanese news · translated";
  } else {
    $("#heading").textContent =
      source?.name ||
      "All stories";
  }
}

function matches(article) {
  const query =
    state.query
      .trim()
      .toLowerCase();

  if (!query) return true;

  return [
    article.title,
    article.excerpt,
    article.translatedTitle,
    article.translatedExcerpt,
    article.source?.name,
    article.source?.category
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function getStories() {
  return (
    state.payload?.articles ||
    []
  ).filter(
    article => {
      const sourceMatches =
        (state.source === "all" ||
          article.source?.id ===
            state.source);

      const languageMatches =
        (article.source?.language ||
          "en") ===
        state.language;

      return (
        sourceMatches &&
        languageMatches &&
        matches(article)
      );
    }
  );
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
      total /
      state.pageSize
    )
  );
}

function resetPage() {
  state.page = 1;
}

function renderPagination(total) {
  const pagination =
    document.querySelector(
      "#pagination"
    );

  const paginationTop =
    document.querySelector(
      "#paginationTop"
    );

  if (!pagination) {
    return;
  }

  const pageCount =
    getPageCount(total);

  if (pageCount <= 1) {
    pagination.innerHTML = "";
    pagination.hidden = true;

    if (paginationTop) {
      paginationTop.innerHTML = "";
      paginationTop.hidden = true;
    }

    return;
  }

  pagination.hidden =
    false;

  if (paginationTop) {
    paginationTop.hidden =
      false;
  }

  const pages = [];
  const addPage = page => {
    if (!pages.includes(page)) {
      pages.push(page);
    }
  };

  addPage(1);

  for (
    let page =
      Math.max(
        2,
        state.page - 2
      );
    page <=
      Math.min(
        pageCount - 1,
        state.page + 2
      );
    page++
  ) {
    addPage(page);
  }

  addPage(
    pageCount
  );

  let html = "";

  html +=
    "<button class=\"page-button\" type=\"button\" data-page=\"" +
    (state.page - 1) +
    "\" aria-label=\"Previous page\" " +
    (state.page === 1
      ? "disabled"
      : "") +
    ">‹</button>";

  let previous = null;

  pages.forEach(
    page => {
      if (
        previous !== null &&
        page -
          previous >
          1
      ) {
        html +=
          "<span class=\"page-ellipsis\" aria-hidden=\"true\">…</span>";
      }

      html +=
        "<button class=\"page-button" +
        (page ===
          state.page
          ? " active"
          : "") +
        "\" type=\"button\" data-page=\"" +
        page +
        "\" aria-label=\"Page " +
        page +
        "\">" +
        page +
        "</button>";

      previous =
        page;
    }
  );

  html +=
    "<button class=\"page-button\" type=\"button\" data-page=\"" +
    (state.page + 1) +
    "\" aria-label=\"Next page\" " +
    (state.page ===
      pageCount
      ? "disabled"
      : "") +
    ">›</button>";

  const bindPagination =
    control => {
      control.innerHTML =
        html;

      control
        .querySelectorAll(
          ".page-button"
        )
        .forEach(
          button => {
            if (
              button.disabled
            ) {
              return;
            }

            button.addEventListener(
              "click",
              () => {
                const requested =
                  Number(
                    button.dataset.page
                  );

                if (
                  requested >= 1 &&
                  requested <=
                    pageCount &&
                  requested !==
                    state.page
                ) {
                  state.page =
                    requested;

                  renderStories();

                  document
                    .querySelector(
                      ".section-head"
                    )
                    ?.scrollIntoView({
                      behavior:
                        "smooth",
                      block:
                        "start"
                    });
                }
              }
            );
          }
        );
    };

  bindPagination(
    pagination
  );

  if (paginationTop) {
    bindPagination(
      paginationTop
    );
  }

  const first =
    (state.page - 1) *
      state.pageSize +
    1;

  const last =
    Math.min(
      state.page *
        state.pageSize,
      total
    );

  const info =
    document.querySelector(
      "#paginationInfo"
    );

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
        "<span class=\"fallback-mark\" aria-hidden=\"true\">✦</span>" +
        "<strong class=\"fallback-brand\">AniNews Hub</strong>" +
        "<span class=\"image-fallback-label\" aria-hidden=\"true\">" +
          esc(sourceLabel) +
        "</span>" +
      "</div>"
    );
  }

  return (
    "<div class=\"story-image\">" +
      "<img src=\"" +
      esc(article.image) +
      "\" alt=\"\" loading=\"lazy\" referrerpolicy=\"no-referrer\" onerror=\"this.remove();this.parentElement.classList.add('image-failed')\" />" +
      "<div class=\"image-error-brand\" aria-hidden=\"true\">" +
        "<span class=\"fallback-mark\">✦</span>" +
        "<strong class=\"fallback-brand\">AniNews Hub</strong>" +
        "<span class=\"image-fallback-label\">" +
          esc(sourceLabel) +
        "</span>" +
      "</div>" +
    "</div>"
  );
}

function renderStories() {
  const stories =
    getStories();

  const pageCount =
    getPageCount(
      stories.length
    );

  if (
    state.page >
    pageCount
  ) {
    state.page =
      pageCount;
  }

  const visibleStories =
    getPageStories(
      stories
    );

  $("#count").textContent =
    stories.length.toLocaleString() +
    " " +
    (stories.length === 1
      ? "story"
      : "stories");

  $("#empty").hidden =
    stories.length > 0;

  $("#grid").innerHTML =
    visibleStories
      .map(
        (article, index) => {
          const featured =
            state.page ===
              1 &&
            index ===
              0;

          const fresh =
            isFresh(
              article.publishedAt
            );

          const sourceAccent =
            article.source?.accent ||
            "#b892ff";

          const title =
            state.language ===
              "ja" &&
            article.translatedTitle
              ? article.translatedTitle
              : article.title;

          const excerptText =
            state.language ===
              "ja" &&
            article.translatedExcerpt
              ? article.translatedExcerpt
              : article.excerpt ||
                article.description ||
                "Open the original publisher for the complete story.";

          return (
            "<a class=\"story" +
            (featured
              ? " featured"
              : "") +
            "\" data-article-id=\"" +
            esc(article.id) +
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
                    esc(
                      article.source?.name ||
                      "Publisher"
                    ) +
                  "</span>" +
                  "<span>•</span>" +
                  "<time datetime=\"" +
                    esc(
                      article.publishedAt ||
                      ""
                    ) +
                  "\">" +
                    esc(
                      relativeDate(
                        article.publishedAt
                      )
                    ) +
                  "</time>" +
                  (fresh
                    ? "<span class=\"story-fresh\">NEW</span>"
                    : "") +
                  (
                    state.language ===
                      "ja"
                      ? "<span class=\"story-translation\" hidden>EN</span>"
                      : ""
                  ) +
                "</div>" +
                "<div class=\"story-content\">" +
                  "<h3 class=\"story-title\">" +
                    esc(
                      title ||
                      "Untitled"
                    ) +
                  "</h3>" +
                  "<p class=\"story-excerpt\">" +
                    esc(
                      excerptText
                    ) +
                  "</p>" +
                "</div>" +
                "<div class=\"story-footer\">" +
                  "<span class=\"story-read\">" +
                    (
                      state.language ===
                        "ja"
                        ? "Read Japanese original"
                        : "Read original"
                    ) +
                  "</span>" +
                  "<span class=\"story-arrow\" aria-hidden=\"true\">↗</span>" +
                "</div>" +
              "</div>" +
            "</a>"
          );
        }
      )
      .join("");

  renderPagination(
    stories.length
  );

  if (
    state.language ===
      "ja"
  ) {
    translateVisibleJapanese(
      visibleStories
    );
  }
}

function renderStats() {
  const allArticles =
    state.payload?.articles ||
    [];

  const articles =
    allArticles.filter(
      article =>
        (article.source?.language ||
          "en") ===
        state.language
    );

  const newest =
    articles.find(
      article =>
        article.publishedAt
    );

  $("#storyCount").textContent =
    articles.length.toLocaleString();

  $("#sourceCount").textContent =
    String(
      (
        state.payload?.sources ||
        []
      ).filter(
        source =>
          (source.language ||
            "en") ===
          state.language
      ).length
    );

  $("#latest").textContent =
    newest
      ? relativeDate(
          newest.publishedAt
        )
      : "—";

  $("#updated").textContent =
    state.payload?.generatedAt
      ? "updated " +
        relativeDate(
          state.payload.generatedAt
        )
      : "waiting for update";

  const failed =
    (
      state.payload?.sourceResults ||
      []
    ).filter(
      item =>
        item.status ===
          "error" &&
        (
          state.payload?.sources ||
          []
        ).find(
          source =>
            source.id ===
              item.id &&
            (
              source.language ||
              "en"
            ) ===
              state.language
        )
    ).length;

  $("#status").textContent =
    failed
      ? failed +
        " source" +
        (failed === 1
          ? ""
          : "s") +
        " unavailable"
      : "all " +
        (
          state.language ===
            "ja"
            ? "Japanese"
            : "English"
        ) +
        " sources refreshed";
}

async function load() {
  $("#status").textContent =
    "Refreshing";

  try {
    const response =
      await fetch(
        "data/articles.json?ts=" +
          Date.now(),
        {
          cache:
            "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        "HTTP " +
          response.status
      );
    }

    state.payload =
      await response.json();

    renderStats();
    renderLanguageTabs();
    renderNavigation();
    renderFilters();
    syncFilters();
    renderStories();
  } catch (error) {
    console.error(error);

    $("#status").textContent =
      "Unable to load news";

    $("#grid").innerHTML =
      "<div class=\"empty\">" +
        "<div class=\"empty-icon\" aria-hidden=\"true\">✧</div>" +
        "<h3>No story data yet.</h3>" +
        "<p>Run the GitHub Actions refresh.</p>" +
      "</div>";
  }
}

$("#search").addEventListener(
  "input",
  event => {
    state.query =
      event.target.value;

    resetPage();
    renderStories();
  }
);

$("#refresh").addEventListener(
  "click",
  load
);

$("#theme").addEventListener(
  "click",
  () => {
    document.documentElement.classList.toggle(
      "light"
    );

    const light =
      document.documentElement.classList.contains(
        "light"
      );

    localStorage.setItem(
      "aninews-theme",
      light
        ? "light"
        : "dark"
    );

    $("#theme").innerHTML =
      "<span aria-hidden=\"true\">" +
        (light
          ? "◑"
          : "◐") +
      "</span><span>" +
        (light
          ? "Dark"
          : "Light") +
      "</span>";
  }
);

window.addEventListener(
  "keydown",
  event => {
    if (
      event.key === "/" &&
      document.activeElement?.tagName !==
        "INPUT" &&
      document.activeElement?.tagName !==
        "TEXTAREA"
    ) {
      event.preventDefault();
      $("#search").focus();
    }
  }
);

if (
  localStorage.getItem(
    "aninews-theme"
  ) ===
  "light"
) {
  document.documentElement.classList.add(
    "light"
  );

  $("#theme").innerHTML =
    "<span aria-hidden=\"true\">◑</span><span>Dark</span>";
}

load();