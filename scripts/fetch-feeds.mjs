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
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/json, */*"
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

function sankakuRecentCutoff(days = 60) {
  const now = new Date();
  return new Date(now.getTime() - days * 86400000);
}

function isRecent(dateString, cutoff) {
  if (!dateString) return false;
  const date = new Date(dateString);
  return !Number.isNaN(date.getTime()) && date >= cutoff;
}

function extractSankakuArticleUrl(value = "") {
  const matches = String(value).match(
    /https?:\/\/news\.sankakucomplex\.com\/n\/[^"'\\s<>)]+/gi
  );

  return matches?.[0] || "";
}

async function sankakuGoogleFallback() {
  const cutoff = sankakuRecentCutoff(60);
  const after = cutoff.toISOString().slice(0, 10);
  const beforeDate = new Date(Date.now() + 86400000);
  const before = beforeDate.toISOString().slice(0, 10);

  const query =
    `site:news.sankakucomplex.com/n/ after:${after} before:${before}`;

  const feedUrl =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

  const fetched = await fetchUrl(feedUrl);

  if (fetched.status < 200 || fetched.status >= 300) {
    throw new Error(`Google News HTTP ${fetched.status}`);
  }

  const feed = await parser.parseString(fetched.body);
  const accepted = [];
  const rejected = [];

  for (const item of feed.items || []) {
    const originalUrl =
      extractSankakuArticleUrl(item.contentEncoded) ||
      extractSankakuArticleUrl(item.content) ||
      extractSankakuArticleUrl(item.description) ||
      extractSankakuArticleUrl(item.title);

    const publishedRaw = item.isoDate || item.pubDate || "";
    const parsedDate = publishedRaw ? new Date(publishedRaw) : null;

    if (!originalUrl || !originalUrl.includes("/n/")) {
      rejected.push({
        reason: "not-an-article-url",
        title: stripHtml(item.title || ""),
        googleUrl: item.link || ""
      });
      continue;
    }

    if (
      !parsedDate ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate < cutoff
    ) {
      rejected.push({
        reason: "stale-or-missing-date",
        title: stripHtml(item.title || ""),
        published: publishedRaw,
        originalUrl
      });
      continue;
    }

    const normalized = normalize(
      {
        title: item.title,
        link: originalUrl,
        guid: originalUrl,
        isoDate: parsedDate.toISOString(),
        contentSnippet: item.contentSnippet || item.description || ""
      },
      SOURCES.find(source => source.id === "sankaku")
    );

    if (normalized) {
      accepted.push(normalized);
    }
  }

  const unique = new Map();
  for (const item of accepted) {
    if (!unique.has(item.link)) unique.set(item.link, item);
  }

  return {
    mode: "google-news-recent",
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
    fallback: null,
    selectedMode: null,
    selectedCount: 0
  };

  const source = SOURCES.find(item => item.id === "sankaku");
  const cutoff = sankakuRecentCutoff(60);

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
        diagnostics.official.push({
          acceptedRecentItems: items.length,
          sample: items.slice(0, 5).map(item => ({
            title: item.title,
            publishedAt: item.publishedAt,
            link: item.link
          }))
        });

        return { items, diagnostics };
      }
    } catch (error) {
      diagnostics.official.push({
        error: String(error?.message || error)
      });
    }
  }

  const fallback = await sankakuGoogleFallback();

  diagnostics.fallback = {
    mode: fallback.mode,
    feedUrl: fallback.feedUrl,
    query: fallback.query,
    cutoff: fallback.cutoff,
    accepted: fallback.items.length,
    rejectedSamples: fallback.rejected,
    sample: fallback.items.slice(0, 8).map(item => ({
      title: item.title,
      publishedAt: item.publishedAt,
      link: item.link
    }))
  };

  diagnostics.selectedMode = fallback.mode;
  diagnostics.selectedCount = fallback.items.length;

  return {
    items: fallback.items,
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
      continue;
    }

    const result = await fetchNormal(source);

    allArticles.push(...result.items);

    sourceResults.push({
      id: source.id,
      name: source.name,
      status: "ok",
      mode: "rss",
      feedUrl: result.feedUrl,
      count: result.items.length
    });

    console.log(`✓ ${source.name}: ${result.items.length} stories`);
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
  sources: SOURCES,
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
