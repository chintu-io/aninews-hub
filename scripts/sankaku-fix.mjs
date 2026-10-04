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

const RSS_URLS = [
  "https://news.sankakucomplex.com/feed/",
  "https://news.sankakucomplex.com/?feed=rss2",
  "https://www.sankakucomplex.com/feed/"
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
    : `${text.slice(0, 297).trimEnd()}…`;
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

function isRealSankakuUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.hostname.toLowerCase() ===
        "news.sankakucomplex.com" &&
      /^\/n\/[^/?#]+\/?$/i.test(
        url.pathname
      )
    );
  } catch {
    return false;
  }
}

function toIso(value) {
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
      const nested = urlOf(
        value[key]
      );

      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

function absoluteUrl(
  value,
  baseUrl = "https://news.sankakucomplex.com/"
) {
  try {
    return new URL(
      String(value || "").trim(),
      baseUrl
    ).href;
  } catch {
    return "";
  }
}

function imageFromHtml(
  value = "",
  baseUrl = "https://news.sankakucomplex.com/"
) {
  const text = String(value || "");

  /*
   * Markdown image
   */
  const markdown =
    /!\[[^\]]*\]\(<?([^)\s>]+)>?\)/i.exec(
      text
    )?.[1] || "";

  const markdownUrl =
    absoluteUrl(
      markdown,
      baseUrl
    );

  if (
    /^https?:\/\//i.test(
      markdownUrl
    )
  ) {
    return markdownUrl;
  }

  /*
   * HTML images
   */
  const tags =
    text.match(
      /<img\b[^>]*>/gi
    ) || [];

  for (
    const tag of tags
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
          `${attr}\\s*=\\s*["']([^"']+)["']`,
          "i"
        ).exec(tag)?.[1] || "";

      const resolved =
        absoluteUrl(
          raw,
          baseUrl
        );

      if (
        /^https?:\/\//i.test(
          resolved
        )
      ) {
        return resolved;
      }
    }

    const srcset =
      new RegExp(
        `(?:srcset|data-srcset)\\s*=\\s*["']([^"']+)["']`,
        "i"
      ).exec(tag)?.[1] || "";

    if (srcset) {
      const first =
        srcset
          .split(",")[0]
          ?.trim()
          .split(/\s+/)[0] || "";

      const resolved =
        absoluteUrl(
          first,
          baseUrl
        );

      if (
        /^https?:\/\//i.test(
          resolved
        )
      ) {
        return resolved;
      }
    }
  }

  /*
   * Generic image URL
   */
  const generic =
    /(?:https?:\/\/|\/)[^\s"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/i.exec(
      text
    )?.[0] || "";

  const resolved =
    absoluteUrl(
      generic,
      baseUrl
    );

  return /^https?:\/\//i.test(
    resolved
  )
    ? resolved
    : "";
}

function imageFromRssItem(item) {
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

    imageFromHtml(
      item.contentEncoded
    ),

    imageFromHtml(
      item.content
    ),

    imageFromHtml(
      item.description
    ),

    imageFromHtml(
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

function excerptFromRssItem(item) {
  const candidates = [
    item.contentSnippet,
    item.contentEncoded,
    item.content,
    item.summary,
    item.description
  ];

  for (
    const value of candidates
  ) {
    const result =
      excerpt(value || "");

    if (result) {
      return result;
    }
  }

  return "";
}

function normalizeRssItem(item) {
  const link =
    item.link ||
    item.guid ||
    "";

  if (
    !isRealSankakuUrl(
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

  const publishedAt =
    toIso(item.isoDate) ||
    toIso(item.pubDate) ||
    toIso(item.published) ||
    toIso(item.updated);

  return {
    id: hash(
      `sankaku|${link}`
    ),

    title,

    link,

    publishedAt,

    excerpt:
      excerptFromRssItem(
        item
      ),

    image:
      imageFromRssItem(
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
            "text/html,application/xhtml+xml,text/plain,*/*",

          ...(options.headers || {})
        },

        redirect: "follow",

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

function metaValue(
  html,
  property
) {
  for (
    const tag of
      html.match(
        /<meta\b[^>]*>/gi
      ) || []
  ) {
    const key =
      new RegExp(
        `(?:property|name)\\s*=\\s*["']([^"']+)["']`,
        "i"
      ).exec(tag)?.[1] || "";

    if (
      key.toLowerCase() !==
      property.toLowerCase()
    ) {
      continue;
    }

    return (
      new RegExp(
        `content\\s*=\\s*["']([^"']+)["']`,
        "i"
      ).exec(tag)?.[1] || ""
    );
  }

  return "";
}

function jsonLdArticle(
  html
) {
  const blocks =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) || [];

  const queue = [];

  for (
    const block of blocks
  ) {
    const text =
      block
        .replace(
          /^<script[^>]*>/i,
          ""
        )
        .replace(
          /<\/script>$/i,
          ""
        )
        .trim();

    try {
      queue.push(
        JSON.parse(
          text
        )
      );
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  while (
    queue.length
  ) {
    const value =
      queue.shift();

    if (!value) {
      continue;
    }

    if (
      Array.isArray(
        value
      )
    ) {
      queue.push(
        ...value
      );

      continue;
    }

    if (
      typeof value !==
      "object"
    ) {
      continue;
    }

    const types =
      Array.isArray(
        value["@type"]
      )
        ? value["@type"]
        : [value["@type"]];

    if (
      types.some(
        type =>
          typeof type ===
            "string" &&
          /article|newsarticle|reportage/i.test(
            type
          )
      )
    ) {
      return value;
    }

    if (
      Array.isArray(
        value["@graph"]
      )
    ) {
      queue.push(
        ...value["@graph"]
      );
    }
  }

  return null;
}

function metadataFromHtml(
  html
) {
  const article =
    jsonLdArticle(
      html
    );

  let image = "";

  if (
    typeof article?.image ===
    "string"
  ) {
    image =
      article.image;
  } else if (
    Array.isArray(
      article?.image
    )
  ) {
    image =
      article.image.find(
        value =>
          typeof value ===
          "string"
      ) ||
      article.image.find(
        value =>
          value &&
          typeof value.url ===
            "string"
      )?.url ||
      "";
  } else if (
    article?.image &&
    typeof article.image.url ===
      "string"
  ) {
    image =
      article.image.url;
  }

  image ||=
    metaValue(
      html,
      "og:image"
    );

  const description =
    stripHtml(
      article?.description ||
        metaValue(
          html,
          "og:description"
        ) ||
        ""
    );

  return {
    image:
      /^https?:\/\//i.test(
        image
      )
        ? image
        : "",

    excerpt:
      excerpt(
        description
      )
  };
}

async function enrichMissing(
  articles,
  debug
) {
  const missing =
    articles.filter(
      article =>
        !article.image ||
        !article.excerpt
    );

  if (
    !missing.length
  ) {
    return articles;
  }

  const queue =
    [...missing];

  const results =
    [];

  const worker =
    async () => {
      while (
        queue.length
      ) {
        const article =
          queue.shift();

        if (!article) {
          return;
        }

        let updated =
          {
            ...article
          };

        /*
         * First try the real article URL.
         */
        try {
          const result =
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

          debug.articleAttempts
            .push({
              link:
                article.link,

              status:
                result.status,

              finalUrl:
                result.finalUrl,

              method:
                "direct",

              bytes:
                result.body.length
            });

          if (
            result.status >=
              200 &&
            result.status <
              300
          ) {
            const meta =
              metadataFromHtml(
                result.body
              );

            if (
              !updated.image &&
              meta.image
            ) {
              updated.image =
                meta.image;
            }

            if (
              !updated.excerpt &&
              meta.excerpt
            ) {
              updated.excerpt =
                meta.excerpt;
            }
          }
        } catch (
          error
        ) {
          debug.articleAttempts
            .push({
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
         * If anything is still missing, use Jina.
         *
         * IMPORTANT:
         * We ONLY take image/excerpt from Jina.
         * We NEVER take title or publishedAt.
         */
        if (
          !updated.image ||
          !updated.excerpt
        ) {
          try {
            const articleId =
              article.link
                .split(
                  "/n/"
                )[1] || "";

            const jinaUrl =
              `https://r.jina.ai/http://news.sankakucomplex.com/n/${encodeURIComponent(articleId)}?t=${Date.now()}`;

            const result =
              await fetchText(
                jinaUrl,
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

            debug.articleAttempts
              .push({
                link:
                  article.link,

                status:
                  result.status,

                method:
                  "jina",

                bytes:
                  result.body.length
              });

            if (
              result.status >=
                200 &&
              result.status <
                300
            ) {
              const meta =
                metadataFromHtml(
                  result.body
                );

              if (
                !updated.image &&
                meta.image
              ) {
                updated.image =
                  meta.image;
              }

              if (
                !updated.excerpt &&
                meta.excerpt
              ) {
                updated.excerpt =
                  meta.excerpt;
              }
            }
          } catch (
            error
          ) {
            debug.articleAttempts
              .push({
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
        }

        results.push(
          updated
        );

        await sleep(
          120
        );
      }
    };

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            5,
            queue.length
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

  return articles.map(
    article =>
      byLink.get(
        article.link
      ) || article
  );
}

const debug = {
  generatedAt:
    new Date().toISOString(),

  rss: [],

  selectedFeed:
    null,

  rssCount:
    0,

  finalCount:
    0,

  articleAttempts:
    [],

  note:
    "Title and publishedAt always come from Sankaku RSS. Direct/Jina are only allowed to fill image/excerpt."
};

const payload =
  JSON.parse(
    await fs.readFile(
      OUT,
      "utf8"
    )
  );

let bestFeed =
  null;

for (
  const feedUrl of
    RSS_URLS
) {
  try {
    const result =
      await fetchText(
        feedUrl,
        {
          timeout:
            30000
        }
      );

    const diagnostic = {
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
      debug.rss.push(
        diagnostic
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
          normalizeRssItem
        )
        .filter(Boolean);

    diagnostic.count =
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
      diagnostic.latest =
        new Date(
          Math.max(
            ...dates
          )
        ).toISOString();
    }

    debug.rss.push(
      diagnostic
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

    if (
      !bestFeed ||
      latest >
        bestFeed.latest ||
      (
        latest ===
          bestFeed.latest &&
        items.length >
          bestFeed.items.length
      )
    ) {
      bestFeed = {
        url:
          feedUrl,

        latest,

        items
      };
    }
  } catch (
    error
  ) {
    debug.rss.push({
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
  bestFeed &&
  bestFeed.items.length
) {
  debug.selectedFeed =
    bestFeed.url;

  debug.rssCount =
    bestFeed.items.length;

  /*
   * THIS IS IMPORTANT:
   *
   * Completely replace Sankaku's old data
   * with the currently fetched RSS list.
   *
   * We do NOT merge old Sankaku articles.
   *
   * This guarantees that a 4-day-old/2024 item
   * cannot come back from the previous cache.
   */
  let sankaku =
    bestFeed.items.map(
      item => ({
        ...item,
        source: {
          ...SOURCE
        }
      })
    );

  /*
   * Only enrich missing fields.
   *
   * RSS title and date stay untouched.
   */
  sankaku =
    await enrichMissing(
      sankaku,
      debug
    );

  payload.articles =
    [
      ...payload.articles.filter(
        article =>
          article?.source?.id !==
          "sankaku"
      ),

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

          if (
            right !== left
          ) {
            return (
              right - left
            );
          }

          return String(
            a.title
          ).localeCompare(
            String(
              b.title
            )
          );
        }
      )
      .slice(
        0,
        500
      );

  debug.finalCount =
    sankaku.length;

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
      "official-rss";

    sourceResult.count =
      sankaku.length;

    sourceResult.feedUrl =
      bestFeed.url;
  }
} else {
  /*
   * RSS completely failed.
   *
   * Do NOT reconstruct the feed from Recent Posts.
   * Keep the current existing Sankaku data rather than
   * inventing stale stories.
   */
  debug.finalCount =
    payload.articles.filter(
      article =>
        article?.source?.id ===
        "sankaku"
    ).length;

  debug.note =
    "Sankaku RSS could not be fetched. Existing Sankaku data was preserved. No Recent Posts fallback was used.";
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
  `Sankaku RSS metadata refresh: ${debug.finalCount} stories from ${debug.selectedFeed || "existing data"}`
);
