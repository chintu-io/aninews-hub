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

const USER_AGENT = "AniNewsHub/1.5 (personal RSS reader)";

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
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value = "") {
  const text = stripHtml(value);
  return text.length <= 260 ? text : `${text.slice(0, 257).trimEnd()}…`;
}

function asArray(value) {
  return !value ? [] : Array.isArray(value) ? value : [value];
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
        "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
      ...(options.headers || {})
    },
    body: options.body,
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

async function parseFeed(url) {
  const result = await fetchUrl(url);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`HTTP ${result.status}`);
  }

  if (!result.body.trim()) {
    throw new Error("Empty response");
  }

  return {
    result,
    feed: await parser.parseString(result.body)
  };
}

function attrFromTag(tag, name) {
  return (
    new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1] ||
    ""
  );
}

function metaValue(html, property) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key =
      attrFromTag(tag, "property") ||
      attrFromTag(tag, "name");

    if (key.toLowerCase() === property.toLowerCase()) {
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

    if (
      types.some(
        type =>
          typeof type === "string" &&
          /article|newsarticle|reportage/i.test(type)
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

function parseHtmlMetadata(html) {
  const article = jsonLdArticle(html);

  let image = "";

  if (typeof article?.image === "string") {
    image = article.image;
  } else if (Array.isArray(article?.image)) {
    image =
      article.image.find(item => typeof item === "string") ||
      article.image.find(item => item && typeof item.url === "string")?.url ||
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
    title:
      stripHtml(article?.headline || metaValue(html, "og:title") || ""),
    description:
      stripHtml(article?.description || metaValue(html, "og:description") || ""),
    image: /^https?:\/\//i.test(image) ? image : "",
    publishedAt:
      date && !Number.isNaN(date.getTime())
        ? date.toISOString()
        : null
  };
}

async function enrichDirectPage(item) {
  try {
    const result = await fetchUrl(item.link);

    if (result.status < 200 || result.status >= 300) {
      return item;
    }

    const meta = parseHtmlMetadata(result.body);

    return {
      ...item,
      title: meta.title || item.title,
      excerpt: meta.description ? excerpt(meta.description) : item.excerpt,
      image: meta.image || item.image,
      publishedAt: meta.publishedAt || item.publishedAt
    };
  } catch {
    return item;
  }
}

async function enrichAnn(items) {
  const missing = items.filter(item => !item.image);
  const results = [];
  const queue = [...missing.slice(0, 40)];

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;

      results.push(await enrichDirectPage(item));
      await sleep(120);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(3, queue.length || 1) },
      () => worker()
    )
  );

  const byLink = new Map(results.map(item => [item.link, item]));

  let resolved = 0;

  const merged = items.map(item => {
    const updated = byLink.get(item.link);

    if (!updated) return item;

    if (updated.image) resolved++;

    return updated;
  });

  return {
    items: merged,
    attempted: results.length,
    resolved
  };
}

function isCommentLabel(value = "") {
  return /^(?:add\s+comment|\d+\s+comments?)$/i.test(
    stripHtml(value).trim()
  );
}

function realSankakuUrl(value) {
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

function sankakuCandidatesFromRecent(markdown, source) {
  const byLink = new Map();
  const pattern =
    /\[([^\]]{1,220})\]\((https?:\/\/news\.sankakucomplex\.com\/n\/[^)\s]+)\)/gi;

  let match;

  while ((match = pattern.exec(markdown))) {
    const label = stripHtml(match[1]).trim();
    const link = match[2].replace(/[?#].*$/, "");

    if (!realSankakuUrl(link)) continue;

    if (!byLink.has(link)) {
      byLink.set(link, {
        link,
        labels: [],
        position: byLink.size
      });
    }

    if (label && !byLink.get(link).labels.includes(label)) {
      byLink.get(link).labels.push(label);
    }
  }

  return [...byLink.values()].map(entry => {
    const labels = entry.labels
      .filter(label => !isCommentLabel(label))
      .sort((a, b) => b.length - a.length);

    return {
      id: hash(`sankaku|${entry.link}`),
      title: labels[0] || "Sankaku Complex article",
      link: entry.link,
      publishedAt: null,
      excerpt: "",
      image: "",
      position: entry.position,
      source
    };
  });
}

function jinaTitle(markdown) {
  const afterContent =
    markdown.split(/^Markdown Content:\s*$/im)[1] || markdown;

  const headingMatches = [
    ...afterContent.matchAll(/^\s*#\s+(.+?)\s*$/gm)
  ];

  for (const match of headingMatches) {
    const title = stripHtml(match[1]).trim();

    if (
      title &&
      !/^just a moment/i.test(title) &&
      !isCommentLabel(title)
    ) {
      return title;
    }
  }

  const titleLine =
    /^\s*Title:\s*(.+?)\s*$/im.exec(markdown)?.[1] || "";

  const cleaned = stripHtml(titleLine).trim();

  return !isCommentLabel(cleaned) && !/^just a moment/i.test(cleaned)
    ? cleaned
    : "";
}

function jinaDate(markdown) {
  const value =
    /^\s*Published Time:\s*(.+?)\s*$/im.exec(markdown)?.[1] ||
    /^\s*Published:\s*(.+?)\s*$/im.exec(markdown)?.[1] ||
    "";

  if (!value) return null;

  const date = new Date(stripHtml(value));

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

function jinaImage(markdown) {
  return (
    /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i.exec(markdown)?.[1] || ""
  );
}


function recentRelativeTime(markdown, link) {
  const index = markdown.indexOf(link);

  if (index < 0) {
    return null;
  }

  const window = markdown.slice(
    Math.max(0, index - 120),
    Math.min(markdown.length, index + 320)
  );

  if (/\bjust\s+now\b/i.test(window)) {
    return new Date().toISOString();
  }

  const match = window.match(
    /\b(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b/i
  );

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);

  const unit = match[2].toLowerCase();

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

function jinaExcerpt(markdown, title) {
  const afterContent =
    markdown.split(/^Markdown Content:\s*$/im)[1] || markdown;

  for (const rawLine of afterContent.split(/\r?\n/)) {
    const line = stripHtml(rawLine).trim();

    if (
      !line ||
      line === title ||
      line.startsWith("#") ||
      /^https?:\/\//i.test(line) ||
      isCommentLabel(line) ||
      line.length < 70
    ) {
      continue;
    }

    return excerpt(line);
  }

  return "";
}

async function enrichSankaku(item, debug, recentMarkdown = "") {
  const readerTarget =
    `${item.link}${item.link.includes("?") ? "&" : "?"}_aninews=${Date.now()}`;

  const readerUrl =
    `https://r.jina.ai/http://${readerTarget.replace(
      /^https?:\/\//i,
      ""
    )}`;

  const recentPublishedAt =
    recentRelativeTime(recentMarkdown, item.link);

  try {
    const result = await fetchUrl(readerUrl, {
      headers: {
        accept: "text/plain, text/markdown, */*",
        "x-no-cache": "true",
        "x-cache-tolerance": "0",
        "x-respond-timing": "longest"
      },
      timeout: 40000
    });

    debug.attempts.push({
      link: item.link,
      status: result.status,
      bytes: result.body.length
    });

    if (result.status < 200 || result.status >= 300) {
      return item;
    }

    const title = jinaTitle(result.body);
    const publishedAt = jinaDate(result.body);
    const image = jinaImage(result.body);
    const summary = jinaExcerpt(result.body, title);

    return {
      ...item,
      title: title || item.title,
      publishedAt:
        recentPublishedAt ||
        item.publishedAt ||
        publishedAt ||
        null,
      image: image || item.image,
      excerpt: summary || item.excerpt,
      position: item.position
    };
  } catch (error) {
    debug.attempts.push({
      link: item.link,
      error: String(error?.message || error)
    });

    return item;
  }
}

async function fetchSankaku() {
  const source = SOURCES.find(item => item.id === "sankaku");

  const diagnostics = {
    checkedAt: new Date().toISOString(),
    official: [],
    jina: {
      mode: "not-run",
      recentPosts: null,
      candidateCount: 0,
      enrichedCount: 0,
      acceptedCount: 0,
      candidateSamples: [],
      acceptedSamples: [],
      attempts: []
    },
    selectedMode: null,
    selectedCount: 0
  };

  // Keep the official feed first. It may work again in the future.
  for (const feedUrl of source.feedUrls) {
    try {
      const { result, feed } = await parseFeed(feedUrl);

      diagnostics.official.push({
        url: feedUrl,
        finalUrl: result.finalUrl,
        status: result.status,
        contentType: result.contentType,
        bytes: result.body.length
      });

      const items = (feed.items || [])
        .map(item => normalize(item, source))
        .filter(Boolean)
        .filter(item => realSankakuUrl(item.link));

      if (items.length) {
        diagnostics.selectedMode = "official-rss";
        diagnostics.selectedCount = items.length;

        return { items, diagnostics };
      }
    } catch (error) {
      diagnostics.official.push({
        url: feedUrl,
        error: String(error?.message || error)
      });
    }
  }

  const recentTarget =
    `http://news.sankakucomplex.com/recent-posts/?_aninews=${Date.now()}`;

  const recentUrl =
    `https://r.jina.ai/${recentTarget}`;

  try {
    const page = await fetchUrl(recentUrl, {
      headers: {
        accept: "text/plain, text/markdown, */*",
        "x-no-cache": "true",
        "x-cache-tolerance": "0",
        "x-respond-timing": "longest"
      },
      timeout: 40000
    });

    diagnostics.jina.recentPosts = {
      url: recentUrl,
      status: page.status,
      finalUrl: page.finalUrl,
      contentType: page.contentType,
      bytes: page.body.length,
      cacheBypass: true
    };

    if (page.status >= 200 && page.status < 300) {
      const candidates = sankakuCandidatesFromRecent(
        page.body,
        source
      ).slice(0, 20);

      diagnostics.jina.candidateCount = candidates.length;
      diagnostics.jina.candidateSamples = candidates.slice(0, 10).map(item => ({
        titleFromList: item.title,
        link: item.link
      }));

      const queue = [...candidates];
      const enriched = [];

      const worker = async () => {
        while (queue.length) {
          const item = queue.shift();
          if (!item) return;

          enriched.push(
            await enrichSankaku(
              item,
              diagnostics.jina,
              page.body
            )
          );

          await sleep(1000);
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(2, queue.length || 1) },
          () => worker()
        )
      );

      diagnostics.jina.enrichedCount = enriched.length;

      // Do NOT throw away an article merely because Jina failed to expose its
      // publication date. The Recent Posts page is itself the recency source.
      const accepted = enriched.filter(
        item =>
          realSankakuUrl(item.link) &&
          item.title &&
          !isCommentLabel(item.title) &&
          !/^just a moment/i.test(item.title)
      );

      accepted.sort(
        (a, b) =>
          (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER)
      );

      diagnostics.jina.acceptedCount = accepted.length;
      diagnostics.jina.acceptedSamples = accepted.slice(0, 10).map(item => ({
        position: item.position,
        title: item.title,
        publishedAt: item.publishedAt,
        link: item.link,
        image: Boolean(item.image)
      }));

      if (accepted.length) {
        diagnostics.jina.mode =
          "jina-reader-recent-posts+article-pages";
        diagnostics.selectedMode =
          "jina-reader-recent-posts+article-pages";
        diagnostics.selectedCount = accepted.length;

        return {
          items: accepted,
          diagnostics
        };
      }
    }
  } catch (error) {
    diagnostics.jina.error =
      String(error?.message || error);
  }

  diagnostics.jina.mode = "empty";
  diagnostics.selectedMode = "empty";
  diagnostics.selectedCount = 0;

  return {
    items: [],
    diagnostics
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

      continue;
    }

    const { result, feed } = await parseFeed(
      source.feedUrls[0]
    );

    let items = (feed.items || [])
      .map(item => normalize(item, source))
      .filter(Boolean);

    let imageEnrichment = null;

    // ANN image enrichment is intentionally direct HTTP/HTML.
    // This is the path that previously resolved 40/40 images.
    if (source.id === "ann") {
      const enrichment = await enrichAnn(items);
      items = enrichment.items;

      imageEnrichment = {
        attempted: enrichment.attempted,
        resolved: enrichment.resolved
      };

      console.log(
        `✓ ${source.name}: ${items.length} stories`
      );
      console.log(
        `  image enrichment: ${enrichment.resolved}/${enrichment.attempted}`
      );
    } else {
      console.log(
        `✓ ${source.name}: ${items.length} stories`
      );
    }

    allArticles.push(...items);

    sourceResults.push({
      id: source.id,
      name: source.name,
      status: "ok",
      mode: "rss",
      feedUrl: source.feedUrls[0],
      count: items.length,
      imageEnrichment
    });
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
    const left = a.publishedAt
      ? Date.parse(a.publishedAt)
      : 0;

    const right = b.publishedAt
      ? Date.parse(b.publishedAt)
      : 0;

    if (right !== left) return right - left;

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
