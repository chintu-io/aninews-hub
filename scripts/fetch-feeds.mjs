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
const USER_AGENT = "AniNews Hub/1.0 (personal RSS reader)";

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 16);
}

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
  return text.length <= 240 ? text : `${text.slice(0, 237).trimEnd()}…`;
}

function asArray(value) {
  return value ? (Array.isArray(value) ? value : [value]) : [];
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

  const rawDate = item.isoDate || item.pubDate || item.published || item.updated || null;
  const parsed = rawDate ? new Date(rawDate) : null;
  const publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;

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

async function fetchFeed(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
    },
    signal: AbortSignal.timeout(30000),
    redirect: "follow"
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const xml = await response.text();
  if (!xml.trim()) throw new Error("Empty response");

  const feed = await parser.parseString(xml);
  const items = (feed.items || []).map(item => item).filter(Boolean);

  if (!items.length) throw new Error("Feed returned no items");
  return items;
}

async function fetchSource(source) {
  const failures = [];

  for (const feedUrl of source.feedUrls) {
    try {
      const items = (await fetchFeed(feedUrl))
        .map(item => normalize(item, source))
        .filter(Boolean);

      if (!items.length) throw new Error("No usable stories");
      return { feedUrl, items };
    } catch (error) {
      failures.push(`${feedUrl}: ${error?.message || error}`);
    }
  }

  throw new Error(failures.join(" | "));
}

const all = [];
const sourceResults = [];
const errors = [];

for (const source of SOURCES) {
  try {
    const result = await fetchSource(source);
    all.push(...result.items);
    sourceResults.push({
      id: source.id,
      name: source.name,
      status: "ok",
      feedUrl: result.feedUrl,
      count: result.items.length
    });
    console.log(`✓ ${source.name}: ${result.items.length} stories`);
    console.log(`  feed: ${result.feedUrl}`);
  } catch (error) {
    sourceResults.push({
      id: source.id,
      name: source.name,
      status: "error",
      feedUrl: null,
      count: 0
    });
    errors.push({
      source: source.name,
      message: String(error?.message || error)
    });
    console.error(`✗ ${source.name}: ${error?.message || error}`);
  }
}

const unique = new Map();

for (const article of all) {
  const key = article.link.replace(/\/+$/, "").toLowerCase();
  if (!unique.has(key)) unique.set(key, article);
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
    failedSources: errors.length,
    articleCount: articles.length
  },
  errors,
  articles
};

await fs.writeFile(OUT, JSON.stringify(payload, null, 2));
console.log(`Wrote ${articles.length} unique stories.`);
