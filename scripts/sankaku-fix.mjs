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

function excerpt(value = "") {
  const text = stripHtml(value);
  return text.length <= 300 ? text : `${text.slice(0, 297).trimEnd()}…`;
}

function attrFromTag(tag, name) {
  return new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1] || "";
}

function metaValue(html, property) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = attrFromTag(tag, "property") || attrFromTag(tag, "name");
    if (key && key.toLowerCase() === property.toLowerCase()) {
      return attrFromTag(tag, "content");
    }
  }
  return "";
}

function jsonLdArticle(html) {
  const blocks =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) || [];

  const queue = [];

  for (const block of blocks) {
    const text = block
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    try {
      queue.push(JSON.parse(text));
    } catch {}
  }

  while (queue.length) {
    const value = queue.shift();
    if (!value) continue;

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    if (typeof value !== "object") continue;

    const types = Array.isArray(value["@type"])
      ? value["@type"]
      : [value["@type"]];

    if (types.some(type => typeof type === "string" && /article|newsarticle|reportage/i.test(type))) {
      return value;
    }

    if (Array.isArray(value["@graph"])) {
      queue.push(...value["@graph"]);
    }
  }

  return null;
}

function parseArticleMetadata(html) {
  const article = jsonLdArticle(html);

  let image = "";
  if (typeof article?.image === "string") image = article.image;
  else if (Array.isArray(article?.image)) {
    image =
      article.image.find(value => typeof value === "string") ||
      article.image.find(value => value && typeof value.url === "string")?.url ||
      "";
  } else if (article?.image && typeof article.image.url === "string") {
    image = article.image.url;
  }

  image ||= metaValue(html, "og:image");

  const published =
    article?.datePublished ||
    metaValue(html, "article:published_time");

  const date = published ? new Date(published) : null;

  return {
    title: stripHtml(article?.headline || metaValue(html, "og:title") || ""),
    excerpt: excerpt(article?.description || metaValue(html, "og:description") || ""),
    image: /^https?:\/\//i.test(image) ? image : "",
    publishedAt:
      date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
  };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      accept: "text/plain, text/markdown, text/html, application/xhtml+xml, */*",
      ...(options.headers || {})
    },
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeout ?? 30000)
  });

  return {
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get("content-type") || "",
    body: await response.text()
  };
}

function isRealSankakuUrl(value) {
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

function cleanTitle(value) {
  const title = stripHtml(value).trim();
  if (!title) return "";
  if (/^(?:add\s+comment|\d+\s+comments?)$/i.test(title)) return "";
  if (/^just a moment/i.test(title)) return "";
  return title;
}

function candidatesFromRecent(markdown) {
  const byLink = new Map();
  const pattern =
    /\[([^\]]{1,250})\]\((https?:\/\/news\.sankakucomplex\.com\/n\/[^)\s]+)\)/gi;

  let match;

  while ((match = pattern.exec(markdown))) {
    const label = cleanTitle(match[1]);
    const link = match[2].replace(/[?#].*$/, "");
    if (!isRealSankakuUrl(link)) continue;

    if (!byLink.has(link)) {
      byLink.set(link, {
        link,
        labels: [],
        position: match.index
      });
    }

    if (label && !byLink.get(link).labels.includes(label)) {
      byLink.get(link).labels.push(label);
    }
  }

  return [...byLink.values()].map((entry, index) => ({
    id: hash(`sankaku|${entry.link}`),
    title:
      entry.labels
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] ||
      "Sankaku Complex article",
    link: entry.link,
    publishedAt: null,
    excerpt: "",
    image: "",
    source: { ...SOURCE },
    position: entry.position,
    recentIndex: index
  }));
}

function relativeDateForLink(markdown, link) {
  const index = markdown.indexOf(link);
  if (index < 0) return null;

  const window = markdown.slice(
    Math.max(0, index - 180),
    Math.min(markdown.length, index + 420)
  );

  if (/\bjust\s+now\b/i.test(window)) return new Date().toISOString();

  const match = window.match(
    /\b(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b/i
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const seconds =
    unit.startsWith("minute") ? amount * 60 :
    unit.startsWith("hour") ? amount * 3600 :
    unit.startsWith("day") ? amount * 86400 :
    amount * 604800;

  return new Date(Date.now() - seconds * 1000).toISOString();
}

async function enrichCandidate(item, markdown) {
  let updated = { ...item };

  const relative = relativeDateForLink(markdown, item.link);
  if (relative) updated.publishedAt = relative;

  try {
    const result = await fetchText(item.link, {
      timeout: 25000,
      headers: {
        accept: "text/html,application/xhtml+xml, */*",
        referer: SOURCE.siteUrl
      }
    });

    if (result.status >= 200 && result.status < 300) {
      const meta = parseArticleMetadata(result.body);
      updated = {
        ...updated,
        title: meta.title || updated.title,
        excerpt: meta.excerpt || updated.excerpt,
        image: meta.image || updated.image,
        publishedAt: meta.publishedAt || updated.publishedAt
      };
    }
  } catch {}

  return updated;
}

async function enrichCandidates(items, markdown, limit = 45) {
  const queue = items.slice(0, limit);
  const results = [];

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      results.push(await enrichCandidate(item, markdown));
      await sleep(100);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(5, queue.length || 1) }, worker)
  );

  return results;
}

const debug = {
  checkedAt: new Date().toISOString(),
  listing: null,
  candidateCount: 0,
  enrichedCount: 0,
  selectedCount: 0,
  mode: "unchanged"
};

const payload = JSON.parse(await fs.readFile(OUT, "utf8"));
const existing = Array.isArray(payload.articles) ? payload.articles : [];
const existingSankaku = existing.filter(item => item?.source?.id === "sankaku");
const otherArticles = existing.filter(item => item?.source?.id !== "sankaku");

const listingUrl =
  `https://r.jina.ai/http://news.sankakucomplex.com/recent-posts/?t=${Date.now()}`;

let refreshed = [];

try {
  const result = await fetchText(listingUrl, {
    timeout: 40000,
    headers: {
      accept: "text/plain, text/markdown, */*",
      "x-no-cache": "true",
      "x-cache-tolerance": "0"
    }
  });

  debug.listing = {
    url: listingUrl,
    status: result.status,
    finalUrl: result.finalUrl,
    contentType: result.contentType,
    bytes: result.body.length
  };

  if (result.status >= 200 && result.status < 300 && result.body.length > 500) {
    const candidates = candidatesFromRecent(result.body);
    debug.candidateCount = candidates.length;
    refreshed = await enrichCandidates(candidates, result.body, 45);
    debug.enrichedCount = refreshed.length;
  }
} catch (error) {
  debug.listing = {
    url: listingUrl,
    error: String(error?.message || error)
  };
}

if (refreshed.length) {
  const byLink = new Map();

  for (const item of [...existingSankaku, ...refreshed]) {
    if (!isRealSankakuUrl(item?.link)) continue;

    const key = item.link.replace(/\/+$/, "").toLowerCase();
    const current = byLink.get(key);

    if (!current) {
      byLink.set(key, item);
      continue;
    }

    byLink.set(key, {
      ...current,
      ...item,
      title: item.title || current.title,
      excerpt: item.excerpt || current.excerpt,
      image: item.image || current.image,
      publishedAt: item.publishedAt || current.publishedAt,
      source: { ...SOURCE }
    });
  }

  const sankakuArticles = [...byLink.values()]
    .filter(item => item.title)
    .sort((a, b) => {
      const left = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const right = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      if (right !== left) return right - left;
      return String(a.title).localeCompare(String(b.title));
    })
    .slice(0, 60);

  payload.articles = [...otherArticles, ...sankakuArticles].sort((a, b) => {
    const left = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const right = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    if (right !== left) return right - left;
    return String(a.title).localeCompare(String(b.title));
  }).slice(0, 500);

  const sankakuResult = (payload.sourceResults || []).find(
    item => item.id === "sankaku"
  );

  if (sankakuResult) {
    sankakuResult.status = "ok";
    sankakuResult.mode = "recent-posts-jina";
    sankakuResult.count = sankakuArticles.length;
    sankakuResult.feedUrl = "https://news.sankakucomplex.com/recent-posts/";
  }

  debug.selectedCount = sankakuArticles.length;
  debug.mode = "recent-posts-jina";
} else {
  debug.selectedCount = existingSankaku.length;
}

payload.generatedAt = new Date().toISOString();
payload.stats = payload.stats || {};
payload.stats.articleCount = payload.articles.length;
payload.stats.sourceCount = payload.sources?.length || payload.stats.sourceCount || 0;
payload.stats.successfulSources = (payload.sourceResults || []).filter(item => item.status === "ok").length;
payload.stats.failedSources = (payload.sourceResults || []).filter(item => item.status === "error").length;

await fs.writeFile(OUT, JSON.stringify(payload, null, 2));
await fs.writeFile(DEBUG_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), sankaku: debug }, null, 2));

console.log(`Sankaku refresh: ${debug.mode}; ${debug.selectedCount} stories.`);
