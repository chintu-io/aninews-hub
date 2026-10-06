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

const FEED_PLANS = [
  {
    transport: "jina-reader",
    url: "https://r.jina.ai/http://www.sankakucomplex.com/feed/",
    sourceUrl: "http://www.sankakucomplex.com/feed/"
  },
  {
    transport: "jina-reader",
    url: "https://r.jina.ai/https://www.sankakucomplex.com/feed/",
    sourceUrl: "https://www.sankakucomplex.com/feed/"
  },
  {
    transport: "direct",
    url: "https://www.sankakucomplex.com/feed/",
    sourceUrl: "https://www.sankakucomplex.com/feed/"
  },
  {
    transport: "direct",
    url: "https://www.sankakucomplex.com/?feed=rss2",
    sourceUrl: "https://www.sankakucomplex.com/?feed=rss2"
  },
  {
    transport: "direct",
    url: "https://news.sankakucomplex.com/feed/",
    sourceUrl: "https://news.sankakucomplex.com/feed/"
  },
  {
    transport: "direct",
    url: "https://news.sankakucomplex.com/?feed=rss2",
    sourceUrl: "https://news.sankakucomplex.com/?feed=rss2"
  }
]

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

  if (/^(?:add\s+comment|\d+\s+comments?)$/i.test(title)) {
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

    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");

    return (
      (host === "news.sankakucomplex.com" ||
        host === "www.sankakucomplex.com" ||
        host === "sankakucomplex.com") &&
      /^\/n\/[^/?#]+$/i.test(path)
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

    for (const key of [
      "$",
      "attrs",
      "attribute",
      "content"
    ]) {
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
          `${attr}\\s*=\\s*["']([^"']+)["']`,
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
      `sankaku|${link}`
    ),

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
            "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/json, text/plain, */*",

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

function jinaCandidates(
  body
) {
  const candidates =
    [];

  try {
    const json =
      JSON.parse(
        body
      );

    const data =
      json?.data ??
      json;

    for (
      const key of [
        "content",
        "html",
        "text"
      ]
    ) {
      if (
        typeof data?.[key] ===
          "string" &&
        data[key].trim()
      ) {
        candidates.push(
          data[key]
        );
      }
    }
  } catch {
    /*
     * Jina may return plain
     * text instead of JSON.
     */
  }

  candidates.push(
    body
  );

  return [
    ...new Set(
      candidates.filter(
        value =>
          String(
            value
          ).trim()
      )
    )
  ];
}

function parseJinaHtml(content) {
  const html =
    String(content || "");

  const matches = [
    ...html.matchAll(
      /<h3[^>]*>\s*<a\s+href=["'](https?:\/\/(?:news|www)\.sankakucomplex\.com\/n\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>[\s\S]*?<time[^>]*>([^<]+)<\/time>/gi
    )
  ];

  return matches
    .map(match => ({
      link: match[1],
      title: cleanTitle(match[2]),
      pubDate: stripHtml(match[3]),
      description: ""
    }))
    .filter(
      item =>
        item.title &&
        realSankakuUrl(item.link)
    );
}

function parseJinaMarkdown(
  content
) {
  const text =
    String(
      content || ""
    );

  const matches = [
    ...text.matchAll(
      /\[([^\]]+)\]\((https?:\/\/(?:news|www)\.sankakucomplex\.com\/n\/[^)\s]+)\)/gi
    )
  ];

  if (
    !matches.length
  ) {
    return [];
  }

  const items =
    [];

  for (
    let i = 0;
    i < matches.length;
    i++
  ) {
    const match =
      matches[i];

    const title =
      cleanTitle(
        match[1] || ""
      );

    const link =
      match[2];

    if (
      !title ||
      !realSankakuUrl(
        link
      )
    ) {
      continue;
    }

    const start =
      match.index +
      match[0].length;

    const end =
      matches[i + 1]
        ?.index ??
      text.length;

    const block =
      text.slice(
        start,
        end
      );

    const dateMatch =
      block.match(
        /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?|[A-Z][a-z]{2,8}\s+\d{1,2},\s+20\d{2})\b/
      );

    const cleaned =
      block
        .replace(
          /\[[^\]]+\]\([^)]+\)/g,
          " "
        )
        .replace(
          /https?:\/\/\S+/g,
          " "
        )
        .replace(
          /\b(?:published|updated|date)\s*:\s*/gi,
          " "
        )
        .replace(
          /[*#>_`]/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    items.push({
      title,
      link,
      pubDate:
        dateMatch?.[0] ||
        "",
      description:
        cleaned
    });
  }

  return items;
}

async function parseFeedResponse(
  body,
  isJina
) {
  const candidates =
    isJina
      ? jinaCandidates(
          body
        )
      : [body];

  for (
    const candidate of
      candidates
  ) {
    try {
      const feed =
        await parser.parseString(
          candidate
        );

      if (
        (
          feed.items ||
          []
        ).length
      ) {
        return feed;
      }
    } catch {
      /*
       * Try another
       * representation.
       */
    }
  }

  if (
    isJina
  ) {
    const htmlItems =
      candidates.flatMap(
        parseJinaHtml
      );

    if (
      htmlItems.length
    ) {
      return {
        items:
          htmlItems
      };
    }

    const markdownItems =
      candidates.flatMap(
        parseJinaMarkdown
      );

    if (
      markdownItems.length
    ) {
      return {
        items:
          markdownItems
      };
    }
  }

  return null;
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

function stripMarkdown(value = "") {
  return String(value || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[>*_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jinaArticleMetadata(body) {
  try {
    const json =
      JSON.parse(
        String(body || "")
      );

    const data =
      json?.data ??
      json;

    const content =
      String(
        data?.content ||
        ""
      );

    /*
     * Jina's page metadata can be stale.
     * The rendered article content is reliable:
     * after the article heading/byline/image, the
     * first substantial paragraph is the article lead.
     */
    const lines =
      content
        .split(/\r?\n/)
        .map(
          line =>
            line.trim()
        );

    let seenHeading =
      false;

    for (
      const line of
        lines
    ) {
      if (
        /^#\s+/.test(
          line
        )
      ) {
        seenHeading =
          true;
        continue;
      }

      if (
        !seenHeading ||
        !line
      ) {
        continue;
      }

      if (
        /^!\[/.test(line) ||
        /^\[[^\]]+\]\(/.test(line) ||
        /^https?:\/\//i.test(line) ||
        /^by\s+/i.test(line) ||
        /^(?:add\s+comment|hide ads|comment)$/i.test(line) ||
        /^(?:just now|\d+\s+(?:minute|minutes|hour|hours|day|days)\s+ago)$/i.test(line)
      ) {
        continue;
      }

      const description =
        excerpt(
          stripMarkdown(
            line
          )
        );

      if (
        description &&
        description.length >=
          40
      ) {
        return {
          description
        };
      }
    }

    /*
     * HTML fallback if the Markdown
     * representation is unavailable.
     */
    const html =
      String(
        data?.html ||
        ""
      );

    const articleBlocks =
      html.match(
        /<article\b[\s\S]*?<\/article>/gi
      ) || [];

    for (
      const block of
        articleBlocks
    ) {
      const paragraphs =
        [
          ...block.matchAll(
            /<p[^>]*>([\s\S]*?)<\/p>/gi
          )
        ]
          .map(
            match =>
              excerpt(
                match[1]
              )
          )
          .filter(
            value =>
              value &&
              value.length >= 40
          );

      if (
        paragraphs.length
      ) {
        return {
          description:
            paragraphs[0]
        };
      }
    }

    return {
      description:
        ""
    };
  } catch {
    return {
      description:
        ""
    };
  }
}

async function enrichSankakuDescriptions(
  items,
  debug
) {
  const queue = [
    ...items
  ];

  const results = [];

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

        try {
          const result =
            await fetchText(
              `https://r.jina.ai/${item.link}?__anihub_cache_bust=${hash(item.link)}`,
              {
                timeout:
                  40000,
                headers: {
                  accept:
                    "application/json",
                  "x-no-cache":
                    "true",
                  "x-cache-tolerance":
                    "0"
                }
              }
            );

          const metadata =
            result.status >= 200 &&
            result.status < 300
              ? jinaArticleMetadata(
                  result.body
                )
              : {
                  description:
                    ""
                };

          debug.descriptionAttempts.push({
            link: item.link,
            status: result.status,
            bytes: result.body.length,
            hasDescription:
              Boolean(
                metadata.description
              )
          });

          results.push({
            ...item,
            excerpt:
              metadata.description ||
              item.excerpt
          });
        } catch (error) {
          debug.descriptionAttempts.push({
            link: item.link,
            error:
              String(
                error?.message ||
                error
              )
          });

          results.push(item);
        }

        await sleep(150);
      }
    };

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            4,
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

async function imageFallback(
  article,
  debug
) {
  if (
    article.image
  ) {
    return article;
  }

  /*
   * Direct article page.
   * Image only.
   */
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
        "direct-html",

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
        "direct-html",

      error:
        String(
          error?.message ||
            error
        )
    });
  }

  /*
   * Jina article fallback.
   * Image only.
   */
  try {
    const jina =
      `https://r.jina.ai/${article.link}`;

    const result =
      await fetchText(
        jina,
        {
          timeout:
            40000,

          headers: {
            accept:
              "application/json, text/plain, */*",

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
      const candidates =
        jinaCandidates(
          result.body
        );

      for (
        const candidate of
          candidates
      ) {
        const image =
          metaContent(
            candidate,
            "og:image"
          ) ||
          imageFromText(
            candidate
          );

        if (image) {
          return {
            ...article,
            image
          };
        }
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

  if (
    !queue.length
  ) {
    return items;
  }

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

  feedAttempts:
    [],

  selectedFeed:
    null,

  selectedTransport:
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

  descriptionAttempts:
    [],

  note:
    "Sankaku title, description, date and link come from RSS. Direct official RSS is tried first; Jina Reader may transport the exact official RSS URL when the GitHub runner is rejected. Article pages are used only for missing images. No old Sankaku cache is merged."
};

const payload =
  JSON.parse(
    await fs.readFile(
      OUT,
      "utf8"
    )
  );

const existingOther =
  (
    payload.articles ||
    []
  ).filter(
    item =>
      item?.source?.id !==
      "sankaku"
  );

let selected =
  null;

for (
  const plan of
    FEED_PLANS
) {
  try {
    const result =
      await fetchText(
        plan.url,
        {
          timeout:
            plan.transport ===
            "jina-reader"
              ? 45000
              : 30000,

          headers:
            plan.transport ===
            "jina-reader"
              ? {
                  accept:
                    "application/json",

                  "x-respond-with":
                    "html",

                  "x-engine":
                    "direct",

                  "x-no-cache":
                    "true",

                  "x-cache-tolerance":
                    "0"
                }
              : {
                  "cache-control":
                    "no-cache",

                  pragma:
                    "no-cache"
                }
        }
      );

    const attempt = {
      url:
        plan.url,

      sourceFeed:
        plan.sourceUrl,

      transport:
        plan.transport,

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
      await parseFeedResponse(
        result.body,
        plan.transport ===
          "jina-reader"
      );

    if (!feed) {
      attempt.parseError =
        "Response could not be parsed as RSS/Atom";

      debug.feedAttempts.push(
        attempt
      );

      continue;
    }

    const items =
      (
        feed.items ||
        []
      )
        .map(
          normalize
        )
        .filter(
          Boolean
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
        );

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
        ...plan,
        latest,
        items
      };
    }

    /*
     * Stop once an official feed is fresh.
     *
     * If direct RSS is stale, keep going so Jina
     * can fetch the exact same official RSS URL
     * through another network path.
     */
    const selectedAgeMs =
      selected.latest
        ? Date.now() -
          selected.latest
        : Infinity;

    const freshEnough =
      selectedAgeMs >=
        0 &&
      selectedAgeMs <=
        36 *
          60 *
          60 *
          1000;

    if (
      (
        plan.transport ===
          "direct" ||
        plan.transport ===
          "jina-reader"
      ) &&
      freshEnough
    ) {
      break;
    }
  } catch (
    error
  ) {
    debug.feedAttempts.push({
      url:
        plan.url,

      sourceFeed:
        plan.sourceUrl,

      transport:
        plan.transport,

      error:
        String(
          error?.message ||
            error
        )
    });
  }
}

if (
  selected?.items?.length
) {
  let sankaku =
    selected.items
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

  sankaku =
    await enrichSankakuDescriptions(
      sankaku,
      debug
    );

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

  /*
   * Keep selectedFeed as the real
   * Sankaku feed URL even when Jina
   * transported the request.
   */
  debug.selectedFeed =
    selected.sourceUrl;

  debug.selectedTransport =
    selected.transport;

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

  payload.sourceResults =
    payload.sourceResults ||
    [];

  const sourceResult =
    payload.sourceResults.find(
      item =>
        item.id ===
        "sankaku"
    );

  const sankakuResult = {
    id:
      "sankaku",

    name:
      SOURCE.name,

    status:
      "ok",

    mode:
      selected.transport,

    feedUrl:
      selected.sourceUrl,

    count:
      sankaku.length
  };

  if (
    sourceResult
  ) {
    Object.assign(
      sourceResult,
      sankakuResult
    );
  } else {
    payload.sourceResults.push(
      sankakuResult
    );
  }

  console.log(
    `Sankaku RSS refresh: ${sankaku.length} stories via ${selected.transport} (${selected.sourceUrl})`
  );
} else {
  /*
   * Never publish stale Sankaku cache.
   */
  payload.articles =
    existingOther;

  debug.finalCount =
    0;

  debug.note =
    "All Sankaku RSS transports failed. Sankaku was removed from this build instead of publishing stale cached stories.";

  console.log(
    "Sankaku RSS refresh: 0 stories from no feed"
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
    debug,
    null,
    2
  )
);

console.log(
  `Sankaku final: ${debug.finalCount} stories; newest=${debug.newest || "n/a"}; transport=${debug.selectedTransport || "none"}`
);
