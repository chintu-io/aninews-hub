import fs from "node:fs/promises";
import Parser from "rss-parser";
import { MAX_ARTICLES } from "./article-archive.mjs";

const DATA_URL = new URL("../site/data/articles.json", import.meta.url);
const RSS_DIR = new URL("../site/rss/", import.meta.url);
const parser = new Parser({ timeout: 10000 });

const fail = message => {
  console.error("✗ " + message);
  process.exitCode = 1;
};

const data = JSON.parse(await fs.readFile(DATA_URL, "utf8"));
const articles = data.articles;
const sources = data.sources;

if (!Array.isArray(articles)) {
  throw new Error("articles.json must contain an articles array");
}
if (!Array.isArray(sources) || !sources.length) {
  throw new Error("articles.json must contain configured sources");
}
if (articles.length > MAX_ARTICLES) {
  fail(`Article count exceeds the configured ${MAX_ARTICLES}-item cap`);
}

const sourceIds = new Set(sources.map(source => source.id));
const ids = new Set();
const links = new Set();
let previousTimestamp = Infinity;

const canonicalLink = value =>
  String(value || "").replace(/\/+$/, "").toLowerCase();

for (const [index, article] of articles.entries()) {
  if (!article || typeof article !== "object") {
    fail("Article " + index + " is not an object");
    continue;
  }
  if (!article.id || ids.has(article.id)) {
    fail("Missing or duplicate article ID at index " + index);
  }
  ids.add(article.id);

  const key = canonicalLink(article.link);
  if (!/^https?:\/\//i.test(article.link || "")) {
    fail("Invalid article URL at index " + index);
  }
  if (!key || links.has(key)) {
    fail("Missing or duplicate article link at index " + index);
  }
  links.add(key);

  if (!String(article.title || "").trim()) {
    fail("Empty article title at index " + index);
  }
  if (!sourceIds.has(article.source?.id)) {
    fail("Article has unknown source at index " + index);
  }

  const timestamp = article.publishedAt
    ? Date.parse(article.publishedAt)
    : 0;

  if (article.publishedAt && !Number.isFinite(timestamp)) {
    fail("Invalid publication date for " + article.link);
  }
  if (timestamp > previousTimestamp) {
    fail("Articles are not sorted newest-first near " + article.link);
  }
  previousTimestamp = timestamp;

  if (article.source?.id === "billboardjapan") {
    if (/^\s*\d+\s+(?=[【〖〈＜<])/u.test(article.title || "")) {
      fail("Billboard ranking number leaked into title: " + article.link);
    }
    if (/(?:ACCESS\s+RANKING|アクセスランキング|class\s*=|href\s*=|(?:^|\s)NEWS\s+ALL(?:\s|$)|\bJapan\s+Overseas\b)/i.test(article.excerpt || "")) {
      fail("Billboard navigation or HTML leaked into excerpt: " + article.link);
    }
  }
}

const allXml = await fs.readFile(new URL("all.xml", RSS_DIR), "utf8");
const allFeed = await parser.parseString(allXml);
if ((allFeed.items || []).length !== articles.length) {
  fail("Combined RSS item count does not match articles.json");
}

const allRssByLink = new Map(
  (allFeed.items || []).map(item => [canonicalLink(item.link || item.guid), item])
);

for (const article of articles) {
  const item = allRssByLink.get(canonicalLink(article.link));
  if (!item) {
    fail("Combined RSS is missing " + article.link);
    continue;
  }

  if (!article.publishedAt && item.pubDate) {
    fail("RSS invents a publication date for " + article.link);
  }

  if (article.publishedAt && !item.pubDate) {
    fail("RSS omitted a known publication date for " + article.link);
  }
}

for (const source of sources) {
  const filename = source.id + ".xml";
  let feed;
  try {
    const xml = await fs.readFile(new URL(filename, RSS_DIR), "utf8");
    feed = await parser.parseString(xml);
  } catch (error) {
    fail("Unable to parse " + filename + ": " + (error?.message || error));
    continue;
  }

  const expected = articles.filter(article => article.source?.id === source.id);
  const items = feed.items || [];
  if (items.length !== expected.length) {
    fail(filename + " has " + items.length + " items; expected " + expected.length);
  }

  const sourceLinks = new Set(items.map(item => canonicalLink(item.link || item.guid)));
  if (sourceLinks.size !== items.length) {
    fail(filename + " contains duplicate article links");
  }

  for (const article of expected) {
    if (!sourceLinks.has(canonicalLink(article.link))) {
      fail(filename + " is missing " + article.link);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("✓ Validated " + articles.length + " articles and " + (sources.length + 1) + " RSS feeds.");
