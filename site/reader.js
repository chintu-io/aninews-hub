const params = new URLSearchParams(location.search);
const id = params.get("id");
const root = document.querySelector("#reader");

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
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

async function load() {
  try {
    const response = await fetch(`data/articles.json?ts=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const article = payload.articles.find(item => item.id === id);

    if (!article) {
      throw new Error("Story not found");
    }

    document.title = `${article.title} — AniNews Hub`;

    root.innerHTML = `
      <article class="reader-article">
        <p class="eyebrow">${esc(article.source?.name || "Publisher")}</p>

        <h1>${esc(article.title)}</h1>

        <div class="reader-meta">
          ${esc(formatDate(article.publishedAt))}
          <span>·</span>
          <a href="${esc(article.source?.siteUrl || article.link)}"
             target="_blank"
             rel="noopener noreferrer">
            ${esc(article.source?.name || "Original publisher")}
          </a>
        </div>

        ${
          article.image
            ? `<img class="reader-image"
                    src="${esc(article.image)}"
                    alt=""
                    referrerpolicy="no-referrer">`
            : ""
        }

        <p class="reader-excerpt">
          ${esc(article.excerpt || "This story does not provide an RSS excerpt.")}
        </p>

        <div class="reader-actions">
          <a class="reader-primary"
             href="${esc(article.link)}"
             target="_blank"
             rel="noopener noreferrer">
            Read original article ↗
          </a>
        </div>

        <section class="embedded">
          <div class="embedded-head">
            <div>
              <p class="eyebrow">READER VIEW</p>
              <h2>Original article</h2>
            </div>
            <span>embedded from publisher</span>
          </div>

          <div class="frame-wrap">
            <iframe
              src="${esc(article.link)}"
              title="${esc(article.title)}"
              loading="lazy"
              referrerpolicy="strict-origin-when-cross-origin">
            </iframe>

            <div class="frame-fallback">
              <p>
                This publisher does not allow its pages to be embedded here.
              </p>
              <a href="${esc(article.link)}"
                 target="_blank"
                 rel="noopener noreferrer">
                Open on ${esc(article.source?.name || "the original site")} ↗
              </a>
            </div>
          </div>
        </section>

        <p class="reader-credit">
          Story and article content belong to ${esc(article.source?.name || "the original publisher")}.
          This page is a personal reader interface.
        </p>
      </article>
    `;
  } catch (error) {
    console.error(error);

    root.innerHTML = `
      <div class="empty">
        <h3>Story unavailable.</h3>
        <p><a href="./">Return to the news feed.</a></p>
      </div>
    `;
  }
}

load();
