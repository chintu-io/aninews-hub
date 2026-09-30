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
  "AniNewsHub/1.2 (personal RSS reader; contact: github.com/chintune/aninews-hub)";

const hash = value =>
  crypto
    .createHash("sha1")
    .update(String(value))
    .digest("hex")
    .slice(0, 16);

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

  return (
    candidates.find(value => /^https?:\/\//i.test(value || "")) || ""
  );
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
  const headers = {
    "user-agent": USER_AGENT,
    accept:
      "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/json, */*",
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body,
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeout ?? 30000)
  });

  return {
    url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    bytes: Number(response.headers.get("content-length") || 0),
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
      return {
        article,
        status: `HTTP ${response.status}`
      };
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

/* Sankaku is currently returning HTTP 401 to GitHub-hosted runners.
   The fallback therefore uses Google News only as a discovery layer.
   Google now wraps RSS article links in URLs that are not ordinary HTTP
   redirects. The decoder below resolves those links through Google's
   batchexecute endpoint, then we keep only real /n/ Sankaku articles. */

function googleNewsId(value = "") {
  try {
    const url = new URL(value);

    if (
      url.hostname !== "news.google.com" ||
      !url.pathname.includes("/articles/")
    ) {
      return "";
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const index = parts.lastIndexOf("articles");

    return index >= 0 ? parts[index + 1] || "" : "";
  } catch {
    return "";
  }
}

function extractSankakuUrlFromDecodedBytes(buffer) {
  const text = buffer.toString("latin1");

  const direct = /https?:\/\/news\.sankakucomplex\.com\/n\/[^\x00"'\s<)]+/i.exec(
    text
  );

  return direct?.[0] || "";
}

function decodeOldGoogleNewsUrl(value) {
  const id = googleNewsId(value);

  if (!id) return "";

  try {
    const decoded = Buffer.from(id, "base64url");
    return extractSankakuUrlFromDecodedBytes(decoded);
  } catch {
    return "";
  }
}

function googleDataAttribute(html, attribute, dataId) {
  const tags = html.match(/<[^>]+>/g) || [];

  for (const tag of tags) {
    const id = attrFromTag(tag, "data-n-a-id");

    if (id !== dataId) continue;

    const value = attrFromTag(tag, attribute);

    if (value) return value;
  }

  const loose = new RegExp(
    `data-n-a-id=["']${dataId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*`,
    "i"
  ).exec(html);

  return loose ? attrFromTag(loose[0], attribute) : "";
}

async function decodeGoogleNewsUrl(value, diagnostics) {
  const dataId = googleNewsId(value);

  if (!dataId) return "";

  const oldDecoded = decodeOldGoogleNewsUrl(value);

  if (oldDecoded) {
    return oldDecoded;
  }

  let googlePage;

  try {
    googlePage = await fetchUrl(value, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
        referer: "https://news.google.com/"
      },
      timeout: 25000
    });
  } catch (error) {
    diagnostics.push({
      stage: "google-page",
      dataId,
      status: "request-failed",
      message: String(error?.message || error)
    });
    return "";
  }

  const signature =
    googleDataAttribute(googlePage.body, "data-n-a-sg", dataId);
  const timestamp =
    googleDataAttribute(googlePage.body, "data-n-a-ts", dataId);

  if (!signature || !timestamp) {
    diagnostics.push({
      stage: "google-page",
      dataId,
      status: "missing-signature",
      httpStatus: googlePage.status,
      finalUrl: googlePage.finalUrl,
      bytes: googlePage.body.length
    });
    return "";
  }

  const request = [
    "Fbv4je",
    `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${dataId}",${timestamp},"${signature}"]`
  ];

  const body =
    "f.req=" +
    encodeURIComponent(JSON.stringify([[request]]));

  let response;

  try {
    response = await fetchUrl(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
      {
        method: "POST",
        headers: {
          "content-type":
            "application/x-www-form-urlencoded;charset=UTF-8",
          referer: "https://news.google.com/",
          origin: "https://news.google.com"
        },
        body,
        timeout: 25000
      }
    );
  } catch (error) {
    diagnostics.push({
      stage: "google-batchexecute",
      dataId,
      status: "request-failed",
      message: String(error?.message || error)
    });
    return "";
  }

  if (response.status < 200 || response.status >= 300) {
    diagnostics.push({
      stage: "google-batchexecute",
      dataId,
      status: "http-error",
      httpStatus: response.status
    });
    return "";
  }

  const lines = response.body
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    try {
      const outer = JSON.parse(line);

      if (!Array.isArray(outer) || !outer[0]?.[2]) {
        continue;
      }

      const inner = JSON.parse(outer[0][2]);

      if (Array.isArray(inner) && typeof inner[1] === "string") {
        const resolved = inner[1];

        if (/^https?:\/\//i.test(resolved)) {
          return resolved;
        }
      }
    } catch {
      // Continue searching other response lines.
    }
  }

  const marker = '[\\"garturlres\\",\\"';
  const markerIndex = response.body.indexOf(marker);

  if (markerIndex >= 0) {
    const start = markerIndex + marker.length;
    const end = response.body.indexOf('\\",', start);

    if (end > start) {
      const resolved = response.body.slice(start, end);

      if (/^https?:\/\//i.test(resolved)) {
        return resolved;
      }
    }
  }

  diagnostics.push({
    stage: "google-batchexecute",
    dataId,
    status: "no-url-in-response"
  });

  return "";
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

async function sankakuGoogleFallback() {
  const source = sankakuSource();
  const cutoff = recentCutoff(60);

  const after = cutoff.toISOString().slice(0, 10);
  const before = new Date(Date.now() + 86400000)
    .toISOString()
    .slice(0, 10);

  const queries = [
    `site:news.sankakucomplex.com after:${after} before:${before}`,
    `site:news.sankakucomplex.com Sankaku after:${after} before:${before}`
  ];

  const accepted = [];
  const rejected = [];
  const decoderDiagnostics = [];
  let feedUrls = [];
  let rssCandidateCount = 0;

  for (const query of queries) {
    const feedUrl =
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
      "&hl=en-US&gl=US&ceid=US:en";

    feedUrls.push(feedUrl);

    let fetched;

    try {
      fetched = await fetchUrl(feedUrl);

      if (fetched.status < 200 || fetched.status >= 300) {
        rejected.push({
          reason: "google-rss-http-error",
          query,
          status: fetched.status
        });
        continue;
      }

      const feed = await parser.parseString(fetched.body);
      const items = feed.items || [];

      rssCandidateCount += items.length;

      for (const item of items.slice(0, 25)) {
        const googleUrl = item.link || item.guid || "";

        if (!googleUrl) continue;

        const publishedRaw =
          item.isoDate ||
          item.pubDate ||
          null;

        const published =
          publishedRaw ? new Date(publishedRaw) : null;

        if (
          published &&
          !Number.isNaN(published.getTime()) &&
          published < cutoff
        ) {
          rejected.push({
            reason: "stale-rss-item",
            title: stripHtml(item.title || ""),
            publishedAt: published.toISOString(),
            googleUrl
          });
          continue;
        }

        const resolvedUrl = await decodeGoogleNewsUrl(
          googleUrl,
          decoderDiagnostics
        );

        if (!sankakuAcceptsUrl(resolvedUrl)) {
          rejected.push({
            reason: "resolved-non-article",
            title: stripHtml(item.title || ""),
            publishedAt: publishedRaw,
            googleUrl,
            resolvedUrl
          });
          await sleep(180);
          continue;
        }

        const title =
          stripHtml(item.title || "") || "Sankaku Complex";

        accepted.push({
          id: hash(`sankaku|${resolvedUrl}`),
          title,
          link: resolvedUrl,
          publishedAt:
            published &&
            !Number.isNaN(published.getTime())
              ? published.toISOString()
              : null,
          excerpt: excerpt(
            item.contentSnippet ||
            item.description ||
            ""
          ),
          image: "",
          source
        });

        await sleep(180);
      }
    } catch (error) {
      rejected.push({
        reason: "google-rss-failed",
        query,
        message: String(error?.message || error)
      });
    }
  }

  const unique = new Map();

  for (const item of accepted) {
    if (!unique.has(item.link)) {
      unique.set(item.link, item);
    }
  }

  const items = [...unique.values()]
    .filter(item => isRecent(item.publishedAt, cutoff))
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt || 0) -
        Date.parse(a.publishedAt || 0)
    )
    .slice(0, 30);

  return {
    mode: "google-news-decoded",
    feedUrls,
    cutoff: cutoff.toISOString(),
    rssCandidateCount,
    items,
    rejected: rejected.slice(0, 50),
    decoderDiagnostics: decoderDiagnostics.slice(0, 30)
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
    feedUrls: fallback.feedUrls,
    cutoff: fallback.cutoff,
    rssCandidateCount: fallback.rssCandidateCount,
    accepted: fallback.items.length,
    sample: fallback.items.slice(0, 10).map(item => ({
      title: item.title,
      publishedAt: item.publishedAt,
      link: item.link
    })),
    rejected: fallback.rejected,
    decoderDiagnostics: fallback.decoderDiagnostics
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
          `  - ${item.publishedAt || "no date"} ${item.title}`
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
  const key = article.link
    .replace(/\/+$/, "")
    .toLowerCase();

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
