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
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

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
  const htmlCandidates = [
    item.contentEncoded,
    item.content,
    item.description,
    item.summary
  ];

  for (const value of htmlCandidates) {
    const image = imageFromText(value || "", item.link || source?.siteUrl || "");

    if (image) {
      return image;
    }
  }

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
      "user-agent": options.userAgent || USER_AGENT,
      accept:
        options.accept ||
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

function absoluteUrl(value, baseUrl = "") {
  const cleaned = String(value || "").trim();

  if (!cleaned) return "";

  try {
    return new URL(cleaned, baseUrl || undefined).href;
  } catch {
    return "";
  }
}

function imageFromText(value = "", baseUrl = "") {
  const text = String(value);

  const markdown =
    /!\[[^\]]*\]\(<?([^)>\s]+)>?\)/i.exec(text)?.[1] ||
    "";

  const markdownImage = absoluteUrl(markdown, baseUrl);

  if (/^https?:\/\//i.test(markdownImage)) return markdownImage;

  const htmlTags = text.match(/<img\b[^>]*>/gi) || [];

  for (const tag of htmlTags) {
    for (const attr of [
      "src",
      "data-src",
      "data-lazy-src",
      "data-original"
    ]) {
      const value = attrFromTag(tag, attr);
      const resolved = absoluteUrl(value, baseUrl);

      if (/^https?:\/\//i.test(resolved)) return resolved;
    }

    const srcset =
      attrFromTag(tag, "srcset") ||
      attrFromTag(tag, "data-srcset") ||
      "";

    const firstSrcset = srcset
      .split(",")[0]
      ?.trim()
      .split(/\s+/)[0] || "";

    const resolvedSrcset = absoluteUrl(firstSrcset, baseUrl);

    if (/^https?:\/\//i.test(resolvedSrcset)) {
      return resolvedSrcset;
    }
  }

  const generic =
    /(?:https?:\/\/|\/)[^\s"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/i.exec(text)?.[0] ||
    "";

  const resolvedGeneric = absoluteUrl(
    generic.replace(/^\s+/, ""),
    baseUrl
  );

  return /^https?:\/\//i.test(resolvedGeneric)
    ? resolvedGeneric
    : "";
}

function sankakuMetaImage(html, articleUrl) {
  const metaImageBlock =
    /<div\b[^>]*class=["'][^"']*\bmeta-image\b[^"']*["'][^>]*>[\s\S]{0,5000}?<img\b[^>]*>/i.exec(html)?.[0] ||
    "";

  const targeted = imageFromText(metaImageBlock, articleUrl);

  if (targeted) return targeted;

  return imageFromText(html, articleUrl);
}

function jinaImage(markdown) {
  return imageFromText(markdown);
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
  const readerUrl =
    `https://r.jina.ai/http://${item.link.replace(
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


async function enrichSankakuImagesFromRecentPage(
  items,
  recentMarkdown,
  debug
) {
  const missing = items.filter(item => !item.image);

  if (!missing.length || !recentMarkdown) {
    return {
      items,
      attempted: missing.length,
      resolved: 0
    };
  }

  const imageRefs = [];

  const markdownPattern =
    /!\[[^\]]*\]\(<?(https?:\/\/[^)\s>]+)>?\)/gi;

  let match;

  while ((match = markdownPattern.exec(recentMarkdown))) {
    imageRefs.push({
      url: match[1],
      position: match.index
    });
  }

  const htmlPattern =
    /<img\b[^>]+(?:src|data-src|data-lazy-src|data-original)=["'](https?:\/\/[^"']+)["'][^>]*>/gi;

  while ((match = htmlPattern.exec(recentMarkdown))) {
    imageRefs.push({
      url: match[1],
      position: match.index
    });
  }

  const srcsetPattern =
    /(?:srcset|data-srcset)=["']([^"']+)["']/gi;

  while ((match = srcsetPattern.exec(recentMarkdown))) {
    const first =
      match[1].split(",")[0]?.trim().split(/\s+/)[0];

    if (/^https?:\/\//i.test(first || "")) {
      imageRefs.push({
        url: first,
        position: match.index
      });
    }
  }

  imageRefs.sort((a, b) => a.position - b.position);

  let resolved = 0;

  const enriched = items.map(item => {
    if (item.image) return item;

    const linkPosition = recentMarkdown.indexOf(item.link);

    if (linkPosition < 0 || !imageRefs.length) {
      return item;
    }

    let best = null;
    let bestDistance = Number.MAX_SAFE_INTEGER;

    for (const image of imageRefs) {
      const distance = Math.abs(
        image.position - linkPosition
      );

      if (distance > 1600) continue;

      if (distance < bestDistance) {
        best = image;
        bestDistance = distance;
      }
    }

    if (!best) return item;

    resolved++;

    return {
      ...item,
      image: best.url
    };
  });

  debug.imageEnrichment = {
    attempted: missing.length,
    availableImageReferences: imageRefs.length,
    resolved
  };

  return {
    items: enriched,
    attempted: missing.length,
    resolved
  };
}

async function fetchSankakuArticleVariant(item, url, debug) {
  const variants = [
    { kind: "direct", url },
    { kind: "direct-slash", url: url.endsWith("/") ? url : `${url}/` },
    { kind: "direct-amp", url: url.endsWith("/") ? `${url}amp/` : `${url}/amp/` },
    {
      kind: "jina-https",
      url: `https://r.jina.ai/https://${url.replace(/^https?:\/\//i, "")}`
    },
    {
      kind: "jina-http",
      url: `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`
    }
  ];

  const seen = new Set();

  for (const variant of variants) {
    if (seen.has(variant.url)) continue;
    seen.add(variant.url);

    try {
      const useBrowser = variant.kind.startsWith("direct");
      const result = await fetchUrl(variant.url, {
        userAgent: useBrowser ? BROWSER_USER_AGENT : USER_AGENT,
        accept: useBrowser
          ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
          : "text/plain, text/markdown, */*",
        headers: useBrowser
          ? {
              "accept-language": "en-US,en;q=0.9",
              "cache-control": "no-cache",
              pragma: "no-cache",
              referer: "https://www.google.com/"
            }
          : {
              "x-no-cache": "true",
              "x-cache-tolerance": "0",
              "x-respond-timing": "longest"
            },
        timeout: useBrowser ? 25000 : 40000
      });

      const image =
        result.status >= 200 && result.status < 300
          ? sankakuMetaImage(result.body, item.link)
          : "";

      debug.articlePages = debug.articlePages || [];
      debug.articlePages.push({
        link: item.link,
        kind: variant.kind,
        requestUrl: variant.url,
        status: result.status,
        finalUrl: result.finalUrl,
        contentType: result.contentType,
        bytes: result.body.length,
        image: image || null,
        bodyPreview:
          result.status >= 200 && result.status < 300
            ? result.body.slice(0, 180).replace(/\s+/g, " ")
            : result.body.slice(0, 260).replace(/\s+/g, " ")
      });

      if (image) {
        return { image, kind: variant.kind, status: result.status };
      }
    } catch (error) {
      debug.articlePages = debug.articlePages || [];
      debug.articlePages.push({
        link: item.link,
        kind: variant.kind,
        requestUrl: variant.url,
        error: String(error?.message || error)
      });
    }
  }

  return { image: "", kind: "none", status: null };
}

async function enrichSankakuImagesFromArticlePages(items, debug) {
  const missing = items.filter(item => !item.image);

  if (!missing.length) {
    return { items, attempted: 0, resolved: 0 };
  }

  const queue = [...missing];
  const results = [];

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;

      const result = await fetchSankakuArticleVariant(
        item,
        item.link,
        debug
      );

      results.push({
        item,
        image: result.image
      });

      await sleep(150);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(3, queue.length || 1) },
      () => worker()
    )
  );

  const byLink = new Map(
    results.map(result => [result.item.link, result.image])
  );

  let resolved = 0;

  const merged = items.map(item => {
    if (item.image) return item;

    const image = byLink.get(item.link) || "";

    if (!image) return item;

    resolved++;

    return {
      ...item,
      image
    };
  });

  return {
    items: merged,
    attempted: missing.length,
    resolved
  };
}

async function fetchSankakuRecentPosts(debug) {
  const url =
    "https://r.jina.ai/http://news.sankakucomplex.com/recent-posts/";

  try {
    const result = await fetchUrl(url, {
      headers: {
        accept: "text/plain, text/markdown, */*",
        "x-no-cache": "true",
        "x-cache-tolerance": "0",
        "x-respond-timing": "longest"
      },
      timeout: 40000
    });

    debug.recentPosts = {
      url,
      status: result.status,
      finalUrl: result.finalUrl,
      contentType: result.contentType,
      bytes: result.body.length
    };

    if (result.status >= 200 && result.status < 300) {
      return result.body;
    }
  } catch (error) {
    debug.recentPosts = {
      url,
      error: String(error?.message || error)
    };
  }

  return "";
}


const DEPLOYED_ARTICLES_URL =
  "https://chintune.github.io/aninews-hub/data/articles.json";

const BOOTSTRAP_SANKAKU_CACHE = [
  {
    "title": "Azur Lane’s Implacable Gets Sexy in the Dormitory",
    "link": "https://news.sankakucomplex.com/n/ElioQnMz7U2R_Rp12b_VVg",
    "publishedAt": "2026-09-30T07:12:17.000Z",
    "excerpt": "Azur Lane finally added the attractive Implacable to the game’s dormitory function, allowing players to witness the woman in a more casual setting and earning a ton of praise considering her lewd outfits and buxomness in general. Azur Lane’s official Twitte…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "North America Now Accounts for 40% of Persona Sales, Twice as Much as Japan",
    "link": "https://news.sankakucomplex.com/n/YkzfvTWVRMI2E8KPj0Sglw",
    "publishedAt": "2026-09-30T03:00:12.000Z",
    "excerpt": "Persona may be one of Japan’s most recognizable RPG franchises, but the series now sells substantially more copies in North America than it does at home. New figures shared by Sega Sammy as part of Persona’s 30th anniversary reveal that approximately 40% of…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Sony Patent Lets You Buy Games by Tapping Your Credit Card on the Controller",
    "link": "https://news.sankakucomplex.com/n/09gkDNNO_rX-ILhRjYC8qQ",
    "publishedAt": "2026-09-30T00:40:39.000Z",
    "excerpt": "Sony is exploring a PlayStation controller that could double as a contactless payment device, allowing players to purchase games or in-game content simply by tapping a credit card or smartphone against it. A Sony Interactive Entertainment patent application…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Atelier Ryza AI Chat App Adding Input Restrictions After Users Made Her Say Lewd Things",
    "link": "https://news.sankakucomplex.com/n/Oh-uiqEqkhIbpZ1bTo-pFA",
    "publishedAt": "2026-09-29T21:03:35.000Z",
    "excerpt": "The developers behind the official Atelier Ryza AI chat app are tightening its restrictions after some users attempted to manipulate Ryza into making inappropriate statements. SpiralAI announced on September 29 that RyzaChat, its licensed AI RPG based on Ko…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Asian Games Apologizes After Venue Wrongly Bans Japan’s Rising Sun Flag",
    "link": "https://news.sankakucomplex.com/n/yRBsH1aikLjLZ1qDKbP1zg",
    "publishedAt": "2026-09-29T11:00:33.000Z",
    "excerpt": "Organizers of the 2026 Asian Games in Aichi-Nagoya have apologized after a baseball venue incorrectly told spectators that Japan’s Rising Sun flag was prohibited from being brought inside. The controversy occurred during the Chinese Taipei vs. Japan basebal…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Chilean Men Accused of $1.3 Million Theft Say They Heard Japan Has “Lenient Punishments”",
    "link": "https://news.sankakucomplex.com/n/IQfB7dnwFyScjgzn76r-zg",
    "publishedAt": "2026-09-29T07:00:27.000Z",
    "excerpt": "Two Chilean men already arrested over the theft of approximately 200 million yen ($1.3 million) worth of luxury watches from Tokyo’s Nakano Broadway have been arrested again over a separate burglary – and police say the suspects admitted targeting Japan bec…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Comedy Manga About an Elf Teacher Who Can’t Use Normal Toilets Is Getting an Anime",
    "link": "https://news.sankakucomplex.com/n/LVYsG49oUZWoZyFEzYFS9g",
    "publishedAt": "2026-09-29T03:00:33.000Z",
    "excerpt": "Chizuna Nakajima’s Where Is the Elf Teacher’s Toilet? (Elf-sensei no Toire wa Doko desu ka?) has received the green light for an anime adaptation, with a commemorative illustration and comments from Nakajima released alongside the announcement. The series f…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "WoW Producer’s Old Offensive Posts Resurface After Telling Players to “Be Better Humans”",
    "link": "https://news.sankakucomplex.com/n/X5Xxk_ux_f5IdDmJ4VJA_w",
    "publishedAt": "2026-09-28T23:00:33.000Z",
    "excerpt": "World of Warcraft senior game producer Tom Ellis has deleted his Twitter account after old offensive posts attributed to him resurfaced online, just days after he told players punished for inappropriate character names to “be a better human next time.” The…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "NieR: Automata Director Made Whatever He Wanted & Tried to Hide From Square Enix",
    "link": "https://news.sankakucomplex.com/n/J1Pgv0MKuYQ7X5IcvHiuLQ",
    "publishedAt": "2026-09-28T19:00:27.000Z",
    "excerpt": "NieR: Automata became one of Square Enix’s biggest RPG success stories, but getting it made apparently required its developers to fight against expectations from inside the company – while director Yoko Taro tried his best to stay out of Square Enix’s way.…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Japanese Manga Titles Have Doubled in Length Over the Last Few Decades",
    "link": "https://news.sankakucomplex.com/n/XFLXZ4KOlh7WyGT5sxrzlQ",
    "publishedAt": "2026-09-28T16:35:08.000Z",
    "excerpt": "An analysis of nearly 140,000 Japanese manga series found that the average title has more than doubled in length compared to the 1960s, with a particularly dramatic increase beginning in the 2010s. The study analyzed 138,438 Japanese manga titles using data…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "CODE GEASS Star Chaser Aspal Combining Fantasy & Mecha",
    "link": "https://news.sankakucomplex.com/n/ONVcQKXEp7JX9azTVCY0jg",
    "publishedAt": "2026-09-28T13:00:07.000Z",
    "excerpt": "Code Geass is officially returning with a completely new anime in 2027, and its first teaser suggests the franchise may be heading somewhere very different from Lelouch’s familiar world. Titled Code Geass: Star Chaser Aspal (Code Geass: Hoshi Oi no Aspal),…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Ado’s Agency Threatens Legal Action as Harassment Surges Following K-Pop Festival Appearance",
    "link": "https://news.sankakucomplex.com/n/oM1tL9g0aO_iOytQkcI1fg",
    "publishedAt": "2026-09-28T09:00:59.000Z",
    "excerpt": "Ado’s management company Cloud Nine is warning that it will take legal action against online harassment and misinformation as the singer faces a wave of backlash following her appearance at the K-pop festival INKIGAYO LIVE in TOKYO. The controversy followed…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Nintendo Wins $4.5 Million From Former SwitchPirates Reddit Moderator",
    "link": "https://news.sankakucomplex.com/n/finpJP4Sxy8YtVRLfiUnyA",
    "publishedAt": "2026-09-28T05:00:37.000Z",
    "excerpt": "Nintendo has won $4.5 million in damages against a former moderator of Reddit’s r/SwitchPirates community who was accused of helping distribute hundreds or potentially thousands of pirated Nintendo Switch games. The U.S. District Court for the Western Distr…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Madoka Magica’s First New Movie in 13 Years Already Broken Series’ Box Office Record",
    "link": "https://news.sankakucomplex.com/n/ZUkzpPCZl1-v4nE3-T-1jQ",
    "publishedAt": "2026-09-28T01:00:48.000Z",
    "excerpt": "It took less than a month for Puella Magi Madoka Magica’s long-awaited return to theaters to set a new record for the franchise. Puella Magi Madoka Magica the Movie: Walpurgisnacht Rising has surpassed 2.1 billion yen at the Japanese box office, overtaking…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Sekiro Anime Producers Apologize for Movie Actually Being Edited TV Series",
    "link": "https://news.sankakucomplex.com/n/--DQt8vtIQDrBb9g-4PSvQ",
    "publishedAt": "2026-09-27T21:00:49.000Z",
    "excerpt": "The producers behind SEKIRO: NO DEFEAT have issued an unusual apology after revealing that the anime currently playing in Japanese theaters was actually an edited version of an eight-episode TV series – something audiences weren’t told before buying tickets…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "JoJo Fans Demand Steel Ball Run Ending Theme Be Changed Over Dr. Luke Credit",
    "link": "https://news.sankakucomplex.com/n/xcckR1cKUXGKe43Ox5u0CQ",
    "publishedAt": "2026-09-27T18:04:44.000Z",
    "excerpt": "JoJo’s Bizarre Adventure: Steel Ball Run has barely returned with weekly episodes, and Netflix is already facing another round of backlash – this time over the anime’s new ending theme and the controversial producer credited behind it. The ending theme, “Sh…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Azur Lane’s Bismarck Becomes Quite Enchanting for New Figurine",
    "link": "https://news.sankakucomplex.com/n/KIwFZLA3zS_XEzb7hkQbCA",
    "publishedAt": "2026-09-27T14:00:28.000Z",
    "excerpt": "Based on special anniversary artwork, this figurine depicts the cute Bismarck in quite the stellar dress, giving off an aura of sophistication that will leave any male speechless – and the small degree of sex appeal here and there will certainly help as wel…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Dressmaking Game Becomes Surprise Steam Hit, Overtaking Diablo 4",
    "link": "https://news.sankakucomplex.com/n/INRvfPjqIGDGPDqd2Zic4A",
    "publishedAt": "2026-09-27T10:00:15.000Z",
    "excerpt": "An indie game about sewing dresses has unexpectedly become one of Steam’s biggest new releases, briefly climbing above major games including Diablo 4 on the platform’s global best-sellers chart. Dressmaker, developed by South African indie studio Cozy Lives…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "AI-Generated Manga Nears Top of Jump Rookie Rankings",
    "link": "https://news.sankakucomplex.com/n/mAGn-Rfn8NoJfKVs6nwowg",
    "publishedAt": "2026-09-27T06:00:20.000Z",
    "excerpt": "An apparently AI-generated manga has climbed near the top of Shueisha’s Jump Rookie! rankings, triggering a wave of criticism from Japanese readers who say its success highlights an increasingly uncomfortable question: should AI-generated manga compete dire…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Uzbekistan National Arrested in Japan for Sexually Assaulting Elementary School Girl",
    "link": "https://news.sankakucomplex.com/n/oPDTDfajhpfklQfcPE2cTw",
    "publishedAt": "2026-09-27T02:00:10.000Z",
    "excerpt": "A food delivery driver in Tokyo has been arrested after allegedly hugging, kissing and touching an elementary school girl who answered the door to receive an order while home alone. Tokyo Metropolitan Police arrested 45-year-old Dilshod Komiljonovich Mumino…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Japanese Farmer Faces 9 Years in Prison After Burning Down Illegally Built Mosque",
    "link": "https://news.sankakucomplex.com/n/FKNLJYC2Z2ycCd4gBgTlPQ",
    "publishedAt": "2026-09-26T22:00:29.000Z",
    "excerpt": "Japanese prosecutors are seeking nine years in prison for a 37-year-old farmer who admitted setting fire to a mosque in Hokkaido – a building that had itself previously been declared illegally constructed by local authorities. Ryotaro Ishii, a farmer from C…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Senran Kagura Creator Recalls Developers Looking Down on Sexy Anime Games",
    "link": "https://news.sankakucomplex.com/n/-Sazgt2ezIb3Xvi8OhVH0g",
    "publishedAt": "2026-09-26T18:00:48.000Z",
    "excerpt": "Senran Kagura creator Kenichiro Takaki has looked back on a time when games built around attractive anime girls and sexual fanservice weren’t always taken seriously within the Japanese game industry. Takaki shared the memory as Senran Kagura celebrated its…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Naruto Director Refused Requests to Tone Down the Anime for International Viewers",
    "link": "https://news.sankakucomplex.com/n/lfEUx4FeOXAJPR0okxAzAQ",
    "publishedAt": "2026-09-26T16:19:55.000Z",
    "excerpt": "Naruto director Hayato Date says he deliberately refused to change the anime to better suit overseas tastes, even when he was pressured to make the series more marketable outside Japan. Date discussed the subject during a panel at Anime India Mumbai 2026, h…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  },
  {
    "title": "Silent Hill Already Getting Another Screen Adaptation Courtesy of Resident Evil Producer",
    "link": "https://news.sankakucomplex.com/n/7MDkQMWz4SNOCE872n765Q",
    "publishedAt": "2026-09-26T07:00:39.000Z",
    "excerpt": "Silent Hill is apparently heading back to the screen yet again, with Resident Evil producer Roy Lee now attached to a new adaptation of Konami’s horror series — just months after Return to Silent Hill arrived in theaters. Lee’s involvement was revealed thro…",
    "image": "",
    "source": {
      "id": "sankaku",
      "name": "Sankaku Complex",
      "short": "Sankaku",
      "siteUrl": "https://news.sankakucomplex.com/",
      "category": "Anime & Culture",
      "accent": "#a78bfa"
    }
  }
];


async function loadSankakuCache(debug) {
  const url = `${DEPLOYED_ARTICLES_URL}?cachebust=${Date.now()}`;

  try {
    const result = await fetchUrl(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "cache-control": "no-cache",
        pragma: "no-cache"
      },
      timeout: 15000
    });

    debug.cache = {
      url: DEPLOYED_ARTICLES_URL,
      status: result.status,
      finalUrl: result.finalUrl,
      contentType: result.contentType,
      bytes: result.body.length
    };

    if (result.status < 200 || result.status >= 300) {
      return [];
    }

    const payload = JSON.parse(result.body);

    const cached = (payload.articles || [])
      .filter(item => item?.source?.id === "sankaku")
      .filter(item => realSankakuUrl(item.link));

    if (cached.length) {
      debug.cache.source = "deployed-site";
      return cached;
    }

    debug.cache.source = "bootstrap";
    return BOOTSTRAP_SANKAKU_CACHE;
  } catch (error) {
    debug.cache = {
      url: DEPLOYED_ARTICLES_URL,
      error: String(error?.message || error)
    };

    debug.cache.source = "bootstrap";
    return BOOTSTRAP_SANKAKU_CACHE;
  }
}

function mergeSankakuCache(liveItems, cachedItems) {
  if (!cachedItems.length) return liveItems;

  const cacheByLink = new Map(
    cachedItems.map(item => [
      item.link.replace(/\/+$/, "").toLowerCase(),
      item
    ])
  );

  return liveItems.map(item => {
    const cached = cacheByLink.get(
      item.link.replace(/\/+$/, "").toLowerCase()
    );

    if (!cached) return item;

    return {
      ...item,
      image: item.image || cached.image || "",
      excerpt: item.excerpt || cached.excerpt || "",
      publishedAt: item.publishedAt || cached.publishedAt || null
    };
  });
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
        const recentMarkdown =
          await fetchSankakuRecentPosts(
            diagnostics.jina
          );

        const imageResult = recentMarkdown
          ? await enrichSankakuImagesFromRecentPage(
              items,
              recentMarkdown,
              diagnostics.jina
            )
          : {
              items,
              attempted: items.filter(
                item => !item.image
              ).length,
              resolved: 0
            };

        const articleImageResult =
          imageResult.items.some(item => !item.image)
            ? await enrichSankakuImagesFromArticlePages(
                imageResult.items,
                diagnostics.jina
              )
            : { items: imageResult.items, attempted: 0, resolved: 0 };

        const cachedItems =
          articleImageResult.items.some(item => !item.image)
            ? await loadSankakuCache(diagnostics)
            : [];

        const mergedItems = mergeSankakuCache(
          articleImageResult.items,
          cachedItems
        );

        const cacheImageResolved = mergedItems.reduce(
          (count, item, index) =>
            count +
            (!articleImageResult.items[index].image && item.image ? 1 : 0),
          0
        );

        diagnostics.selectedMode = "official-rss";
        diagnostics.selectedCount = mergedItems.length;
        diagnostics.imageEnrichment = {
          recentPageAttempted: imageResult.attempted,
          recentPageResolved: imageResult.resolved,
          articlePageAttempted: articleImageResult.attempted,
          articlePageResolved: articleImageResult.resolved,
          cacheImageResolved
        };

        return {
          items: mergedItems,
          diagnostics
        };
      }
    } catch (error) {
      diagnostics.official.push({
        url: feedUrl,
        error: String(error?.message || error)
      });
    }
  }

  const recentUrl =
    "https://r.jina.ai/http://news.sankakucomplex.com/recent-posts/";

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
      cacheBypass: true,
      targetQueryRemoved: true
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
        const imageResult =
          await enrichSankakuImagesFromRecentPage(
            accepted,
            page.body,
            diagnostics.jina
          );

        const articleImageResult =
          imageResult.items.some(item => !item.image)
            ? await enrichSankakuImagesFromArticlePages(
                imageResult.items,
                diagnostics.jina
              )
            : { items: imageResult.items, attempted: 0, resolved: 0 };

        diagnostics.jina.mode =
          "jina-reader-recent-posts+direct-article-pages";
        diagnostics.selectedMode =
          "jina-reader-recent-posts+direct-article-pages";
        diagnostics.selectedCount =
          articleImageResult.items.length;

        return {
          items: articleImageResult.items,
          diagnostics
        };
      }
    }
  } catch (error) {
    diagnostics.jina.error =
      String(error?.message || error);
  }

  const cachedItems = await loadSankakuCache(diagnostics);

  if (cachedItems.length) {
    diagnostics.jina.mode = "cached-last-success";
    diagnostics.selectedMode = "cached-last-success";
    diagnostics.selectedCount = cachedItems.length;
    diagnostics.cacheItemCount = cachedItems.length;

    return {
      items: cachedItems,
      diagnostics
    };
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

    const annFeedUrls =
      source.id === "ann"
        ? [
            ...source.feedUrls,
            "https://www.animenewsnetwork.com/news/rss.xml/",
            "https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us"
          ]
        : source.feedUrls;

    let feedResult = null;
    let lastFeedError = null;

    for (const feedUrl of annFeedUrls) {
      try {
        feedResult = await parseFeed(feedUrl);
        break;
      } catch (error) {
        lastFeedError = String(error?.message || error);
      }
    }

    if (!feedResult) {
      throw new Error(lastFeedError || "No usable feed");
    }

    const { result, feed } = feedResult;

    let items = (feed.items || [])
      .map(item => normalize(item, source))
      .filter(Boolean);

    if (
      source.id === "ann" &&
      /\/all\/rss\.xml/i.test(result.finalUrl)
    ) {
      items = items.filter(item => /\/news\//i.test(item.link));
    }

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
      feedUrl: result.finalUrl,
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
