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
 * Order:
 *
 * 1. Official Sankaku RSS
 * 2. RSSHub Sankaku route
 *
 * Recent Posts scraping is intentionally NOT used.
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

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value)
    ? value
    : [value];
}

function decodeXml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
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

function attrFromTag(tag, name) {
  return (
    new RegExp(
      name +
        "\\s*=\\s*[\"']([^\"']+)[\"']",
      "i"
    ).exec(
      String(tag || "")
    )?.[1] || ""
  );
}

function absoluteUrl(
  value,
  base = SOURCE.siteUrl
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

function realSankakuUrl(value) {
  try {
    const url =
      new URL(value);

    const host =
      url.hostname.toLowerCase();

    const validHost =
      host === "news.sankakucomplex.com" ||
      host === "www.sankakucomplex.com";

    return (
      validHost &&
      /^\/n\/[^/?#]+\/?$/i.test(
        url.pathname
      )
    );
  } catch {
    return false;
  }
}

function canonicalArticleUrl(value) {
  try {
    const url =
      new URL(value);

    if (
      url.hostname.toLowerCase() ===
      "www.sankakucomplex.com"
    ) {
      url.hostname =
        "news.sankakucomplex.com";
    }

    url.search = "";
    url.hash = "";

    return url.href;
  } catch {
    return "";
  }
}

function sankakuUsableImage(value = "") {
  const url =
    String(value || "").trim();

  if (
    !/^https?:\/\//i.test(url)
  ) {
    return "";
  }

  const lower =
    url.toLowerCase();

  /*
   * Reject obvious site-wide assets.
   */
  if (
    /(?:^|[\/_.-])logo(?:[\/_.?-]|$)/i.test(lower) ||
    /favicon|apple-touch-icon|gravatar|avatar|sprite|spinner|icon(?:[\/_.?-]|$)/i.test(lower)
  ) {
    return "";
  }

  return url;
}

function imageFromText(
  value = "",
  baseUrl = SOURCE.siteUrl
) {
  const text =
    String(value || "");

  /*
   * 1. Markdown images
   */
  for (
    const match of text.matchAll(
      /!\[[^\]]*\]\(<?([^)>\s]+)>?\)/gi
    )
  ) {
    const image =
      sankakuUsableImage(
        absoluteUrl(
          decodeXml(match[1]),
          baseUrl
        )
      );

    if (image) {
      return image;
    }
  }

  /*
   * 2. HTML <img>
   */
  for (
    const tag of
      text.match(
        /<img\b[^>]*>/gi
      ) || []
  ) {
    const candidates = [
      attrFromTag(
        tag,
        "src"
      ),
      attrFromTag(
        tag,
        "data-src"
      ),
      attrFromTag(
        tag,
        "data-lazy-src"
      ),
      attrFromTag(
        tag,
        "data-original"
      )
    ];

    const srcset =
      attrFromTag(
        tag,
        "srcset"
      ) ||
      attrFromTag(
        tag,
        "data-srcset"
      ) ||
      "";

    if (srcset) {
      candidates.unshift(
        srcset
          .split(",")[0]
          ?.trim()
          .split(/\s+/)[0] ||
          ""
      );
    }

    for (
      const raw of
        candidates
    ) {
      const image =
        sankakuUsableImage(
          absoluteUrl(
            decodeXml(raw),
            baseUrl
          )
        );

      if (image) {
        return image;
      }
    }
  }

  /*
   * 3. Direct Sankaku WordPress upload URL.
   *
   * Example:
   * https://news.sankakucomplex.com/wp-content/uploads/2026/10/Original-Art-by-ToosakaAsagi-2026-scaled.jpg
   */
  const uploadMatches = [
    ...text.matchAll(
      /https?:\/\/(?:news|www)\.sankakucomplex\.com\/wp-content\/uploads\/[^"'<> \t\r\n)]+/gi
    )
  ];

  for (
    const match of
      uploadMatches
  ) {
    const image =
      sankakuUsableImage(
        decodeXml(
          match[0]
        )
      );

    if (image) {
      return image;
    }
  }

  /*
   * 4. Relative Sankaku uploads.
   */
  const relativeMatches = [
    ...text.matchAll(
      /\/wp-content\/uploads\/[^"'<> \t\r\n)]+\.(?:jpe?g|png|webp|gif)(?:\?[^"'<> \t\r\n)]*)?/gi
    )
  ];

  for (
    const match of
      relativeMatches
  ) {
    const image =
      sankakuUsableImage(
        absoluteUrl(
          decodeXml(
            match[0]
          ),
          baseUrl
        )
      );

    if (image) {
      return image;
    }
  }

  /*
   * 5. Generic image URL.
   */
  const generic =
    /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/i
      .exec(text)?.[0] ||
    "";

  return sankakuUsableImage(
    absoluteUrl(
      decodeXml(generic),
      baseUrl
    )
  );
}

function extractFeedImageMap(xml) {
  const byLink =
    new Map();

  for (
    const itemMatch of
      String(xml || "").matchAll(
        /<item\b[\s\S]*?<\/item>/gi
      )
  ) {
    const block =
      itemMatch[0];

    const rawLink =
      /<link>\s*([\s\S]*?)\s*<\/link>/i.exec(
        block
      )?.[1] ||
      /<guid[^>]*>\s*([\s\S]*?)\s*<\/guid>/i.exec(
        block
      )?.[1] ||
      "";

    const link =
      canonicalArticleUrl(
        decodeXml(
          rawLink
        ).trim()
      );

    if (
      !realSankakuUrl(
        link
      )
    ) {
      continue;
    }

    const candidates = [];

    /*
     * enclosure
     * media:content
     * media:thumbnail
     */
    for (
      const tag of
        block.match(
          /<(?:enclosure|media:content|media:thumbnail)\b[^>]*>/gi
        ) || []
    ) {
      candidates.push(
        attrFromTag(
          tag,
          "url"
        ),
        attrFromTag(
          tag,
          "href"
        )
      );
    }

    /*
     * Look inside RSS HTML.
     */
    const bodyImage =
      imageFromText(
        block,
        SOURCE.siteUrl
      );

    if (bodyImage) {
      candidates.push(
        bodyImage
      );
    }

    /*
     * Explicitly search WordPress upload URLs.
     */
    const uploads = [
      ...block.matchAll(
        /https?:\/\/(?:news|www)\.sankakucomplex\.com\/wp-content\/uploads\/[^"'<> \t\r\n)]+/gi
      )
    ];

    for (
      const match of uploads
    ) {
      candidates.push(
        match[0]
      );
    }

    for (
      const raw of
        candidates
    ) {
      const image =
        sankakuUsableImage(
          absoluteUrl(
            decodeXml(
              urlOf(raw) ||
              raw ||
              ""
            ),
            SOURCE.siteUrl
          )
        );

      if (image) {
        byLink.set(
          link,
          image
        );

        break;
      }
    }
  }

  return byLink;
}

function cleanTitle(
  value = ""
) {
  const title =
    stripHtml(value)
      .replace(
        /^#+\s*/,
        ""
      )
      .trim();

  if (!title) {
    return "";
  }

  if (
    /^(?:add\s+comment|\d+\s+comments?)$/i.test(
      title
    )
  ) {
    return "";
  }

  if (
    /^just a moment/i.test(
      title
    )
  ) {
    return "";
  }

  return title;
}

function iso(value) {
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

function itemDescription(
  item
) {
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

function itemImage(
  item,
  feedImage = ""
) {
  const candidates = [
    feedImage,

    item.enclosure?.url,
    item.enclosure?.href,

    ...asArray(
      item.mediaContent
    ).map(urlOf),

    ...asArray(
      item.mediaThumbnail
    ).map(urlOf),

    item["media:content"],
    item["media:thumbnail"],

    imageFromText(
      item.contentEncoded,
      item.link ||
        SOURCE.siteUrl
    ),

    imageFromText(
      item.content,
      item.link ||
        SOURCE.siteUrl
    ),

    imageFromText(
      item.description,
      item.link ||
        SOURCE.siteUrl
    ),

    imageFromText(
      item.summary,
      item.link ||
        SOURCE.siteUrl
    )
  ];

  for (
    const value of
      candidates
  ) {
    const resolved =
      sankakuUsableImage(
        absoluteUrl(
          decodeXml(
            urlOf(value) ||
            value ||
            ""
          ),
          item.link ||
            SOURCE.siteUrl
        )
      );

    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function normalize(
  item,
  feedImages = new Map()
) {
  const rawLink =
    item.link ||
    item.guid ||
    "";

  const link =
    canonicalArticleUrl(
      String(rawLink)
        .trim()
    );

  if (
    !realSankakuUrl(
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

  return {
    id:
      hash(
        "sankaku|" +
        link
      ),

    title,

    link,

    publishedAt:
      iso(
        item.isoDate
      ) ||
      iso(
        item.pubDate
      ) ||
      iso(
        item.published
      ) ||
      iso(
        item.updated
      ),

    excerpt:
      itemDescription(
        item
      ),

    image:
      itemImage(
        item,
        feedImages.get(
          link
        ) || ""
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

          ...(options.headers ||
            {})
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
        .exec(
          tag
        )?.[1] ||
      "";

    if (
      name.toLowerCase() ===
      key.toLowerCase()
    ) {
      return (
        /content\s*=\s*["']([^"']+)["']/i
          .exec(
            tag
          )?.[1] ||
        ""
      );
    }
  }

  return "";
}

function sankakuMetaImage(
  html,
  articleUrl
) {
  const source =
    String(html || "");

  /*
   * 1. og:image
   */
  const ogImage =
    sankakuUsableImage(
      absoluteUrl(
        metaContent(
          source,
          "og:image"
        ),
        articleUrl
      )
    );

  if (ogImage) {
    return ogImage;
  }

  /*
   * 2. Sankaku's meta-image article block.
   */
  const blocks =
    source.match(
      /<div\b[^>]*class=["'][^"']*\bmeta-image\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi
    ) || [];

  const canonical =
    canonicalArticleUrl(
      articleUrl
    )
      .replace(
        /\/$/,
        ""
      )
      .toLowerCase();

  for (
    const block of
      blocks
  ) {
    const anchor =
      /<a\b[^>]*>/i.exec(
        block
      )?.[0] || "";

    const href =
      canonicalArticleUrl(
        absoluteUrl(
          attrFromTag(
            anchor,
            "href"
          ),
          articleUrl
        )
      )
        .replace(
          /\/$/,
          ""
        )
        .toLowerCase();

    if (
      href ===
      canonical
    ) {
      const image =
        imageFromText(
          block,
          articleUrl
        );

      if (image) {
        return image;
      }
    }
  }

  /*
   * 3. Search article HTML for
   * wp-content/uploads images.
   */
  const uploadImage =
    imageFromText(
      source,
      articleUrl
    );

  if (
    uploadImage &&
    /\/wp-content\/uploads\//i.test(
      uploadImage
    )
  ) {
    return uploadImage;
  }

  /*
   * 4. Article <img> fallback.
   */
  const articleBlocks =
    source.match(
      /<article\b[\s\S]*?<\/article>/gi
    ) || [];

  for (
    const articleBlock of
      articleBlocks
  ) {
    const images = [];

    for (
      const tag of
        articleBlock.match(
          /<img\b[^>]*>/gi
        ) || []
    ) {
      const candidates = [
        attrFromTag(
          tag,
          "src"
        ),
        attrFromTag(
          tag,
          "data-src"
        ),
        attrFromTag(
          tag,
          "data-lazy-src"
        ),
        attrFromTag(
          tag,
          "data-original"
        )
      ];

      const srcset =
        attrFromTag(
          tag,
          "srcset"
        ) ||
        attrFromTag(
          tag,
          "data-srcset"
        ) ||
        "";

      if (srcset) {
        candidates.unshift(
          srcset
            .split(",")[0]
            ?.trim()
            .split(/\s+/)[0] ||
            ""
        );
      }

      for (
        const raw of
          candidates
      ) {
        const image =
          sankakuUsableImage(
            absoluteUrl(
              decodeXml(raw),
              articleUrl
            )
          );

        if (image) {
          images.push(
            image
          );
        }
      }
    }

    /*
     * Prefer original uploads over
     * WordPress resized derivatives.
     */
    const preferred =
      images.find(
        image =>
          /\/wp-content\/uploads\//i.test(
            image
          ) &&
          !/-\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp|gif)(?:$|\?)/i.test(
            image
          )
      );

    if (preferred) {
      return preferred;
    }

    const upload =
      images.find(
        image =>
          /\/wp-content\/uploads\//i.test(
            image
          )
      );

    if (upload) {
      return upload;
    }
  }

  return "";
}

async function imageFallback(
  article,
  debug
) {
  /*
   * First: direct Sankaku article.
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
              SOURCE.siteUrl,

            accept:
              "text/html,application/xhtml+xml, */*"
          }
        }
      );

    const image =
      direct.status >=
        200 &&
      direct.status <
        300
        ? sankakuMetaImage(
            direct.body,
            article.link
          )
        : "";

    debug.imageAttempts.push({
      link:
        article.link,

      method:
        "direct-html",

      status:
        direct.status,

      finalUrl:
        direct.finalUrl,

      bytes:
        direct.body.length,

      image:
        image ||
        null
    });

    if (image) {
      return {
        ...article,
        image
      };
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
   * Second: Jina Reader.
   */
  try {
    const readerUrl =
      "https://r.jina.ai/http://" +
      article.link.replace(
        /^https?:\/\//i,
        ""
      );

    const result =
      await fetchText(
        readerUrl,
        {
          timeout:
            40000,

          headers: {
            "x-no-cache":
              "true",

            "x-cache-tolerance":
              "0",

            accept:
              "text/plain, text/markdown, */*"
          }
        }
      );

    const image =
      result.status >=
        200 &&
      result.status <
        300
        ? imageFromText(
            result.body,
            article.link
          )
        : "";

    debug.imageAttempts.push({
      link:
        article.link,

      method:
        "jina",

      status:
        result.status,

      finalUrl:
        result.finalUrl,

      bytes:
        result.body.length,

      image:
        image ||
        null
    });

    if (image) {
      return {
        ...article,
        image
      };
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
        60
      );

  if (
    !queue.length
  ) {
    return items;
  }

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

        results.push(
          await imageFallback(
            item,
            debug
          )
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

  rssImageCount:
    0,

  finalCount:
    0,

  finalImageCount:
    0,

  newest:
    null,

  oldest:
    null,

  imageAttempts:
    [],

  note:
    ""
};

const payload =
  JSON.parse(
    await fs.readFile(
      OUT,
      "utf8"
    )
  );

/*
 * Existing data produced by fetch-feeds.mjs.
 *
 * IMPORTANT:
 * We keep this available as a fallback.
 */
const existingArticles =
  payload.articles ||
  [];

const existingOther =
  existingArticles.filter(
    item =>
      item?.source?.id !==
      "sankaku"
  );

const existingSankaku =
  existingArticles.filter(
    item =>
      item?.source?.id ===
      "sankaku"
  );

let selected =
  null;

/*
 * Try all Sankaku RSS endpoints.
 */
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

      imageCount:
        0,

      latest:
        null
    };

    /*
     * Failed endpoint.
     */
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

    const feedImages =
      extractFeedImageMap(
        result.body
      );

    attempt.imageCount =
      feedImages.size;

    const items =
      (
        feed.items ||
        []
      )
        .map(
          item =>
            normalize(
              item,
              feedImages
            )
        )
        .filter(
          Boolean
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

    /*
     * Select the feed containing
     * the newest Sankaku article.
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

/*
 * FRESH RSS SUCCESS
 */
if (
  selected &&
  selected.items.length
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

  debug.selectedFeed =
    selected.url;

  debug.rssCount =
    selected.items.length;

  debug.rssImageCount =
    selected.items.filter(
      item =>
        !!item.image
    ).length;

  /*
   * Fill missing thumbnails
   * from Sankaku article pages.
   */
  sankaku =
    await enrichImages(
      sankaku,
      debug
    );

  debug.finalCount =
    sankaku.length;

  debug.finalImageCount =
    sankaku.filter(
      item =>
        !!item.image
    ).length;

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
   * Fresh Sankaku feed becomes
   * authoritative.
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

  debug.note =
    "Fresh Sankaku RSS selected. Titles, descriptions, dates and links come from RSS. Missing images were enriched from article pages/Jina.";
}

/*
 * FRESH RSS FAILED
 *
 * CRITICAL:
 * Preserve whatever fetch-feeds.mjs
 * already produced.
 *
 * This prevents the entire Sankaku
 * source from disappearing.
 */
else {
  payload.articles =
    existingArticles;

  debug.selectedFeed =
    null;

  debug.rssCount =
    0;

  debug.rssImageCount =
    0;

  debug.finalCount =
    existingSankaku.length;

  debug.finalImageCount =
    existingSankaku.filter(
      item =>
        !!item.image
    ).length;

  const dates =
    existingSankaku
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

  debug.note =
    "All fresh Sankaku RSS endpoints failed. Existing Sankaku data from fetch-feeds.mjs was preserved; nothing was deleted.";
}

/*
 * Recalculate global stats.
 */
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

/*
 * Write output.
 */
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
    " stories | images " +
    debug.finalImageCount +
    "/" +
    debug.finalCount +
    " | feed " +
    (
      debug.selectedFeed ||
      "preserved-existing"
    )
);
