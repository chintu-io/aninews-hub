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
  "AniNewsHub/1.4 (personal RSS reader; github.com/chintune/aninews-hub)";

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

function parseArticleMetadataFromHtml(html) {
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

/* Sankaku blocks GitHub-hosted runners with HTTP 401.
   We use Jina Reader as the server-side retrieval path. */

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

      return { feedUrl, items };
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

function looksLikeCommentLabel(value = "") {
  return /^(?:add\s+comment|\d+\s+comments?)$/i.test(
    stripHtml(value).trim()
  );
}

function extractSankakuMarkdownCandidates(markdown, source) {
  const byLink = new Map();

  const absolutePattern =
    /\[([^\]]{1,220})\]\((https?:\/\/news\.sankakucomplex\.com\/n\/[^)\s]+)\)/gi;

  let match;

  while ((match = absolutePattern.exec(markdown))) {
    const label = stripHtml(match[1]).trim();
    const link = match[2].replace(/[?#].*$/, "");

    if (!sankakuAcceptsUrl(link)) {
      continue;
    }

    if (!byLink.has(link)) {
      byLink.set(link, {
        labels: [],
        link
      });
    }

    if (label && !byLink.get(link).labels.includes(label)) {
      byLink.get(link).labels.push(label);
    }
  }

  return [...byLink.values()].map(entry => {
    const titleCandidates = entry.labels
      .filter(label => !looksLikeCommentLabel(label))
      .sort((a, b) => b.length - a.length);

    const title =
      titleCandidates[0] ||
      entry.labels.sort((a, b) => b.length - a.length)[0] ||
      "Sankaku Complex article";

    return {
      id: hash(`sankaku|${entry.link}`),
      title,
      link: entry.link,
      publishedAt: null,
      excerpt: "",
      image: "",
      source
    };
  });
}

function extractFirstMarkdownHeading(markdown) {
  const h1 =
    /^\s*#\s+(.+?)\s*$/m.exec(markdown)?.[1] ||
    "";

  if (h1) {
    return stripHtml(h1).trim();
  }

  const titleLine =
    /^\s*Title:\s*(.+?)\s*$/im.exec(markdown)?.[1] ||
    "";

  return stripHtml(titleLine).trim();
}

function extractJinaDate(markdown) {
  const lines = markdown
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 40)) {
    const match =
      /^(?:published(?:\s*time)?|date|date published)\s*:\s*(.+)$/i.exec(
        line
      );

    if (!match) continue;

    const parsed = new Date(stripHtml(match[1]));

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const dateMatch =
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/.exec(
      markdown
    );

  if (dateMatch) {
    const parsed = new Date(dateMatch[0]);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function extractFirstUsefulParagraph(markdown, title) {
  const lines = markdown
    .split(/\r?\n/)
    .map(line => line.trim());

  const stopLabels = new Set([
    "URL Source:",
    "Published Time:",
    "Markdown Content:"
  ]);

  for (const line of lines) {
    if (
      !line ||
      line === title ||
      line.startsWith("#") ||
      stopLabels.has(line)
    ) {
      continue;
    }

    if (
      /^https?:\/\//i.test(line) ||
      /^by\s+/i.test(line) ||
      looksLikeCommentLabel(line)
    ) {
      continue;
    }

    if (line.length < 80) {
      continue;
    }

    return excerpt(line);
  }

  return "";
}

function extractFirstMarkdownImage(markdown) {
  const image =
    /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i.exec(markdown)?.[1] ||
    "";

  return image;
}

async function enrichSankakuArticle(article, debug) {
  const jinaUrl =
    `https://r.jina.ai/http://${article.link.replace(
      /^https?:\/\//i,
      ""
    )}`;

  try {
    const response = await fetchUrl(jinaUrl, {
      headers: {
        accept: "text/plain, text/markdown, */*"
      },
      timeout: 40000
    });

    debug.attempts.push({
      link: article.link,
      status: response.status,
      bytes: response.body.length
    });

    if (response.status < 200 || response.status >= 300) {
      return article;
    }

    const title = extractFirstMarkdownHeading(response.body);
    const publishedAt = extractJinaDate(response.body);
    const image = extractFirstMarkdownImage(response.body);
    const bodyExcerpt = extractFirstUsefulParagraph(
      response.body,
      title || article.title
    );

    return {
      ...article,
      title:
        title && !looksLikeCommentLabel(title)
          ? title
          : article.title,
      publishedAt: publishedAt || article.publishedAt,
      image: image || article.image,
      excerpt: bodyExcerpt || article.excerpt
    };
  } catch (error) {
    debug.attempts.push({
      link: article.link,
      error: String(error?.message || error)
    });

    return article;
  }
}

async function enrichSankakuArticles(items, debug) {
  const queue = [...items];
  const results = [];
  const workers = Math.min(2, queue.length || 1);

  const worker = async () => {
    while (queue.length) {
      const article = queue.shift();
      if (!article) return;

      results.push(
        await enrichSankakuArticle(article, debug)
      );

      // Keep below the public Jina Reader request rate.
      await sleep(1500);
    }
  };

  await Promise.all(
    Array.from({ length: workers }, () => worker())
  );

  const byLink = new Map(
    results.map(item => [item.link, item])
  );

  return items.map(item => byLink.get(item.link) || item);
}

async function fetchSankakuViaJina(debug) {
  const source = sankakuSource();
  const pageUrl =
    "https://r.jina.ai/http://news.sankakucomplex.com/recent-posts/";

  const result = await fetchUrl(pageUrl, {
    headers: {
      accept: "text/plain, text/markdown, */*"
    },
    timeout: 40000
  });

  debug.recentPosts = {
    url: pageUrl,
    status: result.status,
    finalUrl: result.finalUrl,
    contentType: result.contentType,
    bytes: result.body.length
  };

  if (result.status < 200 || result.status >= 300) {
    return {
      items: [],
      error: `Jina Recent Posts HTTP ${result.status}`
    };
  }

  const candidates = extractSankakuMarkdownCandidates(
    result.body,
    source
  ).slice(0, 30);

  debug.candidateCount = candidates.length;
  debug.candidateSamples = candidates.slice(0, 10).map(item => ({
    titleFromRecentPage: item.title,
    link: item.link
  }));

  const enriched = await enrichSankakuArticles(
    candidates,
    debug
  );

  const cutoff = recentCutoff(60);

  const accepted = enriched
    .filter(item => sankakuAcceptsUrl(item.link))
    .filter(item => {
      if (!item.publishedAt) {
        return true;
      }

      return isRecent(item.publishedAt, cutoff);
    })
    .filter(item => !looksLikeCommentLabel(item.title))
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt || 0) -
        Date.parse(a.publishedAt || 0)
    );

  debug.enrichedCount = enriched.length;
  debug.acceptedCount = accepted.length;
  debug.acceptedSamples = accepted.slice(0, 10).map(item => ({
    title: item.title,
    publishedAt: item.publishedAt,
    link: item.link,
    image: Boolean(item.image)
  }));

  return {
    mode: "jina-reader-recent-posts+article-pages",
    items: accepted
  };
}

async function fetchSankaku() {
  const diagnostics = {
    checkedAt: new Date().toISOString(),
    official: [],
    jina: {
      mode: "not-run",
      recentPosts: null,
      candidateCount: 0,
      enrichedCount: 0,
      acceptedCount: 0,
      attempts: [],
      candidateSamples: [],
      acceptedSamples: []
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

  const fallback = await fetchSankakuViaJina(
    diagnostics.jina
  );

  diagnostics.jina.mode = fallback.mode || "empty";

  if (fallback.items.length) {
    diagnostics.selectedMode =
      "jina-reader-recent-posts+article-pages";
    diagnostics.selectedCount = fallback.items.length;

    return {
      items: fallback.items,
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

  const results = [];

  for (const item of missing.slice(0, 40)) {
    try {
      const enriched = await enrichSankakuArticle(
        item,
        { attempts: [] }
      );

      results.push({
        article: enriched,
        status: "ok"
      });
    } catch (error) {
      results.push({
        article: item,
        status: String(error?.message || error)
      });
    }
  }

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

      for (const item of result.items.slice(0, 8)) {
        console.log(
          `  - ${item.publishedAt || "no date"} ${item.title}`
        );
      }

      continue;
    }

    let result = await fetchNormal(source);

    const enrichment =
      source.id === "ann"
        ? await (async () => {
            const missing = result.items.filter(
              item => !item.image
            );

            let resolved = 0;
            const merged = [...result.items];

            for (const item of missing.slice(0, 40)) {
              try {
                const enriched =
                  await enrichSankakuArticle(
                    item,
                    { attempts: [] }
                  );

                const index = merged.findIndex(
                  current => current.link === item.link
                );

                if (index >= 0) {
                  merged[index] = enriched;
                }

                if (enriched.image) {
                  resolved++;
                }
              } catch {}
            }

            return {
              items: merged,
              attempted: Math.min(
                missing.length,
                40
              ),
              resolved
            };
          })()
        : {
            items: result.items,
            attempted: 0,
            resolved: 0
          };

    result.items = enrichment.items;
    allArticles.push(...result.items);

    sourceResults.push({
      id: source.id,
      name: source.name,
      status: "ok",
      mode: "rss",
      feedUrl: result.feedUrl,
      count: result.items.length,
      imageEnrichment: source.id === "ann"
        ? {
            attempted: enrichment.attempted,
            resolved: enrichment.resolved
          }
        : null
    });

    console.log(
      `✓ ${source.name}: ${result.items.length} stories`
    );

    if (source.id === "ann") {
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
