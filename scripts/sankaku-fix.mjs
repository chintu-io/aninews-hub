import fs from "node:fs/promises";
import crypto from "node:crypto";
import Parser from "rss-parser";

const OUT = new URL(
  "../site/data/articles.json",
  import.meta.url
);

const DEBUG_OUT = new URL(
  "../site/debug/sankaku.json",
  import.meta.url
);

const SOURCE = {
  id: "sankaku",
  name: "Sankaku Complex",
  short: "Sankaku",
  siteUrl: "https://news.sankakucomplex.com/",
  category: "Anime & Culture",
  accent: "#a78bfa"
};

/*
 * THE ACTUAL SANkAKU RSS FEED.
 *
 * We keep this as the authoritative source.
 */
const OFFICIAL_FEED =
  "https://news.sankakucomplex.com/feed";

/*
 * Transport methods used when GitHub Actions'
 * direct request to Sankaku is rejected.
 *
 * None of these are caches of our own data.
 * They simply retrieve the official RSS feed.
 */
const TRANSPORTS = [
  {
    name: "direct",

    url:
      OFFICIAL_FEED
  },

  {
    name: "allorigins",

    url:
      "https://api.allorigins.win/raw?url=" +
      encodeURIComponent(
        OFFICIAL_FEED
      )
  },

  {
    name: "corsproxy",

    url:
      "https://corsproxy.io/?url=" +
      encodeURIComponent(
        OFFICIAL_FEED
      )
  },

  {
    name: "codetabs",

    url:
      "https://api.codetabs.com/v1/proxy?quest=" +
      encodeURIComponent(
        OFFICIAL_FEED
      )
  },

  {
    name: "rsshub",

    url:
      "https://rsshub.app/sankakucomplex/post"
  },

  {
    name: "rsshub-rss",

    url:
      "https://rsshub.app/sankakucomplex/post.rss"
  }
];

const parser =
  new Parser({
    timeout: 30000,

    customFields: {
      item: [
        [
          "content:encoded",
          "contentEncoded",
          {
            keepArray: false
          }
        ],

        [
          "media:content",
          "mediaContent",
          {
            keepArray: true
          }
        ],

        [
          "media:thumbnail",
          "mediaThumbnail",
          {
            keepArray: true
          }
        ]
      ]
    }
  });

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) " +
  "AppleWebKit/537.36 " +
  "(KHTML, like Gecko) " +
  "Chrome/154.0.0.0 Safari/537.36";

const hash = value =>
  crypto
    .createHash("sha1")
    .update(
      String(value)
    )
    .digest("hex")
    .slice(0, 16);

function stripHtml(
  value = ""
) {
  return String(value)
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&#8217;/gi,
      "’"
    )
    .replace(
      /&#8220;/gi,
      "“"
    )
    .replace(
      /&#8221;/gi,
      "”"
    )
    .replace(
      /&#8230;/gi,
      "…"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function makeExcerpt(
  value = ""
) {
  const text =
    stripHtml(
      value
    );

  if (!text) {
    return "";
  }

  return text.length <= 300
    ? text
    : text
        .slice(
          0,
          297
        )
        .trimEnd() + "…";
}

function normalizeLink(
  value = ""
) {
  try {
    const url =
      new URL(
        value
      );

    url.search = "";
    url.hash = "";

    if (
      url.hostname.toLowerCase() ===
      "www.sankakucomplex.com"
    ) {
      url.hostname =
        "news.sankakucomplex.com";
    }

    return url.href;
  } catch {
    return "";
  }
}

function isSankakuArticle(
  value = ""
) {
  try {
    const url =
      new URL(
        value
      );

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

function parseDate(
  value
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(
      value
    );

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date.toISOString();
}

function normalizeItem(
  item
) {
  const link =
    normalizeLink(
      item.link ||
      item.guid ||
      ""
    );

  if (
    !isSankakuArticle(
      link
    )
  ) {
    return null;
  }

  const title =
    stripHtml(
      item.title ||
      ""
    ).trim();

  if (!title) {
    return null;
  }

  const description =
    item.contentSnippet ||
    item.contentEncoded ||
    item.content ||
    item.summary ||
    item.description ||
    "";

  return {
    id:
      hash(
        "sankaku|" +
        link
      ),

    title,

    link,

    publishedAt:
      parseDate(
        item.isoDate
      ) ||
      parseDate(
        item.pubDate
      ) ||
      parseDate(
        item.published
      ) ||
      parseDate(
        item.updated
      ),

    /*
     * Images intentionally disabled.
     *
     * First priority is getting the
     * current feed working again.
     */
    image:
      "",

    excerpt:
      makeExcerpt(
        description
      ),

    source: {
      ...SOURCE
    }
  };
}

async function fetchUrl(
  url
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "user-agent":
            USER_AGENT,

          accept:
            "application/rss+xml, application/xml, text/xml, application/json, */*",

          "cache-control":
            "no-cache",

          pragma:
            "no-cache"
        },

        redirect:
          "follow",

        signal:
          AbortSignal.timeout(
            35000
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

async function parseCandidate(
  candidate
) {
  const result =
    await fetchUrl(
      candidate.url
    );

  const diagnostic = {
    name:
      candidate.name,

    url:
      candidate.url,

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

    newest:
      null
  };

  if (
    result.status <
      200 ||
    result.status >=
      300
  ) {
    return {
      articles: [],

      diagnostic
    };
  }

  if (
    !result.body.trim()
  ) {
    return {
      articles: [],

      diagnostic: {
        ...diagnostic,

        error:
          "Empty response"
      }
    };
  }

  let feed;

  try {
    feed =
      await parser.parseString(
        result.body
      );
  } catch (
    error
  ) {
    return {
      articles: [],

      diagnostic: {
        ...diagnostic,

        error:
          `RSS parse error: ${
            error?.message ||
            error
          }`
      }
    };
  }

  const articles =
    (feed.items || [])
      .map(
        normalizeItem
      )
      .filter(
        Boolean
      )
      .sort(
        (a, b) => {
          const left =
            a.publishedAt
              ? Date.parse(
                  a.publishedAt
                )
              : 0;

          const right =
            b.publishedAt
              ? Date.parse(
                  b.publishedAt
                )
              : 0;

          return (
            right -
            left
          );
        }
      )
      .slice(
        0,
        50
      );

  diagnostic.count =
    articles.length;

  if (
    articles.length
  ) {
    const dates =
      articles
        .map(
          item =>
            item.publishedAt
              ? Date.parse(
                  item.publishedAt
                )
              : NaN
        )
        .filter(
          Number.isFinite
        );

    if (
      dates.length
    ) {
      diagnostic.newest =
        new Date(
          Math.max(
            ...dates
          )
        ).toISOString();
    }
  }

  return {
    articles,

    diagnostic
  };
}

const debug = {
  generatedAt:
    new Date().toISOString(),

  transportAttempts:
    [],

  selected:
    null,

  count:
    0,

  newest:
    null,

  oldest:
    null,

  images:
    "disabled"
};

const payload =
  JSON.parse(
    await fs.readFile(
      OUT,
      "utf8"
    )
  );

/*
 * Keep every non-Sankaku source
 * already generated by fetch-feeds.mjs.
 */
const nonSankaku =
  (
    payload.articles ||
    []
  ).filter(
    article =>
      article?.source?.id !==
      "sankaku"
  );

let selected =
  null;

/*
 * Try all transports.
 */
for (
  const candidate of
    TRANSPORTS
) {
  try {
    console.log(
      `Trying Sankaku transport: ${candidate.name}`
    );

    const result =
      await parseCandidate(
        candidate
      );

    debug.transportAttempts.push(
      result.diagnostic
    );

    if (
      !result.articles.length
    ) {
      continue;
    }

    const newest =
      result.articles
        .map(
          article =>
            article.publishedAt
              ? Date.parse(
                  article.publishedAt
                )
              : 0
        )
        .reduce(
          (
            max,
            value
          ) =>
            Math.max(
              max,
              value
            ),
          0
        );

    /*
     * Prefer the feed with the
     * newest article.
     */
    if (
      !selected ||
      newest >
        selected.newest
    ) {
      selected = {
        name:
          candidate.name,

        url:
          candidate.url,

        articles:
          result.articles,

        newest
      };
    }

    /*
     * Direct/official transport is
     * authoritative. Once it works,
     * don't replace it with a proxy.
     */
    if (
      candidate.name ===
        "direct" &&
      result.articles.length
    ) {
      break;
    }

    /*
     * allorigins/corsproxy/codetabs
     * are still retrieving the official
     * Sankaku feed, so prefer them over
     * RSSHub when they contain data.
     */
    if (
      [
        "allorigins",
        "corsproxy",
        "codetabs"
      ].includes(
        candidate.name
      )
    ) {
      break;
    }

  } catch (
    error
  ) {
    debug.transportAttempts.push({
      name:
        candidate.name,

      url:
        candidate.url,

      error:
        String(
          error?.message ||
            error
        )
    });
  }
}

/*
 * Fresh Sankaku data found.
 */
if (
  selected &&
  selected.articles.length
) {
  const sankaku =
    selected.articles
      .sort(
        (a, b) => {
          const left =
            a.publishedAt
              ? Date.parse(
                  a.publishedAt
                )
              : 0;

          const right =
            b.publishedAt
              ? Date.parse(
                  b.publishedAt
                )
              : 0;

          return (
            right -
            left
          );
        }
      )
      .slice(
        0,
        50
      );

  payload.articles =
    [
      ...nonSankaku,
      ...sankaku
    ]
      .sort(
        (a, b) => {
          const left =
            a.publishedAt
              ? Date.parse(
                  a.publishedAt
                )
              : 0;

          const right =
            b.publishedAt
              ? Date.parse(
                  b.publishedAt
                )
              : 0;

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

  debug.selected = {
    name:
      selected.name,

    url:
      selected.url,

    count:
      sankaku.length
  };

  debug.count =
    sankaku.length;

  const dates =
    sankaku
      .map(
        item =>
          item.publishedAt
            ? Date.parse(
                item.publishedAt
              )
            : NaN
      )
      .filter(
        Number.isFinite
      );

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
   * Update source status so the
   * frontend shows Sankaku correctly.
   */
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

    sourceResult.count =
      sankaku.length;

    sourceResult.feedUrl =
      selected.url;

    sourceResult.mode =
      selected.name ===
      "rsshub"
        ? "rsshub"
        : selected.name.startsWith(
            "rsshub"
          )
        ? "rsshub"
        : "rss";
  }

  console.log(
    `Sankaku RSS: ${sankaku.length} stories via ${selected.name}`
  );

} else {
  /*
   * NO CACHE.
   *
   * If every transport fails,
   * Sankaku remains empty.
   */
  payload.articles =
    nonSankaku;

  debug.selected =
    null;

  debug.count =
    0;

  debug.note =
    "All Sankaku RSS transports failed. No cache or Recent Posts data was used.";

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
      "empty";

    sourceResult.count =
      0;

    sourceResult.feedUrl =
      null;

    sourceResult.mode =
      null;
  }

  console.log(
    "Sankaku RSS: no usable transport"
  );
}

payload.generatedAt =
  new Date().toISOString();

payload.stats =
  payload.stats ||
  {};

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
    {
      generatedAt:
        new Date().toISOString(),

      sankaku:
        debug
    },
    null,
    2
  )
);

console.log(
  "Sankaku diagnostic:",
  JSON.stringify(
    debug,
    null,
    2
  )
);
