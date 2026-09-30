import fs from "node:fs/promises";
import crypto from "node:crypto";
import Parser from "rss-parser";
import { SOURCES } from "./sources.mjs";

const parser = new Parser({
  timeout: 25000,
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["content:encoded", "contentEncoded", { keepArray: false }]
    ]
  }
});

const OUT = new URL("../site/data/articles.json", import.meta.url);
const DEBUG_OUT = new URL("../site/debug/sankaku.json", import.meta.url);

const USER_AGENT =
  "AniNewsHub/1.3 (personal RSS reader; github.com/chintune/aninews-hub)";

const hash = value =>
  crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 16);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value = "") {
  const text = stripHtml(value);
  return text.length <= 260 ? text : `${text.slice(0, 257).trimEnd()}…`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function urlOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;

  if (typeof value === "object") {
    if (typeof value.url === "string") return value.url;
    if (typeof value.href === "string") return value.href;

    for (const key of ["$", "attrs", "attribute", "content"]) {
      const nested = urlOf(value[key]);
      if (nested) return nested;
    }
  }

  return "";
}

function imageOf(item) {
  const candidates = [
    item.enclosure?.url,
    item.enclosure?.href,
    ...asArray(item.mediaContent).map(urlOf),
    ...asArray(item.mediaThumbnail).map(urlOf)
  ];

  return candidates.find(value => /^https?:\/\//i.test(value || "")) || "";
}

function normalize(item, source) {
  const title = stripHtml(item.title || "Untitled");
  const link = item.link || item.guid || "";

  if (!/^https?:\/\//i.test(link)) return null;

  const publishedRaw =
    item.isoDate ||
    item.pubDate ||
    item.published ||
    item.updated ||
    null;

  const parsed = publishedRaw ? new Date(publishedRaw) : null;

  const publishedAt =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : null;

  const summary =
    item.contentSnippet ||
    item.contentEncoded ||
    item.content ||
    item.summary ||
    item.description ||
    "";

  return {
    id: hash(`${source.id}|${item.guid || link}`),
    title,
    link,
    publishedAt,
    excerpt: excerpt(summary),
    image: imageOf(item),
    source: {
      id: source.id,
      name: source.name,
      short: source.short,
      siteUrl: source.siteUrl,
      category: source.category,
      accent: source.accent
    }
  };
}

async function fetchUrl(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/json, */*",
      ...(options.headers || {})
    },
    body: options.body,
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeout ?? 30000)
  });

  return {
    url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body: await response.text()
  };
}

async function parseFeedResponse(result) {
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`HTTP ${result?.status ?? "unknown"}`);
  }

  if (!result.body.trim()) {
    throw new Error("Empty response");
  }

  return parser.parseString(result.body);
}

function cleanMetaContent(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function attrFromTag(tag, name) {
  const regex = new RegExp(
    `${name}\\s*=\\s*["']([^"']+)["']`,
    "i"
  );

  return regex.exec(tag)?.[1] || "";
}

function metaValue(html, property) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const key =
      attrFromTag(tag, "property") ||
      attrFromTag(tag, "name");

    if (key.toLowerCase() === property.toLowerCase()) {
      return cleanMetaContent(attrFromTag(tag, "content"));
    }
  }

  return "";
}

function titleTagValue(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? cleanMetaContent(stripHtml(match[1])) : "";
}

function jsonLdObjects(html) {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  const objects = [];

  for (const block of blocks) {
    const text = block
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    try {
      objects.push(JSON.parse(text));
    } catch {
      // Ignore malformed structured data.
    }
  }

  return objects;
}

function findArticleJsonLd(objects) {
  const queue = [...objects];

  while (queue.length) {
    const value = queue.shift();

    if (!value) continue;

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    if (typeof value !== "object") continue;

    const type = value["@type"];
    const types = Array.isArray(type) ? type : [type];

    if (
      types.some(
        item =>
          typeof item === "string" &&
          /article|newsarticle|reportage/i.test(item)
      )
    ) {
      return value;
    }

    if (Array.isArray(value["@graph"])) {
      queue.push(...value["@graph"]);
    }
  }

  return null;
}

function parseArticleMetadata(html) {
  const json = findArticleJsonLd(jsonLdObjects(html));

  const title =
    json?.headline ||
    metaValue(html, "og:title") ||
    titleTagValue(html) ||
    "";

  const description =
    json?.description ||
    metaValue(html, "og:description") ||
    "";

  let image = "";

  if (typeof json?.image === "string") {
    image = json.image;
  } else if (Array.isArray(json?.image)) {
    image =
      json.image.find(item => typeof item === "string") ||
      json.image.find(
        item => item && typeof item.url === "string"
      )?.url ||
      "";
  } else if (json?.image && typeof json.image.url === "string") {
    image = json.image.url;
  }

  image = image || metaValue(html, "og:image") || "";

  const published =
    json?.datePublished ||
    metaValue(html, "article:published_time") ||
    metaValue(html, "date") ||
    "";

  const parsed = published ? new Date(published) : null;

  return {
    title: stripHtml(title),
    description: stripHtml(description),
    image: /^https?:\/\//i.test(image) ? image : "",
    publishedAt:
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toISOString()
        : null
  };
}

async function enrichArticle(article) {
  try {
    const response = await fetchUrl(article.link);

    if (response.status < 200 || response.status >= 300) {
      return { article, status: `HTTP ${response.status}` };
    }

    const metadata = parseArticleMetadata(response.body);

    return {
      article: {
        ...article,
        title: metadata.title || article.title,
        excerpt: metadata.description
          ? excerpt(metadata.description)
          : article.excerpt,
        publishedAt: metadata.publishedAt || article.publishedAt,
        image: metadata.image || article.image
      },
      status: "ok"
    };
  } catch (error) {
    return {
      article,
      status: String(error?.message || error)
    };
  }
}

async function enrichList(items, options = {}) {
  const queue = [...items];
  const results = [];

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;

      results.push(await enrichArticle(item));
      await sleep(options.delayMs ?? 150);
    }
  };

  const workerCount = Math.min(
    options.concurrency ?? 3,
    items.length || 1
  );

  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );

  return results;
}

function recentCutoff(days = 60) {
  return new Date(Date.now() - days * 86400000);
}

function isRecent(dateString, cutoff) {
  if (!dateString) return false;

  const date = new Date(dateString);

  return (
    !Number.isNaN(date.getTime()) &&
    date >= cutoff &&
    date <= new Date(Date.now() + 86400000)
  );
}

function sankakuSource() {
  return SOURCES.find(item => item.id === "sankaku");
}

function sankakuAcceptsUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.hostname.toLowerCase() ===
        "news.sankakucomplex.com" &&
      /^\/n\/[^/?#]+\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/*
 * Sankaku blocks GitHub-hosted runners with HTTP 401.
 *
 * Fallback order:
 *  1. Official RSS.
 *  2. Bing News RSS search, which supports the site: operator and returns
 *     normal RSS items. We unwrap Bing's apiclick links when present.
 *  3. Jina Reader, which fetches Sankaku's public recent-posts page server-side
 *     and returns Markdown. We extract only direct /n/ article links.
 *
 * Google News is deliberately no longer used here. The GitHub runner was
 * receiving HTTP 503 from Google News RSS, so decoding its article links
 * could never be reached reliably.
 */

function unwrapBingNewsLink(value) {
  if (!value) return "";

  try {
    const url = new URL(value);

    if (
      url.hostname === "www.bing.com" &&
      url.pathname === "/news/apiclick.aspx"
    ) {
      return url.searchParams.get("url") || "";
    }

    return value;
  } catch {
    return value;
  }
}

async function fetchSankakuViaBing(diagnostics) {
  const source = sankakuSource();
  const cutoff = recentCutoff(60);

  const q = encodeURIComponent(
    "site:news.sankakucomplex.com"
  );

  const feedUrl =
    `https://www.bing.com/news/search?q=${q}` +
    `&qft=${encodeURIComponent('sortbydate="1"')}` +
    "&format=RSS";

  try {
    const result = await fetchUrl(feedUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
        accept:
          "application/rss+xml, application/xml, text/xml, */*"
      }
    });

    diagnostics.status = result.status;
    diagnostics.finalUrl = result.finalUrl;
    diagnostics.contentType = result.contentType;
    diagnostics.bytes = result.body.length;
    diagnostics.feedUrl = feedUrl;

    if (result.status < 200 || result.status >= 300) {
      return {
        mode: "bing-news-rss",
        items: [],
        error: `HTTP ${result.status}`
      };
    }

    const feed = await parser.parseString(result.body);
    diagnostics.candidateCount = feed.items?.length || 0;

    const accepted = [];

    for (const item of (feed.items || []).slice(0, 40)) {
      const link = unwrapBingNewsLink(
        item.link || item.guid || ""
      );

      if (!sankakuAcceptsUrl(link)) {
        continue;
      }

      const publishedRaw =
        item.isoDate ||
        item.pubDate ||
        null;

      if (
        publishedRaw &&
        !isRecent(publishedRaw, cutoff)
      ) {
        continue;
      }

      const normalized = normalize(
        {
          title: item.title,
          link,
          guid: link,
          isoDate: publishedRaw,
          description:
            item.contentSnippet ||
            item.description ||
            "",
          enclosure: item.enclosure
        },
        source
      );

      if (normalized) {
        accepted.push(normalized);
      }
    }

    const unique = new Map();

    for (const item of accepted) {
      if (!unique.has(item.link)) {
        unique.set(item.link, item);
      }
    }

    const items = [...unique.values()]
      .sort(
        (a, b) =>
          Date.parse(b.publishedAt || 0) -
          Date.parse(a.publishedAt || 0)
      )
      .slice(0, 30);

    diagnostics.accepted = items.length;

    return {
      mode: "bing-news-rss",
      items
    };
  } catch (error) {
    diagnostics.error = String(error?.message || error);

    return {
      mode: "bing-news-rss",
      items: []
    };
  }
}

function extractSankakuMarkdownItems(markdown, source) {
  const results = [];
  const seen = new Set();

  const absolutePattern =
    /\[([^\]]{3,220})\]\((https?:\/\/news\.sankakucomplex\.com\/n\/[^)\s]+)\)/gi;

  let match;

  while ((match = absolutePattern.exec(markdown))) {
    const title = stripHtml(match[1]).trim();
    const link = match[2].replace(/[?#].*$/, "");

    if (
      !sankakuAcceptsUrl(link) ||
      !title ||
      seen.has(link)
    ) {
      continue;
    }

    seen.add(link);

    results.push({
      id: hash(`sankaku|${link}`),
      title,
      link,
      publishedAt: null,
      excerpt: "",
      image: "",
      source
    });

    if (results.length >= 30) {
      return results;
    }
  }

  const rawPattern =
    /https?:\/\/news\.sankakucomplex\.com\/n\/[A-Za-z0-9_-]+\/?/gi;

  while ((match = rawPattern.exec(markdown))) {
    const link = match[0].replace(/[?#].*$/, "");

    if (!sankakuAcceptsUrl(link) || seen.has(link)) {
      continue;
    }

    seen.add(link);

    results.push({
      id: hash(`sankaku|${link}`),
      title: "Sankaku Complex article",
      link,
      publishedAt: null,
      excerpt: "",
      image: "",
      source
    });

    if (results.length >= 30) {
      break;
    }
  }

  return results;
}

async function fetchSankakuViaJina(diagnostics) {
  const source = sankakuSource();

  const candidateUrls = [
    "https://r.jina.ai/http://news.sankakucomplex.com/recent-posts/",
    "https://r.jina.ai/http://news.sankakucomplex.com/"
  ];

  for (const readerUrl of candidateUrls) {
    try {
      const result = await fetchUrl(readerUrl, {
        headers: {
          accept: "text/plain, text/markdown, text/html, */*"
        },
        timeout: 40000
      });

      diagnostics.attempts.push({
        url: readerUrl,
        status: result.status,
        finalUrl: result.finalUrl,
        contentType: result.contentType,
        bytes: result.body.length
      });

      if (result.status < 200 || result.status >= 300) {
        continue;
      }

      const items = extractSankakuMarkdownItems(
        result.body,
        source
      );

      if (items.length) {
        diagnostics.accepted = items.length;
        diagnostics.sourceUrl = readerUrl;

        return {
          mode: "jina-reader-recent-posts",
          items,
          preview: items.slice(0, 8).map(item => ({
            title: item.title,
            link: item.link
          }))
        };
      }
    } catch (error) {
      diagnostics.attempts.push({
        url: readerUrl,
        error: String(error?.message || error)
      });
    }
  }

  return {
    mode: "jina-reader-recent-posts",
    items: []
  };
}

async function fetchSankaku() {
  const diagnostics = {
    checkedAt: new Date().toISOString(),
    official: [],
    bing: {
      mode: "not-run",
      accepted: 0
    },
    jina: {
      mode: "not-run",
      accepted: 0,
      attempts: []
    },
    selectedMode: null,
    selectedCount: 0
  };

  const source = sankakuSource();
  const cutoff = recentCutoff(60);

  for (const feedUrl of source.feedUrls) {
    try {
      const result = await fetchUrl(feedUrl);

      diagnostics.official.push({
        url: feedUrl,
        finalUrl: result.finalUrl,
        status: result.status,
        contentType: result.contentType,
        bytes: result.body.length
      });

      if (result.status < 200 || result.status >= 300) {
        continue;
      }

      const feed = await parseFeedResponse(result);

      const items = (feed.items || [])
        .map(item => normalize(item, source))
        .filter(Boolean)
        .filter(item => isRecent(item.publishedAt, cutoff))
        .filter(item => sankakuAcceptsUrl(item.link));

      if (items.length) {
        diagnostics.selectedMode = "official-rss";
        diagnostics.selectedCount = items.length;

        return {
          items,
          diagnostics
        };
      }
    } catch (error) {
      diagnostics.official.push({
        error: String(error?.message || error)
      });
    }
  }

  const bing = await fetchSankakuViaBing(
    diagnostics.bing
  );

  diagnostics.bing.mode = bing.mode;

  if (bing.items.length) {
    diagnostics.selectedMode = bing.mode;
    diagnostics.selectedCount = bing.items.length;

    return {
      items: bing.items,
      diagnostics
    };
  }

  const jina = await fetchSankakuViaJina(
    diagnostics.jina
  );

  diagnostics.jina.mode = jina.mode;

  if (jina.items.length) {
    diagnostics.selectedMode = jina.mode;
    diagnostics.selectedCount = jina.items.length;

    return {
      items: jina.items,
      diagnostics
    };
  }

  diagnostics.selectedMode = "empty";
  diagnostics.selectedCount = 0;

  return {
    items: [],
    diagnostics
  };
}

async function fetchNormal(source) {
  const failures = [];

  for (const feedUrl of source.feedUrls) {
    try {
      const response = await fetchUrl(feedUrl);
      const feed = await parseFeedResponse(response);

      const items = (feed.items || [])
        .map(item => normalize(item, source))
        .filter(Boolean);

      if (!items.length) {
        throw new Error("No usable items");
      }

      return {
        feedUrl,
        items
      };
    } catch (error) {
      failures.push({
        feedUrl,
        message: String(error?.message || error)
      });
    }
  }

  throw new Error(
    failures
      .map(item => `${item.feedUrl}: ${item.message}`)
      .join(" | ")
  );
}

async function enrichImagesForSource(items, source) {
  if (!source.enrichImages) {
    return {
      items,
      attempted: 0,
      resolved: 0,
      failures: []
    };
  }

  const missing = items.filter(item => !item.image);

  const results = await enrichList(missing.slice(0, 40), {
    concurrency: 3,
    delayMs: 150
  });

  const byLink = new Map(
    results.map(result => [result.article.link, result])
  );

  let resolved = 0;
  const failures = [];

  const merged = items.map(item => {
    const result = byLink.get(item.link);

    if (!result) return item;

    if (result.article.image) {
      resolved++;

      return {
        ...item,
        image: result.article.image
      };
    }

    failures.push({
      link: item.link,
      status: result.status
    });

    return item;
  });

  return {
    items: merged,
    attempted: results.length,
    resolved,
    failures: failures.slice(0, 10)
  };
}

const allArticles = [];
const sourceResults = [];
let sankakuDiagnostics = null;

for (const source of SOURCES) {
  try {
    if (source.id === "sankaku") {
      const result = await fetchSankaku();

      allArticles.push(...result.items);
      sankakuDiagnostics = result.diagnostics;

      sourceResults.push({
        id: source.id,
        name: source.name,
        status: result.items.length ? "ok" : "empty",
        mode: result.diagnostics.selectedMode,
        count: result.items.length
      });

      console.log(
        `✓ ${source.name}: ${result.items.length} stories via ${result.diagnostics.selectedMode}`
      );

      for (const item of result.items.slice(0, 5)) {
        console.log(
          `  - ${item.publishedAt || "date from source page"} ${item.title}`
        );
      }

      continue;
    }

    let result = await fetchNormal(source);

    const enrichment = await enrichImagesForSource(
      result.items,
      source
    );

    result.items = enrichment.items;
    allArticles.push(...result.items);

    sourceResults.push({
      id: source.id,
      name: source.name,
      status: "ok",
      mode: "rss",
      feedUrl: result.feedUrl,
      count: result.items.length,
      imageEnrichment: source.enrichImages
        ? {
            attempted: enrichment.attempted,
            resolved: enrichment.resolved
          }
        : null
    });

    console.log(
      `✓ ${source.name}: ${result.items.length} stories`
    );

    if (source.enrichImages) {
      console.log(
        `  image enrichment: ${enrichment.resolved}/${enrichment.attempted}`
      );
    }
  } catch (error) {
    sourceResults.push({
      id: source.id,
      name: source.name,
      status: "error",
      mode: null,
      count: 0,
      error: String(error?.message || error)
    });

    console.error(
      `✗ ${source.name}: ${error?.message || error}`
    );
  }
}

const unique = new Map();

for (const article of allArticles) {
  const key = article.link.replace(/\/+$/, "").toLowerCase();

  if (!unique.has(key)) {
    unique.set(key, article);
  }
}

const articles = [...unique.values()]
  .sort((a, b) => {
    const left = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const right = b.publishedAt ? Date.parse(b.publishedAt) : 0;

    if (right !== left) {
      return right - left;
    }

    return a.title.localeCompare(b.title);
  })
  .slice(0, 500);

const payload = {
  generatedAt: new Date().toISOString(),
  sources: SOURCES.map(source => ({
    id: source.id,
    name: source.name,
    short: source.short,
    siteUrl: source.siteUrl,
    category: source.category,
    accent: source.accent
  })),
  sourceResults,
  stats: {
    sourceCount: SOURCES.length,
    successfulSources: sourceResults.filter(
      item => item.status === "ok"
    ).length,
    failedSources: sourceResults.filter(
      item => item.status === "error"
    ).length,
    articleCount: articles.length
  },
  articles
};

await fs.writeFile(
  OUT,
  JSON.stringify(payload, null, 2)
);

await fs.writeFile(
  DEBUG_OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sankaku: sankakuDiagnostics
    },
    null,
    2
  )
);

console.log(`Wrote ${articles.length} unique stories.`);
