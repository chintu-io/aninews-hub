import fs from "node:fs/promises";
import crypto from "node:crypto";
import Parser from "rss-parser";

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

/*
 * Priority:
 *
 * 1. Official Sankaku RSS
 * 2. RSSHub's Sankaku RSS route
 *
 * We do NOT scrape Recent Posts.
 * We do NOT use bootstrap/cache data.
 */
const FEEDS = [
  "https://news.sankakucomplex.com/feed/",
  "https://news.sankakucomplex.com/?feed=rss2",
  "https://www.sankakucomplex.com/feed/",
  "https://rsshub.app/sankakucomplex/post?limit=50&sorted=true",
  "https://rsshub.app/sankakucomplex/post.rss?limit=50&sorted=true"
];

const parser = new Parser({
  timeout: 30000,

  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["content:encoded", "contentEncoded", { keepArray: false }]
    ]
  }
});

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const hash = value =>
  crypto
    .createHash("sha1")
    .update(String(value))
    .digest("hex")
    .slice(0, 16);

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

  if (!text) {
    return "";
  }

  return text.length <= 300
    ? text
    : text.slice(0, 297).trimEnd() + "…";
}

function cleanTitle(value = "") {
  const title = stripHtml(value)
    .replace(/^#+\s*/, "")
    .trim();

  if (!title) {
    return "";
  }

  if (
    /^(?:add\s+comment|\d+\s+comments?)$/i.test(title)
  ) {
    return "";
  }

  if (/^just a moment/i.test(title)) {
    return "";
  }

  return title;
}

function realSankakuUrl(value) {
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

function iso(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

function urlOf(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (typeof value.url === "string") {
      return value.url;
    }

    if (typeof value.href === "string") {
      return value.href;
    }

    for (
      const key of [
        "$",
        "attrs",
        "attribute",
        "content"
      ]
    ) {
      const nested = urlOf(value[key]);

      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

function absoluteUrl(
  value,
  base = "https://news.sankakucomplex.com/"
) {
  try {
    return new URL(
      String(value || "").trim(),
      base
    ).href;
  } catch {
    return "";
  }
}

function imageFromText(value = "") {
  const text = String(value || "");

  const markdown =
    /!\[[^\]]*\]\(<?([^)>\s]+)>?\)/i.exec(
      text
    )?.[1] || "";

  const markdownUrl =
    absoluteUrl(markdown);

  if (
    /^https?:\/\//i.test(
      markdownUrl
    )
  ) {
    return markdownUrl;
  }

  for (
    const tag of
      text.match(
        /<img\b[^>]*>/gi
      ) || []
  ) {
    for (
      const attr of [
        "src",
        "data-src",
        "data-lazy-src",
        "data-original"
      ]
    ) {
      const raw =
        new RegExp(
          attr +
            "\\s*=\\s*[\"']([^\"']+)[\"']",
          "i"
        ).exec(tag)?.[1] || "";

      const resolved =
        absoluteUrl(raw);

      if (
        /^https?:\/\//i.test(
          resolved
        )
      ) {
        return resolved;
      }
    }

    const srcset =
      /(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/i
        .exec(tag)?.[1] || "";

    if (srcset) {
      const first =
        srcset
          .split(",")[0]
          ?.trim()
          .split(/\s+/)[0] || "";

      const resolved =
        absoluteUrl(first);

      if (
        /^https?:\/\//i.test(
          resolved
        )
      ) {
        return resolved;
      }
    }
  }

  const generic =
    /(?:https?:\/\/|\/)[^\s"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/i
      .exec(text)?.[0] || "";

  const resolved =
    absoluteUrl(generic);

  return /^https?:\/\//i.test(
    resolved
  )
    ? resolved
    : "";
}

function itemImage(item) {
  const candidates = [
    item.enclosure?.url,
    item.enclosure?.href,

    ...(
      Array.isArray(
        item.mediaContent
      )
        ? item.mediaContent
        : item.mediaContent
          ? [item.mediaContent]
          : []
    ).map(urlOf),

    ...(
      Array.isArray(
        item.mediaThumbnail
      )
        ? item.mediaThumbnail
        : item.mediaThumbnail
          ? [item.mediaThumbnail]
          : []
    ).map(urlOf),

    imageFromText(
      item.contentEncoded
    ),

    imageFromText(
      item.content
    ),

    imageFromText(
      item.description
    ),

    imageFromText(
      item.summary
    )
  ];

  return (
    candidates.find(
      value =>
        /^https?:\/\//i.test(
          value || ""
        )
    ) || ""
  );
}

function itemDescription(item) {
  for (
    const value of [
      item.contentSnippet,
      item.contentEncoded,
      item.content,
      item.summary,
      item.description
    ]
  ) {
    const result =
      excerpt(
        value || ""
      );

    if (result) {
      return result;
    }
  }

  return "";
}

function normalize(item) {
  const link =
    item.link ||
    item.guid ||
    "";

  if (
    !realSankakuUrl(
      link
    )
  ) {
    return null;
  }

  const title =
    cleanTitle(
      item.title || ""
    );

  if (!title) {
    return null;
  }

  return {
    id: hash(
      "sankaku|" + link
    ),

    /*
     * IMPORTANT:
     * These fields are taken directly from RSS.
     */
    title,

    link,

    publishedAt:
      iso(item.isoDate) ||
      iso(item.pubDate) ||
      iso(item.published) ||
      iso(item.updated),

    excerpt:
      itemDescription(
        item
      ),

    image:
      itemImage(
        item
      ),

    source: {
      ...SOURCE
    }
  };
}

async function fetchText(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",

          accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, text/plain, */*",

          ...(options.headers || {})
        },

        redirect:
          "follow",

        signal:
          AbortSignal.timeout(
            options.timeout ||
              30000
          )
      }
    );

  return {
    status:
      response.status,

    finalUrl:
      response.url,

    contentType:
      response.headers.get(
        "content-type"
      ) || "",

    body:
      await response.text()
  };
}

function metaContent(
  html,
  key
) {
  for (
    const tag of
      String(html).match(
        /<meta\b[^>]*>/gi
      ) || []
  ) {
    const name =
      /(?:property|name)\s*=\s*["']([^"']+)["']/i
        .exec(tag)?.[1] || "";

    if (
      name.toLowerCase() !==
      key.toLowerCase()
    ) {
      continue;
    }

    return (
      /content\s*=\s*["']([^"']+)["']/i
        .exec(tag)?.[1] || ""
    );
  }

  return "";
}

/*
 * Article pages are ONLY used for missing images.
 *
 * We deliberately do NOT read title/date/description here.
 * Those must remain the RSS values.
 */
async function imageFallback(
  article,
  debug
) {
  if (article.image) {
    return article;
  }

  try {
    const direct =
      await fetchText(
        article.link,
        {
          timeout:
            25000,

          headers: {
            referer:
              SOURCE.siteUrl
          }
        }
      );

    debug.imageAttempts.push({
      link:
        article.link,

      method:
        "direct",

      status:
        direct.status,

      bytes:
        direct.body.length
    });

    if (
      direct.status >=
        200 &&
      direct.status <
        300
    ) {
      const image =
        metaContent(
          direct.body,
          "og:image"
        ) ||
        imageFromText(
          direct.body
        );

      if (image) {
        return {
          ...article,
          image
        };
      }
    }
  } catch (
    error
  ) {
    debug.imageAttempts.push({
      link:
        article.link,

      method:
        "direct",

      error:
        String(
          error?.message ||
            error
        )
    });
  }

  /*
   * Jina fallback for image only.
   */
  try {
    const id =
      article.link.split(
        "/n/"
      )[1] || "";

    const jina =
      "https://r.jina.ai/http://news.sankakucomplex.com/n/" +
      encodeURIComponent(id) +
      "?t=" +
      Date.now();

    const result =
      await fetchText(
        jina,
        {
          timeout:
            40000,

          headers: {
            "x-no-cache":
              "true",

            "x-cache-tolerance":
              "0"
          }
        }
      );

    debug.imageAttempts.push({
      link:
        article.link,

      method:
        "jina",

      status:
        result.status,

      bytes:
        result.body.length
    });

    if (
      result.status >=
        200 &&
      result.status <
        300
    ) {
      const image =
        metaContent(
          result.body,
          "og:image"
        ) ||
        imageFromText(
          result.body
        );

      if (image) {
        return {
          ...article,
          image
        };
      }
    }
  } catch (
    error
  ) {
    debug.imageAttempts.push({
      link:
        article.link,

      method:
        "jina",

      error:
        String(
          error?.message ||
            error
        )
    });
  }

  return article;
}

async function enrichImages(
  items,
  debug
) {
  const queue =
    items
      .filter(
        item =>
          !item.image
      )
      .slice(
        0,
        40
      );

  const results =
    [];

  const worker =
    async () => {
      while (
        queue.length
      ) {
        const item =
          queue.shift();

        if (!item) {
          return;
        }

        results.push(
          await imageFallback(
            item,
            debug
          )
        );

        await sleep(
          100
        );
      }
    };

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            5,
            queue.length ||
              1
          )
      },
      worker
    )
  );

  const byLink =
    new Map(
      results.map(
        item => [
          item.link,
          item
        ]
      )
    );

  return items.map(
    item =>
      byLink.get(
        item.link
      ) || item
  );
}

const debug = {
  generatedAt:
    new Date().toISOString(),

  feedAttempts: [],

  selectedFeed:
    null,

  rssCount:
    0,

  finalCount:
    0,

  newest:
    null,

  oldest:
    null,

  imageAttempts:
    [],

  note:
    "Sankaku title, description, date and link come from RSS. Article pages are used only for missing images. No old Sankaku cache is merged."
};

const payload =
  JSON.parse(
    await fs.readFile(
      OUT,
      "utf8"
    )
  );

/*
 * Remove ALL existing Sankaku entries first.
 * Therefore bootstrap data can never survive a
 * successful refresh.
 */
const existingOther =
  (payload.articles || []).filter(
    item =>
      item?.source?.id !==
      "sankaku"
  );

let selected =
  null;

for (
  const feedUrl of
    FEEDS
) {
  try {
    const result =
      await fetchText(
        feedUrl,
        {
          timeout:
            30000,

          headers: {
            "cache-control":
              "no-cache",

            pragma:
              "no-cache"
          }
        }
      );

    const attempt = {
      url:
        feedUrl,

      status:
        result.status,

      finalUrl:
        result.finalUrl,

      contentType:
        result.contentType,

      bytes:
        result.body.length,

      count:
        0,

      latest:
        null
    };

    if (
      result.status <
        200 ||
      result.status >=
        300 ||
      !result.body.trim()
    ) {
      debug.feedAttempts.push(
        attempt
      );

      continue;
    }

    const feed =
      await parser.parseString(
        result.body
      );

    const items =
      (feed.items || [])
        .map(
          normalize
        )
        .filter(Boolean);

    attempt.count =
      items.length;

    const dates =
      items
        .map(
          item =>
            Date.parse(
              item.publishedAt ||
                ""
            )
        )
        .filter(
          Number.isFinite
        );

    if (
      dates.length
    ) {
      attempt.latest =
        new Date(
          Math.max(
            ...dates
          )
        ).toISOString();
    }

    debug.feedAttempts.push(
      attempt
    );

    if (
      !items.length
    ) {
      continue;
    }

    const latest =
      dates.length
        ? Math.max(
            ...dates
          )
        : 0;

    /*
     * Select the feed with the newest article.
     *
     * This means if official RSS is 4 days old
     * and RSSHub has today's articles, RSSHub wins.
     */
    if (
      !selected ||
      latest >
        selected.latest ||
      (
        latest ===
          selected.latest &&
        items.length >
          selected.items.length
      )
    ) {
      selected = {
        url:
          feedUrl,

        latest,

        items
      };
    }
  } catch (
    error
  ) {
    debug.feedAttempts.push({
      url:
        feedUrl,

      error:
        String(
          error?.message ||
            error
        )
    });
  }
}

if (
  selected &&
  selected.items.length
) {
  let sankaku =
    selected.items
      .map(
        item => ({
          ...item,

          source: {
            ...SOURCE
          }
        })
      )
      .sort(
        (a, b) => {
          const left =
            Date.parse(
              a.publishedAt ||
                ""
            ) || 0;

          const right =
            Date.parse(
              b.publishedAt ||
                ""
            ) || 0;

          return (
            right -
            left
          );
        }
      )
      .slice(
        0,
        60
      );

  /*
   * Only missing images may be enriched.
   */
  sankaku =
    await enrichImages(
      sankaku,
      debug
    );

  const dates =
    sankaku
      .map(
        item =>
          Date.parse(
            item.publishedAt ||
              ""
          )
      )
      .filter(
        Number.isFinite
      );

  debug.selectedFeed =
    selected.url;

  debug.rssCount =
    selected.items.length;

  debug.finalCount =
    sankaku.length;

  if (
    dates.length
  ) {
    debug.newest =
      new Date(
        Math.max(
          ...dates
        )
      ).toISOString();

    debug.oldest =
      new Date(
        Math.min(
          ...dates
        )
      ).toISOString();
  }

  /*
   * Complete replacement.
   *
   * NOTHING from old Sankaku data is merged.
   */
  payload.articles =
    [
      ...existingOther,
      ...sankaku
    ]
      .sort(
        (a, b) => {
          const left =
            Date.parse(
              a.publishedAt ||
                ""
            ) || 0;

          const right =
            Date.parse(
              b.publishedAt ||
                ""
            ) || 0;

          return (
            right -
            left
          );
        }
      )
      .slice(
        0,
        500
      );

  const sourceResult =
    (
      payload.sourceResults ||
      []
    ).find(
      item =>
        item.id ===
        "sankaku"
    );

  if (
    sourceResult
  ) {
    sourceResult.status =
      "ok";

    sourceResult.mode =
      "rss";

    sourceResult.count =
      sankaku.length;

    sourceResult.feedUrl =
      selected.url;
  }
} else {
  /*
   * No feed worked.
   *
   * Do NOT publish the 4-day-old bootstrap.
   * Sankaku simply disappears for this build.
   */
  payload.articles =
    existingOther;

  debug.finalCount =
    0;

  debug.note =
    "All Sankaku RSS endpoints failed. Sankaku was removed from this build instead of publishing stale cached stories.";
}

payload.generatedAt =
  new Date().toISOString();

payload.stats =
  payload.stats || {};

payload.stats.articleCount =
  payload.articles.length;

payload.stats.sourceCount =
  payload.sources?.length ||
  payload.stats.sourceCount ||
  0;

payload.stats.successfulSources =
  (
    payload.sourceResults ||
    []
  ).filter(
    item =>
      item.status ===
      "ok"
  ).length;

payload.stats.failedSources =
  (
    payload.sourceResults ||
    []
  ).filter(
    item =>
      item.status ===
      "error"
  ).length;

await fs.writeFile(
  OUT,
  JSON.stringify(
    payload,
    null,
    2
  )
);

await fs.writeFile(
  DEBUG_OUT,
  JSON.stringify(
    debug,
    null,
    2
  )
);

console.log(
  "Sankaku RSS refresh: " +
  debug.finalCount +
  " stories from " +
  (debug.selectedFeed ||
    "no feed")
);
