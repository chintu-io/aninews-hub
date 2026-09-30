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
const USER_AGENT = "AniNewsHub/1.0 (personal RSS reader)";

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

async function fetchUrl(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/json, */*"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000)
  });

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  return {
    url,
    finalUrl: response.url,
    status: response.status,
    contentType,
    bytes: body.length,
    body
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
      const parsed = JSON.parse(text);
      objects.push(parsed);
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

    if (value["@graph"] && Array.isArray(value["@graph"])) {
      queue.push(...value["@graph"]);
    }
  }

  return null;
}

function parseArticleMetadata(html, fallbackUrl) {
  const json = findArticleJsonLd(jsonLdObjects(html));

  const title =
    json?.headline ||
    metaValue(html, "og:title") ||
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
      json.image.find(item => item && typeof item.url === "string")?.url ||
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
    url: fallbackUrl,
    title: stripHtml(title),
    description: stripHtml(description),
    image: /^https?:\/\//i.test(image) ? image : "",
    publishedAt:
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toISOString()
        : null
  };
}

async function enrichArticle(article, options = {}) {
  try {
    const response = await fetchUrl(article.link);

    if (response.status < 200 || response.status >= 300) {
      return {
        article,
        status: `HTTP ${response.status}`
      };
    }

    const metadata = parseArticleMetadata(response.body, article.link);

    return {
      article: {
        ...article,
        title: metadata.title || article.title,
        excerpt: metadata.description
          ? excerpt(metadata.description)
          : article.excerpt,
        publishedAt: metadata.publishedAt || article.publishedAt,
        image: options.imageOnly
          ? metadata.image || article.image
          : metadata.image || article.image
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
  const results = [];
  const queue = [...items];

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;

      const result = await enrichArticle(item, options);
      results.push(result);

      await sleep(options.delayMs ?? 150);
    }
  };

  const workerCount = Math.min(options.concurrency ?? 3, items.length || 1);

  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );

  return results;
}

function recentCutoff(days = 90) {
  return new Date(Date.now() - days * 86400000);
}

function isRecent(dateString, cutoff) {
  if (!dateString) return false;
  const date = new Date(dateString);
  return !Number.isNaN(date.getTime()) && date >= cutoff;
}

function sankakuArticleLinksFromRecentPage(html) {
  const results = [];
  const regex =
    /href\s*=\s*["'](https?:\/\/news\.sankakucomplex\.com\/n\/[^"'#?]+(?:\/)?|\/n\/[^"'#?]+(?:\/)?)/gi;

  let match;

  while ((match = regex.exec(html))) {
    const href = match[1];

    const url = href.startsWith("http")
      ? href
      : `https://news.sankakucomplex.com${href}`;

    if (!results.includes(url)) {
      results.push(url);
    }
  }

  return results;
}

async function sankakuRecentPostsFallback() {
  const source = SOURCES.find(item => item.id === "sankaku");
  const pageUrl = "https://news.sankakucomplex.com/recent-posts/";
  const cutoff = recentCutoff(90);

  const page = await fetchUrl(pageUrl);

  if (page.status < 200 || page.status >= 300) {
    throw new Error(`Recent Posts HTTP ${page.status}`);
  }

  const urls = sankakuArticleLinksFromRecentPage(page.body).slice(0, 24);

  const pseudo = urls.map(link => ({
    id: hash(`sankaku|${link}`),
    title: "Loading",
    link,
    publishedAt: null,
    excerpt: "",
    image: "",
    source: {
      id: source.id,
      name: source.name,
      short: source.short,
      siteUrl: source.siteUrl,
      category: source.category,
      accent: source.accent
    }
  }));

  const enriched = await enrichList(pseudo, {
    concurrency: 3,
    delayMs: 180
  });

  const accepted = [];
  const rejected = [];

  for (const result of enriched) {
    const item = result.article;

    if (
      !item.publishedAt ||
      !isRecent(item.publishedAt, cutoff) ||
      !item.link.includes("/n/")
    ) {
      rejected.push({
        link: item.link,
        title: item.title,
        publishedAt: item.publishedAt,
        reason: item.publishedAt ? "stale" : "missing-date"
      });
      continue;
    }

    if (!item.title || item.title === "Loading") {
      rejected.push({
        link: item.link,
        reason: "missing-title"
      });
      continue;
    }

    accepted.push(item);
  }

  const unique = new Map();

  for (const item of accepted) {
    if (!unique.has(item.link)) {
      unique.set(item.link, item);
    }
  }

  return {
    mode: "recent-posts-pages",
    pageUrl,
    cutoff: cutoff.toISOString(),
    candidateCount: urls.length,
    items: [...unique.values()].sort(
      (a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)
    ),
    rejected: rejected.slice(0, 30)
  };
}

async function sankakuGoogleFallback() {
  const source = SOURCES.find(item => item.id === "sankaku");
  const cutoff = recentCutoff(30);

  const query =
    `site:news.sankakucomplex.com/n/ after:${cutoff
      .toISOString()
      .slice(0, 10)}`;

  const feedUrl =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

  const fetched = await fetchUrl(feedUrl);

  if (fetched.status < 200 || fetched.status >= 300) {
    throw new Error(`Google News HTTP ${fetched.status}`);
  }

  const feed = await parser.parseString(fetched.body);
  const candidates = [];

  for (const item of feed.items || []) {
    if (!item.link) continue;

    candidates.push({
      id: hash(`sankaku-google|${item.guid || item.link}`),
      title: stripHtml(item.title || "Untitled"),
      link: item.link,
      publishedAt: item.isoDate || item.pubDate || null,
      excerpt: excerpt(item.contentSnippet || item.description || ""),
      image: "",
      source: {
        id: source.id,
        name: source.name,
        short: source.short,
        siteUrl: source.siteUrl,
        category: source.category,
        accent: source.accent
      }
    });
  }

  const enriched = await enrichList(candidates.slice(0, 20), {
    concurrency: 3,
    delayMs: 180
  });

  const accepted = [];
  const rejected = [];

  for (const result of enriched) {
    const item = result.article;
    const sourceUrl = item.link || "";

    if (!/news\.sankakucomplex\.com\/n\//i.test(sourceUrl)) {
      rejected.push({
        reason: "not-sankaku-article",
        title: item.title,
        link: sourceUrl
      });
      continue;
    }

    if (
      !item.publishedAt ||
      !isRecent(item.publishedAt, cutoff)
    ) {
      rejected.push({
        reason: "stale-or-missing-date",
        title: item.title,
        publishedAt: item.publishedAt,
        link: sourceUrl
      });
      continue;
    }

    accepted.push(item);
  }

  const unique = new Map();

  for (const item of accepted) {
    if (!unique.has(item.link)) {
      unique.set(item.link, item);
    }
  }

  return {
    mode: "google-news-article-pages",
    feedUrl,
    query,
    cutoff: cutoff.toISOString(),
    items: [...unique.values()].sort(
      (a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)
    ),
    rejected: rejected.slice(0, 30)
  };
}

async function fetchSankaku() {
  const diagnostics = {
    checkedAt: new Date().toISOString(),
    official: [],
    recentPosts: null,
    googleFallback: null,
    selectedMode: null,
    selectedCount: 0
  };

  const source = SOURCES.find(item => item.id === "sankaku");
  const cutoff = recentCutoff(90);

  for (const feedUrl of source.feedUrls) {
    try {
      const result = await fetchUrl(feedUrl);

      diagnostics.official.push({
        url: feedUrl,
        finalUrl: result.finalUrl,
        status: result.status,
        contentType: result.contentType,
        bytes: result.bytes
      });

      if (result.status < 200 || result.status >= 300) {
        continue;
      }

      const feed = await parseFeedResponse(result);

      const items = (feed.items || [])
        .map(item => normalize(item, source))
        .filter(Boolean)
        .filter(item => isRecent(item.publishedAt, cutoff))
        .filter(item => /\/n\//.test(item.link));

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

  try {
    const fallback = await sankakuRecentPostsFallback();

    diagnostics.recentPosts = {
      mode: fallback.mode,
      pageUrl: fallback.pageUrl,
      candidateCount: fallback.candidateCount,
      accepted: fallback.items.length,
      sample: fallback.items.slice(0, 8).map(item => ({
        title: item.title,
        publishedAt: item.publishedAt,
        link: item.link,
        image: item.image
      })),
      rejected: fallback.rejected
    };

    if (fallback.items.length) {
      diagnostics.selectedMode = fallback.mode;
      diagnostics.selectedCount = fallback.items.length;

      return {
        items: fallback.items,
        diagnostics
      };
    }
  } catch (error) {
    diagnostics.recentPosts = {
      error: String(error?.message || error)
    };
  }

  try {
    const fallback = await sankakuGoogleFallback();

    diagnostics.googleFallback = {
      mode: fallback.mode,
      feedUrl: fallback.feedUrl,
      query: fallback.query,
      cutoff: fallback.cutoff,
      accepted: fallback.items.length,
      sample: fallback.items.slice(0, 8).map(item => ({
        title: item.title,
        publishedAt: item.publishedAt,
        link: item.link
      })),
      rejected: fallback.rejected
    };

    diagnostics.selectedMode = fallback.mode;
    diagnostics.selectedCount = fallback.items.length;

    return {
      items: fallback.items,
      diagnostics
    };
  } catch (error) {
    diagnostics.googleFallback = {
      error: String(error?.message || error)
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
    failures.map(item => `${item.feedUrl}: ${item.message}`).join(" | ")
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
    delayMs: 150,
    imageOnly: true
  });

  const byLink = new Map(results.map(result => [result.article.link, result]));
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
        console.log(`  - ${item.publishedAt || "no date"} ${item.title}`);
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

    console.log(`✓ ${source.name}: ${result.items.length} stories`);

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

    console.error(`✗ ${source.name}: ${error?.message || error}`);
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
    return right - left;
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
    successfulSources: sourceResults.filter(item => item.status === "ok").length,
    failedSources: sourceResults.filter(item => item.status === "error").length,
    articleCount: articles.length
  },
  articles
};

await fs.writeFile(OUT, JSON.stringify(payload, null, 2));

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
