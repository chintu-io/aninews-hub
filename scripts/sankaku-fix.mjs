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
 * Sankaku sources.
 *
 * Priority:
 *
 * 1. Official RSS
 * 2. RSS2JSON proxy reading the official RSS
 * 3. RSSHub Sankaku RSS
 *
 * NO bootstrap cache.
 * NO old articles.json cache.
 * NO Recent Posts scraping.
 * NO images for now.
 */
const SOURCES = [
  {
    name: "official-rss",
    url: "https://news.sankakucomplex.com/feed/"
  },

  {
    name: "official-rss-2",
    url: "https://news.sankakucomplex.com/?feed=rss2"
  },

  {
    name: "rss2json",
    url:
      "https://api.rss2json.com/v1/api.json?rss_url=" +
      encodeURIComponent(
        "https://news.sankakucomplex.com/feed/"
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

const rssParser =
  new Parser({
    timeout: 30000,

    customFields: {
      item: [
        [
          "media:content",
          "mediaContent",
          { keepArray: true }
        ],

        [
          "media:thumbnail",
          "mediaThumbnail",
          { keepArray: true }
        ],

        [
          "content:encoded",
          "contentEncoded",
          { keepArray: false }
        ]
      ]
    }
  });

const USER_AGENT =
  "AniNewsHub/1.5 (personal RSS reader)";

const hash = value =>
  crypto
    .createHash("sha1")
    .update(String(value))
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
    stripHtml(value);

  if (!text) {
    return "";
  }

  return text.length <= 300
    ? text
    : text
        .slice(0, 297)
        .trimEnd() + "…";
}

function isSankakuArticle(
  value = ""
) {
  try {
    const url =
      new URL(value);

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

function normalizeLink(
  value = ""
) {
  try {
    const url =
      new URL(value);

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

function parseDate(
  value
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date.toISOString();
}

function cleanTitle(
  value = ""
) {
  return stripHtml(
    value
  )
    .replace(
      /^#+\s*/,
      ""
    )
    .trim();
}

function rssItemToArticle(
  item
) {
  const link =
    normalizeLink(
      item.link ||
        item.guid ||
        ""
    );

  /*
   * Only accept real Sankaku
   * article URLs.
   */
  if (
    !isSankakuArticle(
      link
    )
  ) {
    return null;
  }

  const title =
    cleanTitle(
      item.title ||
        ""
    );

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

  const publishedAt =
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
    );

  return {
    id:
      hash(
        `sankaku|${link}`
      ),

    title,

    link,

    publishedAt,

    /*
     * Image intentionally disabled.
     *
     * We will solve thumbnails later.
     */
    image: "",

    excerpt:
      makeExcerpt(
        description
      ),

    source: {
      ...SOURCE
    }
  };
}

async function fetchText(
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
            "application/rss+xml, application/xml, application/json, text/xml, */*"
        },

        redirect:
          "follow",

        signal:
          AbortSignal.timeout(
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

function parseNormalRss(
  body
) {
  return rssParser
    .parseString(
      body
    )
    .then(
      feed =>
        (feed.items || [])
          .map(
            rssItemToArticle
          )
          .filter(
            Boolean
          )
    );
}

function parseRss2Json(
  body
) {
  let json;

  try {
    json =
      JSON.parse(
        body
      );
  } catch {
    return [];
  }

  if (
    json.status &&
    String(
      json.status
    ).toLowerCase() !==
      "ok"
  ) {
    return [];
  }

  const items =
    Array.isArray(
      json.items
    )
      ? json.items
      : [];

  return items
    .map(
      item =>
        rssItemToArticle({
          title:
            item.title,

          link:
            item.link,

          guid:
            item.guid ||
            item.link,

          isoDate:
            item.pubDate,

          pubDate:
            item.pubDate,

          contentSnippet:
            item.description,

          description:
            item.description,

          content:
            item.content,

          contentEncoded:
            item.content
        })
    )
    .filter(
      Boolean
    );
}

async function fetchCandidate(
  candidate
) {
  try {
    const result =
      await fetchText(
        candidate.url
      );

    const debug = {
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

      latest:
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
        debug
      };
    }

    let articles = [];

    /*
     * rss2json response.
     */
    if (
      candidate.name ===
      "rss2json"
    ) {
      articles =
        parseRss2Json(
          result.body
        );
    }

    /*
     * Normal RSS.
     */
    else {
      articles =
        await parseNormalRss(
          result.body
        );
    }

    articles =
      articles
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

    debug.count =
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
        debug.latest =
          new Date(
            Math.max(
              ...dates
            )
          ).toISOString();
      }
    }

    return {
      articles,
      debug
    };

  } catch (
    error
  ) {
    return {
      articles: [],

      debug: {
        name:
          candidate.name,

        url:
          candidate.url,

        error:
          String(
            error?.message ||
              error
          ),

        count:
          0
      }
    };
  }
}

const debug = {
  generatedAt:
    new Date().toISOString(),

  candidates: [],

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
 * Remove whatever Sankaku data is
 * currently in the generated payload.
 *
 * We will replace it with the
 * fresh RSS result.
 */
const otherArticles =
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
 * Try every RSS transport until
 * we get real Sankaku articles.
 */
for (
  const candidate of
    SOURCES
) {
  const result =
    await fetchCandidate(
      candidate
    );

  debug.candidates.push(
    result.debug
  );

  if (
    !result.articles.length
  ) {
    continue;
  }

  const latest =
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
   * Prefer the source with
   * the newest article.
   */
  if (
    !selected ||
    latest >
      selected.latest
  ) {
    selected = {
      name:
        candidate.name,

      url:
        candidate.url,

      articles:
        result.articles,

      latest
    };
  }
}

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

  /*
   * Replace Sankaku completely.
   */
  payload.articles =
    [
      ...otherArticles,
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
      selected.name ===
      "rss2json"
        ? "rss2json"
        : selected.name.startsWith(
            "rsshub"
          )
        ? "rsshub"
        : "official-rss";

    sourceResult.feedUrl =
      selected.url;

    sourceResult.count =
      sankaku.length;
  }

  console.log(
    `Sankaku: ${sankaku.length} stories via ${selected.name} — images disabled`
  );

} else {
  /*
   * No RSS transport worked.
   *
   * Do NOT insert the old cache.
   * Do NOT insert stale Recent Posts.
   *
   * Sankaku stays unavailable rather
   * than showing old news.
   */
  payload.articles =
    otherArticles;

  debug.selected =
    null;

  debug.count =
    0;

  debug.note =
    "All Sankaku RSS transports failed. No cache, Recent Posts, or old data was used.";

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

    sourceResult.mode =
      null;

    sourceResult.feedUrl =
      null;

    sourceResult.count =
      0;
  }

  console.log(
    "Sankaku: RSS unavailable — no cache used"
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
  "Sankaku refresh complete:",
  JSON.stringify(
    debug,
    null,
    2
  )
);
