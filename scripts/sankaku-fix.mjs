import fs from "node:fs/promises";
import crypto from "node:crypto";

const OUT = new URL("../site/data/articles.json", import.meta.url);
const DEBUG_OUT = new URL("../site/debug/sankaku.json", import.meta.url);

const SOURCE = {
  id: "sankaku",
  name: "Sankaku Complex",
  short: "Sankaku",
  siteUrl: "https://news.sankakucomplex.com/",
  category: "Anime & Culture",
  accent: "#a78bfa"
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const hash = value =>
  crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 16);

function stripHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#8217;/gi, "’")
    .replace(/&#8220;/gi, "“")
    .replace(/&#8221;/gi, "”")
    .replace(/&#8230;/gi, "…")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(value = "") {
  const title = stripHtml(value)
    .replace(/^#+\s*/, "")
    .trim();

  if (!title) return "";
  if (/^(?:add\s+comment|\d+\s+comments?)$/i.test(title)) return "";
  if (/^just a moment/i.test(title)) return "";

  // Reject Sankaku navigation/promotional blocks that can be mistaken for posts.
  if (/^sankaku companions are the friends you need!/i.test(title)) return "";
  if (/^create infinite art with sankaku ai/i.test(title)) return "";
  if (/^sankaku ai/i.test(title) && title.length < 45) return "";

  return title;
}

function makeExcerpt(value = "") {
  const text = stripHtml(value);

  if (!text) return "";

  return text.length <= 300
    ? text
    : `${text.slice(0, 297).trimEnd()}…`;
}

function isRealUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.hostname.toLowerCase() === "news.sankakucomplex.com" &&
      /^\/n\/[^/?#]+\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",

      accept:
        "text/plain, text/markdown, text/html, application/xhtml+xml, application/json, */*",

      ...(options.headers || {})
    },

    redirect: "follow",
    signal: AbortSignal.timeout(options.timeout ?? 40000)
  });

  return {
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get("content-type") || "",
    body: await response.text()
  };
}

function absoluteUrl(
  value,
  base = "https://news.sankakucomplex.com/"
) {
  try {
    return new URL(String(value || "").trim(), base).href;
  } catch {
    return "";
  }
}

function parseRelativeDate(text, index) {
  const window = text.slice(
    Math.max(0, index - 300),
    Math.min(text.length, index + 700)
  );

  if (/\bjust\s+now\b/i.test(window)) {
    return new Date().toISOString();
  }

  const relative = window.match(
    /\b(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b/i
  );

  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();

    const seconds =
      unit.startsWith("minute")
        ? amount * 60
        : unit.startsWith("hour")
          ? amount * 3600
          : unit.startsWith("day")
            ? amount * 86400
            : amount * 604800;

    return new Date(Date.now() - seconds * 1000).toISOString();
  }

  const absolute = window.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i
  );

  if (absolute) {
    const date = new Date(absolute[0]);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const isoDate = window.match(
    /\b20\d{2}-\d{2}-\d{2}(?:[T ][0-9:.+-]+)?\b/
  );

  if (isoDate) {
    const date = new Date(isoDate[0]);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

function markdownImages(text) {
  const images = [];

  for (const match of text.matchAll(
    /!\[[^\]]*\]\(<?([^)\s>]+)>?\)/gi
  )) {
    const url = absoluteUrl(match[1]);

    if (/^https?:\/\//i.test(url)) {
      images.push({
        url,
        position: match.index
      });
    }
  }

  for (const match of text.matchAll(
    /<img\b[^>]*(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/gi
  )) {
    const url = absoluteUrl(match[1]);

    if (/^https?:\/\//i.test(url)) {
      images.push({
        url,
        position: match.index
      });
    }
  }

  return images;
}

function parseListing(markdown) {
  const items = new Map();

  /*
   * Format 1:
   * ## [Title](https://news.sankakucomplex.com/n/...)
   */
  for (const match of markdown.matchAll(
    /(?:^|\n)\s*#{1,6}\s*\[([^\]]{1,300})\]\((https?:\/\/news\.sankakucomplex\.com\/n\/[^)\s]+)\)/gi
  )) {
    const title = cleanTitle(match[1]);
    const link = match[2].replace(/[?#].*$/, "");

    if (!title || !isRealUrl(link)) {
      continue;
    }

    items.set(link, {
      title,
      link,
      position: match.index
    });
  }

  /*
   * Format 2:
   * ## [Title][12]
   *
   * [12]: https://news.sankakucomplex.com/n/...
   */
  const refs = new Map();

  for (const match of markdown.matchAll(
    /^\s*\[([^\]]+)\]:\s*(https?:\/\/news\.sankakucomplex\.com\/n\/[^\s>]+)\s*$/gim
  )) {
    refs.set(
      match[1],
      match[2].replace(/[?#].*$/, "")
    );
  }

  for (const match of markdown.matchAll(
    /(?:^|\n)\s*#{1,6}\s*\[([^\]]{1,300})\]\[([^\]]+)\]/gi
  )) {
    const title = cleanTitle(match[1]);
    const link = refs.get(match[2]);

    if (!title || !link || !isRealUrl(link)) {
      continue;
    }

    items.set(link, {
      title,
      link,
      position: match.index
    });
  }

  /*
   * Format 3:
   * HTML anchor.
   */
  for (const match of markdown.matchAll(
    /<a\b[^>]*href=["'](https?:\/\/news\.sankakucomplex\.com\/n\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const link = match[1].replace(/[?#].*$/, "");
    const title = cleanTitle(match[2]);

    if (!title || !isRealUrl(link)) {
      continue;
    }

    items.set(link, {
      title,
      link,
      position: match.index
    });
  }

  /*
   * Format 4:
   * Plain URL followed somewhere nearby by a heading/title.
   *
   * This is intentionally conservative so random links from the page
   * are not turned into stories.
   */
  for (const match of markdown.matchAll(
    /https?:\/\/news\.sankakucomplex\.com\/n\/[A-Za-z0-9_-]+/gi
  )) {
    const link = match[0].replace(/[?#].*$/, "");

    if (!isRealUrl(link) || items.has(link)) {
      continue;
    }

    const nearby = markdown.slice(
      Math.max(0, match.index - 500),
      Math.min(markdown.length, match.index + 500)
    );

    const headings = [
      ...nearby.matchAll(/^\s*#{1,6}\s+(.+?)\s*$/gm)
    ];

    const possibleTitles = headings
      .map(item => cleanTitle(item[1]))
      .filter(Boolean)
      .filter(title => title.length >= 20);

    if (!possibleTitles.length) {
      continue;
    }

    items.set(link, {
      title: possibleTitles[0],
      link,
      position: match.index
    });
  }

  return [...items.values()]
    .map(item => ({
      ...item,
      publishedAt: parseRelativeDate(
        markdown,
        item.position
      ),
      image: "",
      excerpt: ""
    }))
    .filter(item => item.publishedAt)
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt) -
        Date.parse(a.publishedAt)
    );
}

function articleText(markdown) {
  const text = String(markdown || "");

  const heading =
    text.match(/^\s*#\s+(.+?)\s*$/m)?.[1] ||
    text.match(/^\s*Title:\s*(.+?)\s*$/im)?.[1] ||
    "";

  const title = cleanTitle(heading);

  const published =
    text.match(
      /^\s*Published Time:\s*(.+?)\s*$/im
    )?.[1] ||
    text.match(
      /^\s*Published:\s*(.+?)\s*$/im
    )?.[1] ||
    "";

  let publishedAt = null;

  if (published) {
    const date = new Date(
      stripHtml(published)
    );

    if (!Number.isNaN(date.getTime())) {
      publishedAt = date.toISOString();
    }
  }

  const images = markdownImages(text);

  const uploadImage = images.find(item =>
    /\/wp-content\/uploads\//i.test(item.url)
  );

  const image =
    uploadImage?.url ||
    images[0]?.url ||
    "";

  const afterContent =
    text.split(
      /^Markdown Content:\s*$/im
    )[1] || text;

  let excerpt = "";

  for (const line of afterContent.split(/\r?\n/)) {
    const cleaned = stripHtml(line).trim();

    if (
      !cleaned ||
      cleaned === title ||
      cleaned.startsWith("#") ||
      /^\[.*\]\(.*\)$/s.test(cleaned) ||
      /^https?:\/\//i.test(cleaned) ||
      /^(?:add\s+comment|\d+\s+comments?)$/i.test(cleaned) ||
      cleaned.length < 70
    ) {
      continue;
    }

    excerpt = makeExcerpt(cleaned);
    break;
  }

  return {
    title,
    publishedAt,
    excerpt,
    image
  };
}

async function enrichOne(item) {
  /*
   * Sankaku article URLs are currently unreliable for direct automated
   * requests, so use Jina's reader for metadata.
   */
  const articleId =
    item.link.split("/n/")[1] || "";

  if (!articleId) {
    return item;
  }

  const readerUrl =
    `https://r.jina.ai/http://news.sankakucomplex.com/n/${encodeURIComponent(
      articleId
    )}`;

  try {
    const result = await fetchText(
      readerUrl,
      {
        timeout: 40000,
        headers: {
          "x-no-cache": "true",
          "x-cache-tolerance": "0"
        }
      }
    );

    if (
      result.status >= 200 &&
      result.status < 300 &&
      result.body.length > 200
    ) {
      const meta = articleText(
        result.body
      );

      return {
        ...item,
        title:
          meta.title || item.title,
        publishedAt:
          meta.publishedAt ||
          item.publishedAt,
        excerpt:
          meta.excerpt ||
          item.excerpt,
        image:
          meta.image ||
          item.image
      };
    }
  } catch {
    // Keep listing metadata if article enrichment fails.
  }

  return item;
}

async function enrichItems(
  items,
  limit = 45
) {
  const queue = items.slice(0, limit);
  const results = [];

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();

      if (!item) {
        return;
      }

      results.push(
        await enrichOne(item)
      );

      await sleep(120);
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          5,
          queue.length || 1
        )
      },
      worker
    )
  );

  return results;
}

const debug = {
  generatedAt: new Date().toISOString(),
  listing: null,
  candidateCount: 0,
  enrichedCount: 0,
  selectedCount: 0,
  mode: "unchanged"
};

const payload =
  JSON.parse(
    await fs.readFile(
      OUT,
      "utf8"
    )
  );

const existing =
  Array.isArray(payload.articles)
    ? payload.articles
    : [];

const existingSankaku =
  existing.filter(
    item =>
      item?.source?.id === "sankaku" &&
      isRealUrl(item.link)
  );

const otherArticles =
  existing.filter(
    item =>
      item?.source?.id !== "sankaku"
  );

const listingUrl =
  `https://r.jina.ai/http://news.sankakucomplex.com/recent-posts/?t=${Date.now()}`;

let fresh = [];

try {
  const result =
    await fetchText(
      listingUrl,
      {
        timeout: 40000,
        headers: {
          "x-no-cache": "true",
          "x-cache-tolerance": "0"
        }
      }
    );

  debug.listing = {
    url: listingUrl,
    status: result.status,
    finalUrl: result.finalUrl,
    contentType: result.contentType,
    bytes: result.body.length
  };

  if (
    result.status >= 200 &&
    result.status < 300 &&
    result.body.length > 500
  ) {
    const candidates =
      parseListing(result.body);

    debug.candidateCount =
      candidates.length;

    fresh =
      await enrichItems(
        candidates,
        45
      );

    debug.enrichedCount =
      fresh.length;
  }
} catch (error) {
  debug.listing = {
    url: listingUrl,
    error:
      String(
        error?.message || error
      )
  };
}

if (fresh.length) {
  const byLink = new Map();

  /*
   * Keep existing stories and merge new ones.
   */
  for (
    const item of [
      ...existingSankaku,
      ...fresh
    ]
  ) {
    if (!isRealUrl(item?.link)) {
      continue;
    }

    const key =
      item.link
        .replace(/\/+$/, "")
        .toLowerCase();

    const current =
      byLink.get(key);

    if (!current) {
      byLink.set(
        key,
        {
          ...item,
          source: {
            ...SOURCE
          }
        }
      );

      continue;
    }

    byLink.set(
      key,
      {
        ...current,
        ...item,

        /*
         * Never allow our placeholder title to overwrite
         * a real existing title.
         */
        title:
          item.title &&
          item.title !==
            "Sankaku Complex article"
            ? item.title
            : current.title,

        excerpt:
          item.excerpt ||
          current.excerpt ||
          "",

        image:
          item.image ||
          current.image ||
          "",

        publishedAt:
          item.publishedAt ||
          current.publishedAt ||
          null,

        source: {
          ...SOURCE
        }
      }
    );
  }

  const sankakuArticles =
    [...byLink.values()]
      .filter(
        item =>
          isRealUrl(item.link) &&
          item.title &&
          item.title !==
            "Sankaku Complex article"
      )
      .sort(
        (a, b) => {
          const left =
            a.publishedAt
              ? Date.parse(
                  a.publishedAt
                )
              : 0;

          const right =
            b.publishedAt
              ? Date.parse(
                  b.publishedAt
                )
              : 0;

          return right - left;
        }
      )
      .slice(0, 60);

  payload.articles =
    [
      ...otherArticles,
      ...sankakuArticles
    ]
      .sort(
        (a, b) => {
          const left =
            a.publishedAt
              ? Date.parse(
                  a.publishedAt
                )
              : 0;

          const right =
            b.publishedAt
              ? Date.parse(
                  b.publishedAt
                )
              : 0;

          if (right !== left) {
            return right - left;
          }

          return String(
            a.title
          ).localeCompare(
            String(b.title)
          );
        }
      )
      .slice(0, 500);

  const sourceResult =
    (
      payload.sourceResults ||
      []
    ).find(
      item =>
        item.id === "sankaku"
    );

  if (sourceResult) {
    sourceResult.status =
      "ok";

    sourceResult.mode =
      "recent-posts-jina";

    sourceResult.count =
      sankakuArticles.length;

    sourceResult.feedUrl =
      "https://news.sankakucomplex.com/recent-posts/";
  }

  debug.selectedCount =
    sankakuArticles.length;

  debug.mode =
    "recent-posts-jina";
} else {
  /*
   * If the current listing is temporarily unavailable,
   * keep the already-known Sankaku articles instead of
   * replacing them with fake "Sankaku Complex article" rows.
   */
  payload.articles =
    [
      ...otherArticles,
      ...existingSankaku
    ]
      .sort(
        (a, b) => {
          const left =
            a.publishedAt
              ? Date.parse(
                  a.publishedAt
                )
              : 0;

          const right =
            b.publishedAt
              ? Date.parse(
                  b.publishedAt
                )
              : 0;

          return right - left;
        }
      )
      .slice(0, 500);

  debug.selectedCount =
    existingSankaku.length;

  debug.mode =
    "existing-sankaku-preserved";
}

payload.generatedAt =
  new Date().toISOString();

payload.stats =
  payload.stats || {};

payload.stats.articleCount =
  payload.articles.length;

payload.stats.sourceCount =
  payload.sources?.length ||
  payload.stats.sourceCount ||
  0;

payload.stats.successfulSources =
  (
    payload.sourceResults ||
    []
  ).filter(
    item =>
      item.status === "ok"
  ).length;

payload.stats.failedSources =
  (
    payload.sourceResults ||
    []
  ).filter(
    item =>
      item.status === "error"
  ).length;

await fs.writeFile(
  OUT,
  JSON.stringify(
    payload,
    null,
    2
  )
);

await fs.writeFile(
  DEBUG_OUT,
  JSON.stringify(
    debug,
    null,
    2
  )
);

console.log(
  `Sankaku refresh: ${debug.mode}; ${debug.selectedCount} stories.`
);
