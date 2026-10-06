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

const OUT = new URL(
  "../site/data/articles.json",
  import.meta.url
);

const DEBUG_OUT = new URL(
  "../site/debug/sankaku.json",
  import.meta.url
);

const USER_AGENT =
  "AniNewsHub/1.5 (personal RSS reader)";

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
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value = "") {
  const text =
    stripHtml(value);

  return text.length <= 360
    ? text
    : `${text
        .slice(0, 357)
        .trimEnd()}…`;
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
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    );
}

function urlOf(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "object"
  ) {
    if (
      typeof value.url ===
      "string"
    ) {
      return value.url;
    }

    if (
      typeof value.href ===
      "string"
    ) {
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
      const nested =
        urlOf(
          value[key]
        );

      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

function attrFromTag(
  tag,
  name
) {
  return (
    new RegExp(
      `${name}\\s*=\\s*["']([^"']+)["']`,
      "i"
    ).exec(
      String(tag || "")
    )?.[1] || ""
  );
}

function absoluteUrl(
  value,
  baseUrl = ""
) {
  const cleaned =
    String(value || "")
      .trim();

  if (!cleaned) {
    return "";
  }

  try {
    return new URL(
      cleaned,
      baseUrl || undefined
    ).href;
  } catch {
    return "";
  }
}

function imageFromText(
  value = "",
  baseUrl = ""
) {
  const text =
    String(value || "");

  /*
   * Markdown image
   */
  const markdown =
    /!\[[^\]]*\]\(<?([^)>\s]+)>?\)/i.exec(
      text
    )?.[1] || "";

  const markdownImage =
    absoluteUrl(
      decodeXml(markdown),
      baseUrl
    );

  if (
    /^https?:\/\//i.test(
      markdownImage
    )
  ) {
    return markdownImage;
  }

  /*
   * HTML <img>
   */
  const htmlTags =
    text.match(
      /<img\b[^>]*>/gi
    ) || [];

  for (
    const tag of htmlTags
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
        attrFromTag(
          tag,
          attr
        );

      const resolved =
        absoluteUrl(
          decodeXml(raw),
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
      const first =
        srcset
          .split(",")[0]
          ?.trim()
          .split(/\s+/)[0] ||
        "";

      const resolved =
        absoluteUrl(
          decodeXml(first),
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
   * Generic image URL.
   */
  const generic =
    /(?:https?:\/\/|\/)[^\s"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s"'<>]*)?/i
      .exec(text)?.[0] ||
    "";

  const resolvedGeneric =
    absoluteUrl(
      decodeXml(
        generic
      ),
      baseUrl
    );

  return /^https?:\/\//i.test(
    resolvedGeneric
  )
    ? resolvedGeneric
    : "";
}

function imageOf(
  item,
  source
) {
  const htmlCandidates = [
    item.contentEncoded,
    item.content,
    item.description,
    item.summary
  ];

  for (
    const value of
      htmlCandidates
  ) {
    const image =
      imageFromText(
        value || "",
        item.link ||
          source?.siteUrl ||
          ""
      );

    if (image) {
      return image;
    }
  }

  const candidates = [
    item.enclosure?.url,
    item.enclosure?.href,

    ...asArray(
      item.mediaContent
    ).map(urlOf),

    ...asArray(
      item.mediaThumbnail
    ).map(urlOf)
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

function normalize(
  item,
  source
) {
  const title =
    stripHtml(
      item.title ||
        "Untitled"
    );

  const link =
    item.link ||
    item.guid ||
    "";

  if (
    !/^https?:\/\//i.test(
      link
    )
  ) {
    return null;
  }

  const publishedRaw =
    item.isoDate ||
    item.pubDate ||
    item.published ||
    item.updated ||
    null;

  const parsed =
    publishedRaw
      ? new Date(
          publishedRaw
        )
      : null;

  const publishedAt =
    parsed &&
    !Number.isNaN(
      parsed.getTime()
    )
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
    id: hash(
      `${source.id}|${
        item.guid ||
        link
      }`
    ),

    title,

    link,

    publishedAt,

    excerpt:
      excerpt(summary),

    image:
      imageOf(
        item,
        source
      ),

    source: {
      id:
        source.id,

      name:
        source.name,

      short:
        source.short,

      siteUrl:
        source.siteUrl,

      category:
        source.category,

      accent:
        source.accent,

      language:
        source.language ||
        "en"
    }
  };
}

async function fetchUrl(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        method:
          options.method ||
          "GET",

        headers: {
          "user-agent":
            USER_AGENT,

          accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",

          ...(options.headers ||
            {})
        },

        body:
          options.body,

        redirect:
          "follow",

        signal:
          AbortSignal.timeout(
            options.timeout ??
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

function jinaCandidates(body) {
  const candidates = [];

  try {
    const json =
      JSON.parse(
        String(body || "")
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
        typeof data?.[key] === "string" &&
        data[key].trim()
      ) {
        candidates.push(
          data[key]
        );
      }
    }
  } catch {
    /*
     * Jina can also return plain text.
     */
  }

  candidates.push(
    String(body || "")
  );

  return [
    ...new Set(
      candidates.filter(
        value =>
          String(value || "").trim()
      )
    )
  ];
}

function markdownArticleLinks(
  content,
  baseUrl,
  hostPattern
) {
  const source =
    String(content || "");

  const results = [];
  const seen = new Set();

  const linkRe =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

  for (
    const match of
      source.matchAll(linkRe)
  ) {
    const href =
      absoluteUrl(
        match[2],
        baseUrl
      );

    if (
      !href ||
      !hostPattern.test(href)
    ) {
      continue;
    }

    const title =
      stripHtml(
        match[1]
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (
      !title ||
      title.length < 8
    ) {
      continue;
    }

    const key =
      href
        .replace(
          /#.*$/,
          ""
        )
        .replace(
          /\/$/,
          ""
        )
        .toLowerCase();

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    results.push({
      href,
      title,
      index:
        match.index ??
        0
    });
  }

  return results;
}

function htmlArticleLinks(
  html,
  baseUrl,
  hostPattern
) {
  const source =
    String(html || "");

  const results = [];
  const seen = new Set();

  const anchorRe =
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (
    const match of
      source.matchAll(
        anchorRe
      )
  ) {
    const href =
      absoluteUrl(
        match[1],
        baseUrl
      );

    if (
      !href ||
      !hostPattern.test(
        href
      )
    ) {
      continue;
    }

    const title =
      stripHtml(
        match[2]
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (
      !title ||
      title.length < 8
    ) {
      continue;
    }

    const key =
      href
        .replace(
          /#.*$/,
          ""
        )
        .replace(
          /\/$/,
          ""
        )
        .toLowerCase();

    if (
      seen.has(
        key
      )
    ) {
      continue;
    }

    seen.add(
      key
    );

    results.push({
      href,
      title,
      index:
        match.index ??
        0
    });
  }

  return results;
}

function parseJapaneseListingPage(
  html,
  source
) {
  const baseUrl =
    source.feedUrls[0];

  const hostPattern =
    new RegExp(
      source.articlePattern,
      "i"
    );

  const links =
    htmlArticleLinks(
      html,
      baseUrl,
      hostPattern
    );

  const raw =
    String(html || "");

  const items = [];

  for (
    let i = 0;
    i < links.length &&
      items.length < 30;
    i++
  ) {
    const current =
      links[i];

    const start =
      Math.max(
        0,
        current.index - 1500
      );

    const end =
      i + 1 < links.length
        ? Math.min(
            raw.length,
            links[i + 1].index +
              1000
          )
        : Math.min(
            raw.length,
            current.index +
              2500
          );

    const windowHtml =
      raw.slice(
        start,
        end
      );

    const windowText =
      stripHtml(
        windowHtml
      );

    const datePatterns = [
      /20\d{2}[/.]\d{1,2}[/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?/,
      /20\d{2}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?/,
      /20\d{2}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?/
    ];

    let dateText =
      "";

    for (
      const pattern of
        datePatterns
    ) {
      const match =
        windowText.match(
          pattern
        );

      if (
        match?.[0]
      ) {
        dateText =
          match[0];

        break;
      }
    }

    let description =
      "";

    /*
     * Look for a paragraph in
     * the same card/listing area.
     */
    const paragraphTexts = [
      ...windowHtml.matchAll(
        /<(?:p|div)\b[^>]*>([\s\S]*?)<\/(?:p|div)>/gi
      )
    ]
      .map(
        match =>
          stripHtml(
            match[1]
          )
      )
      .filter(
        value =>
          value.length >=
          40
      )
      .filter(
        value =>
          value !==
          current.title
      )
      .filter(
        value =>
          !/^(?:NEWS|ニュース|Japan|Overseas|ALL|MORE|READ MORE)$/i.test(
            value
          )
      );

    description =
      excerpt(
        paragraphTexts
          .sort(
            (a, b) =>
              Math.abs(
                a.length -
                  180
              ) -
              Math.abs(
                b.length -
                  180
              )
          )[0] ||
        ""
      );

    /*
     * The visible listing text is
     * useful when the site does not
     * expose a dedicated paragraph.
     */
    if (
      !description
    ) {
      const titlePos =
        windowText.indexOf(
          current.title
        );

      if (
        titlePos >= 0
      ) {
        const after =
          windowText
            .slice(
              titlePos +
                current.title.length
            )
            .replace(
              dateText,
              " "
            )
            .replace(
              /\s+/g,
              " "
            )
            .trim();

        description =
          excerpt(
            after
              .split(
                /(?:関連記事|関連ニュース|MORE|READ MORE|ニュース|NEWS)/i
              )[0]
              .trim()
          );
      }
    }

    items.push({
      title:
        current.title,

      link:
        current.href,

      pubDate:
        dateText,

      description,

      contentEncoded:
        windowHtml
    });
  }

  return items;
}

async function parseJapaneseListingSource(
  source
) {
  const pageUrl =
    source.feedUrls[0];

  let result =
    await fetchUrl(
      pageUrl
    );

  let items =
    [];

  if (
    result.status >= 200 &&
    result.status < 300 &&
    result.body.trim()
  ) {
    items =
      parseJapaneseListingPage(
        result.body,
        source
      );
  }

  /*
   * Many Japanese media sites
   * block GitHub Actions. Jina is
   * the transport fallback.
   */
  if (
    !items.length
  ) {
    const jina =
      await fetchUrl(
        "https://r.jina.ai/http://" +
          new URL(
            pageUrl
          ).host +
          new URL(
            pageUrl
          ).pathname,
        {
          timeout:
            45000,
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

    if (
      jina.status >= 200 &&
      jina.status < 300 &&
      jina.body.trim()
    ) {
      result =
        jina;

      for (
        const candidate of
          jinaCandidates(
            jina.body
          )
      ) {
        items =
          parseJapaneseListingPage(
            candidate,
            source
          );

        if (
          items.length
        ) {
          break;
        }
      }
    }
  }

  if (
    !items.length
  ) {
    throw new Error(
      source.name +
        " news listing unavailable"
    );
  }

  return {
    result,
    items
  };
}

async function parseFeed(
  url
) {
  const result =
    await fetchUrl(
      url
    );

  if (
    result.status <
      200 ||
    result.status >=
      300
  ) {
    throw new Error(
      `HTTP ${result.status}`
    );
  }

  if (
    !result.body.trim()
  ) {
    throw new Error(
      "Empty response"
    );
  }

  return {
    result,

    feed:
      await parser.parseString(
        result.body
      )
  };
}

/*
 * ---------------------------------------------------------
 * Generic article image enrichment
 * ---------------------------------------------------------
 */

function metaValue(
  html,
  property
) {
  for (
    const tag of
      String(html).match(
        /<meta\b[^>]*>/gi
      ) || []
  ) {
    const key =
      attrFromTag(
        tag,
        "property"
      ) ||
      attrFromTag(
        tag,
        "name"
      );

    if (
      key.toLowerCase() ===
      property.toLowerCase()
    ) {
      return attrFromTag(
        tag,
        "content"
      );
    }
  }

  return "";
}

function jsonLdArticle(
  html
) {
  const blocks =
    String(html).match(
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
        JSON.parse(text)
      );
    } catch {
      continue;
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
      Array.isArray(value)
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
        : [
            value["@type"]
          ];

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

function cleanAnnTitle(value = "") {
  return stripHtml(value)
    .replace(/\s*[-|–—]\s*Anime News Network\s*$/i, "")
    .replace(/\s*\|\s*ANN\s*$/i, "")
    .trim();
}

function extractAnnPageTitle(html, article = {}) {
  const source = String(html || "");

  const h1Candidates = [
    ...source.matchAll(
      /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi
    )
  ].map(match => cleanAnnTitle(match[1]));

  const documentTitle =
    /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] || "";

  const candidates = [
    ...h1Candidates,
    cleanAnnTitle(documentTitle),
    cleanAnnTitle(metaValue(source, "og:title")),
    cleanAnnTitle(metaValue(source, "twitter:title")),
    cleanAnnTitle(article?.headline || "")
  ].filter(
    value =>
      value &&
      !/^(?:anime news network|ann|home)$/i.test(value)
  );

  return (
    candidates.find(
      value => value.length >= 18
    ) || ""
  );
}

function betterAnnTitle(current, candidate) {
  const oldTitle = cleanAnnTitle(current);
  const newTitle = cleanAnnTitle(candidate);

  if (
    !newTitle ||
    newTitle.length <= oldTitle.length + 6
  ) {
    return current;
  }

  return newTitle;
}

function annTitleNeedsRepair(item) {
  const title = cleanAnnTitle(item?.title);

  if (title.length > 38) {
    return false;
  }

  try {
    const pathParts =
      new URL(item.link).pathname
        .split("/")
        .filter(Boolean);

    const slug =
      pathParts.find(
        part =>
          /^[a-z0-9-]+$/i.test(part) &&
          part.length > title.length + 12
      ) || "";

    return Boolean(slug);
  } catch {
    return false;
  }
}

function jinaAnnPageTitle(body) {
  try {
    const json = JSON.parse(String(body || ""));
    const data = json?.data ?? json;

    const content =
      String(data?.content || "");

    const heading =
      content.match(/^#\s+(.+)$/m)?.[1] || "";

    const fromMarkdown =
      cleanAnnTitle(heading);

    if (fromMarkdown.length >= 18) {
      return fromMarkdown;
    }

    return extractAnnPageTitle(
      String(data?.html || ""),
      {}
    );
  } catch {
    return "";
  }
}

function parseHtmlMetadata(
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
        item =>
          typeof item ===
          "string"
      ) ||
      article.image.find(
        item =>
          item &&
          typeof item.url ===
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

  const published =
    article?.datePublished ||
    metaValue(
      html,
      "article:published_time"
    );

  const date =
    published
      ? new Date(
          published
        )
      : null;

  return {
    title:
      stripHtml(
        article?.headline ||
        metaValue(
          html,
          "og:title"
        ) ||
        ""
      ),

    description:
      stripHtml(
        article?.description ||
        metaValue(
          html,
          "og:description"
        ) ||
        ""
      ),

    image:
      /^https?:\/\//i.test(
        image
      )
        ? image
        : "",

    publishedAt:
      date &&
      !Number.isNaN(
        date.getTime()
      )
        ? date.toISOString()
        : null
  };
}

async function enrichDirectPage(
  item
) {
  try {
    const result =
      await fetchUrl(
        item.link
      );

    if (
      result.status <
        200 ||
      result.status >=
        300
    ) {
      return item;
    }

    const meta =
      parseHtmlMetadata(
        result.body
      );

    return {
      ...item,

      title:
        betterAnnTitle(
          item.title,
          meta.title
        ),

      image:
        meta.image ||
        item.image
    };
  } catch {
    return item;
  }
}

async function enrichAnnTitleViaJina(
  item
) {
  try {
    const result =
      await fetchUrl(
        "https://r.jina.ai/" +
          item.link,
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

    if (
      result.status <
        200 ||
      result.status >=
        300
    ) {
      return item;
    }

    return {
      ...item,

      title:
        betterAnnTitle(
          item.title,
          jinaAnnPageTitle(
            result.body
          )
        )
    };
  } catch {
    return item;
  }
}

async function enrichAnn(
  items
) {
  const candidates =
    Array.from(
      new Map(
        items
          .filter(
            item =>
              !item.image ||
              annTitleNeedsRepair(
                item
              )
          )
          .map(
            item => [
              item.link,
              item
            ]
          )
      ).values()
    ).slice(
      0,
      60
    );

  const results = [];

  const queue = [
    ...candidates
  ];

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

        let updated =
          await enrichDirectPage(
            item
          );

        if (
          annTitleNeedsRepair(
            item
          ) &&
          cleanAnnTitle(
            updated.title
          ) ===
            cleanAnnTitle(
              item.title
            )
        ) {
          updated =
            await enrichAnnTitleViaJina(
              updated
            );
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
            3,
            queue.length ||
              1
          )
      },
      () => worker()
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

  let resolved = 0;
  let titlesRepaired = 0;

  const merged =
    items.map(
      item => {
        const updated =
          byLink.get(
            item.link
          );

        if (!updated) {
          return item;
        }

        if (
          !item.image &&
          updated.image
        ) {
          resolved++;
        }

        if (
          cleanAnnTitle(
            updated.title
          ) !==
            cleanAnnTitle(
              item.title
            )
        ) {
          titlesRepaired++;
        }

        return updated;
      }
    );

  return {
    items:
      merged,

    attempted:
      results.length,

    resolved,

    titlesRepaired
  };
}

/*
 * ---------------------------------------------------------
 * Sankaku helpers
 * ---------------------------------------------------------
 */

function isCommentLabel(
  value = ""
) {
  return /^(?:add\s+comment|\d+\s+comments?)$/i.test(
    stripHtml(value)
      .trim()
  );
}

function realSankakuUrl(
  value
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

function sankakuUsableImage(
  value = ""
) {
  const url =
    String(
      value || ""
    ).trim();

  if (
    !/^https?:\/\//i.test(
      url
    )
  ) {
    return "";
  }

  const lower =
    url.toLowerCase();

  if (
    /(?:^|[\/_.-])logo(?:[\/_.?-]|$)/i.test(
      lower
    ) ||
    /favicon|apple-touch-icon|gravatar|avatar|sprite|spinner|icon(?:[\/_.?-]|$)/i.test(
      lower
    )
  ) {
    return "";
  }

  return url;
}

function sankakuImageFromText(
  value = "",
  baseUrl = ""
) {
  const text =
    String(value || "");

  /*
   * Markdown image
   */
  for (
    const match of
      text.matchAll(
        /!\[[^\]]*\]\(<?([^)>\s]+)>?\)/gi
      )
  ) {
    const image =
      sankakuUsableImage(
        absoluteUrl(
          decodeXml(
            match[1]
          ),
          baseUrl
        )
      );

    if (image) {
      return image;
    }
  }

  /*
   * HTML image.
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
      const candidate of
        candidates
    ) {
      const image =
        sankakuUsableImage(
          absoluteUrl(
            decodeXml(
              candidate
            ),
            baseUrl
          )
        );

      if (image) {
        return image;
      }
    }
  }

  /*
   * Direct WordPress upload URL.
   *
   * This catches:
   *
   * /wp-content/uploads/2026/10/Original-Art-....jpg
   */
  const uploads = [
    ...text.matchAll(
      /https?:\/\/news\.sankakucomplex\.com\/wp-content\/uploads\/[^"'<> \t\r\n)]+/gi
    )
  ];

  for (
    const match of uploads
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
   * Relative upload URL.
   */
  const relativeUploads = [
    ...text.matchAll(
      /\/wp-content\/uploads\/[^"'<> \t\r\n)]+\.(?:jpe?g|png|webp|gif)(?:\?[^"'<> \t\r\n)]*)?/gi
    )
  ];

  for (
    const match of
      relativeUploads
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
        metaValue(
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
   * 2. Sankaku's .meta-image hero block.
   */
  const blocks =
    source.match(
      /<div\b[^>]*class=["'][^"']*\bmeta-image\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi
    ) || [];

  const canonical =
    String(
      articleUrl || ""
    )
      .replace(
        /[?#].*$/,
        ""
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
      absoluteUrl(
        attrFromTag(
          anchor,
          "href"
        ),
        articleUrl
      )
        .replace(
          /[?#].*$/,
          ""
        )
        .replace(
          /\/$/,
          ""
        )
        .toLowerCase();

    if (
      href !==
      canonical
    ) {
      continue;
    }

    const image =
      sankakuImageFromText(
        block,
        articleUrl
      );

    if (image) {
      return image;
    }
  }

  /*
   * 3. Article <img> elements.
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
        const candidate of
          candidates
      ) {
        const image =
          sankakuUsableImage(
            absoluteUrl(
              decodeXml(
                candidate
              ),
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

  /*
   * 4. Search entire HTML for a
   * Sankaku WordPress upload.
   */
  return sankakuImageFromText(
    source,
    articleUrl
  );
}

async function enrichSankaku(
  item,
  diagnostics
) {
  /*
   * First attempt:
   * direct article HTML.
   *
   * This is ONLY for the image.
   * Title, date and description remain
   * the RSS values.
   */
  try {
    const result =
      await fetchUrl(
        item.link,
        {
          headers: {
            accept:
              "text/html,application/xhtml+xml, */*",

            "user-agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",

            referer:
              "https://news.sankakucomplex.com/"
          },

          timeout:
            30000
        }
      );

    const image =
      result.status >=
        200 &&
      result.status <
        300
        ? sankakuMetaImage(
            result.body,
            item.link
          )
        : "";

    diagnostics.imageAttempts.push({
      link:
        item.link,

      method:
        "direct-html",

      status:
        result.status,

      finalUrl:
        result.finalUrl,

      contentType:
        result.contentType,

      bytes:
        result.body.length,

      image:
        image || null
    });

    if (image) {
      return {
        ...item,
        image
      };
    }
  } catch (
    error
  ) {
    diagnostics.imageAttempts.push({
      link:
        item.link,

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
   * Second attempt:
   * Jina Reader.
   *
   * Again, only image extraction.
   */
  try {
    const readerUrl =
      "https://r.jina.ai/http://" +
      item.link.replace(
        /^https?:\/\//i,
        ""
      );

    const result =
      await fetchUrl(
        readerUrl,
        {
          headers: {
            accept:
              "text/plain, text/markdown, */*",

            "x-no-cache":
              "true",

            "x-cache-tolerance":
              "0"
          },

          timeout:
            40000
        }
      );

    const image =
      result.status >=
        200 &&
      result.status <
        300
        ? sankakuImageFromText(
            result.body,
            item.link
          )
        : "";

    diagnostics.imageAttempts.push({
      link:
        item.link,

      method:
        "jina",

      status:
        result.status,

      finalUrl:
        result.finalUrl,

      contentType:
        result.contentType,

      bytes:
        result.body.length,

      image:
        image || null
    });

    if (image) {
      return {
        ...item,
        image
      };
    }
  } catch (
    error
  ) {
    diagnostics.imageAttempts.push({
      link:
        item.link,

      method:
        "jina",

      error:
        String(
          error?.message ||
            error
        )
    });
  }

  return item;
}

async function enrichSankakuImages(
  items,
  diagnostics
) {
  const missing =
    items.filter(
      item =>
        !item.image
    );

  if (
    !missing.length
  ) {
    return {
      items,

      attempted:
        0,

      resolved:
        0
    };
  }

  const queue =
    [
      ...missing
    ];

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
          await enrichSankaku(
            item,
            diagnostics
          )
        );

        await sleep(
          150
        );
      }
    };

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            3,
            queue.length ||
              1
          )
      },
      () => worker()
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

  let resolved =
    0;

  const merged =
    items.map(
      item => {
        const updated =
          byLink.get(
            item.link
          );

        if (!updated) {
          return item;
        }

        if (
          !item.image &&
          updated.image
        ) {
          resolved++;
        }

        return updated;
      }
    );

  return {
    items:
      merged,

    attempted:
      results.length,

    resolved
  };
}

/*
 * ---------------------------------------------------------
 * Sankaku RSS
 *
 * NO CACHE
 * NO BOOTSTRAP
 * NO RECENT POSTS
 * ---------------------------------------------------------
 */

async function fetchSankaku() {
  const source =
    SOURCES.find(
      item =>
        item.id ===
        "sankaku"
    );

  /*
   * Official feeds first.
   */
  const feedUrls = [
    ...(source?.feedUrls || []),

    /*
     * RSSHub is an RSS transport fallback.
     * It is still RSS data, not Recent Posts scraping.
     */
    "https://rsshub.app/sankakucomplex/post?limit=50&sorted=true",
    "https://rsshub.app/sankakucomplex/post.rss?limit=50&sorted=true"
  ];

  const diagnostics = {
    checkedAt:
      new Date().toISOString(),

    feeds: [],

    selectedMode:
      null,

    selectedFeed:
      null,

    selectedCount:
      0,

    imageAttempts:
      [],

    imageEnrichment: {
      attempted:
        0,

      resolved:
        0
    }
  };

  for (
    const feedUrl of
      feedUrls
  ) {
    try {
      const {
        result,
        feed
      } =
        await parseFeed(
          feedUrl
        );

      const attempt = {
        url:
          feedUrl,

        finalUrl:
          result.finalUrl,

        status:
          result.status,

        contentType:
          result.contentType,

        bytes:
          result.body.length,

        count:
          0,

        latest:
          null
      };

      /*
       * Only accept actual Sankaku
       * article URLs.
       */
      const items =
        (
          feed.items ||
          []
        )
          .map(
            item =>
              normalize(
                item,
                source
              )
          )
          .filter(
            Boolean
          )
          .filter(
            item =>
              realSankakuUrl(
                item.link
              )
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

      diagnostics.feeds.push(
        attempt
      );

      if (
        !items.length
      ) {
        continue;
      }

      /*
       * RSS is authoritative for:
       * title
       * description
       * date
       * link
       *
       * Images may be enriched separately.
       */
      const imageResult =
        await enrichSankakuImages(
          items,
          diagnostics
        );

      diagnostics.imageEnrichment =
        {
          attempted:
            imageResult.attempted,

          resolved:
            imageResult.resolved
        };

      diagnostics.selectedMode =
        /^https?:\/\/rsshub\.app/i.test(
          feedUrl
        )
          ? "rsshub"
          : "official-rss";

      diagnostics.selectedFeed =
        result.finalUrl ||
        feedUrl;

      diagnostics.selectedCount =
        imageResult.items.length;

      return {
        items:
          imageResult.items,

        diagnostics
      };

    } catch (
      error
    ) {
      diagnostics.feeds.push({
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
   * IMPORTANT:
   *
   * Do NOT use:
   * - bootstrap cache
   * - deployed articles.json
   * - previous build data
   * - Recent Posts
   *
   * If every RSS endpoint fails,
   * Sankaku returns zero stories.
   */
  diagnostics.selectedMode =
    "unavailable";

  diagnostics.selectedFeed =
    null;

  diagnostics.selectedCount =
    0;

  return {
    items:
      [],

    diagnostics
  };
}

/*
 * ---------------------------------------------------------
 * Fetch all configured sources
 * ---------------------------------------------------------
 */

const allArticles = [];

const sourceResults = [];

let sankakuDiagnostics =
  null;

for (
  const source of
    SOURCES
) {
  try {
    /*
     * Sankaku is handled separately by sankaku-fix.mjs.
     * Keeping it out of the generic fetch pass avoids
     * duplicate failing requests before the dedicated
     * transport fallback gets a chance.
     */
    if (
      source.id ===
      "sankaku"
    ) {
      continue;
    }

    /*
     * ANN supports a couple of
     * additional RSS endpoints.
     */
    const annFeedUrls =
      source.id ===
      "ann"
        ? [
            ...source.feedUrls,
            "https://www.animenewsnetwork.com/news/rss.xml/",
            "https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us"
          ]
        : source.feedUrls;

    let result = null;
    let feed = null;
    let items = [];

    if (
      source.kind ===
      "html-list"
    ) {
      const parsed =
        await parseJapaneseListingSource(
          source
        );

      result =
        parsed.result;

      items =
        parsed.items
          .map(
            item =>
              normalize(
                item,
                source
              )
          )
          .filter(
            Boolean
          );
    } else if (
      source.kind ===
      "html-merge"
    ) {
      const parsed =
        await parseNatalieSource(
          source
        );

      result =
        parsed.result;

      items =
        parsed.items;
    } else if (
      source.mergeFeeds
    ) {

      const merged = [];

      for (
        const feedUrl of
          source.feedUrls
      ) {
        try {
          const parsed =
            await parseFeed(
              feedUrl
            );

          if (!result) {
            result =
              parsed.result;
          }

          merged.push(
            ...(parsed.feed.items || [])
          );
        } catch (error) {
          console.warn(
            `! ${source.name}: feed unavailable ${feedUrl} — ${
              error?.message ||
              error
            }`
          );
        }
      }

      if (!result) {
        throw new Error(
          "No usable feed"
        );
      }

      feed = {
        items: merged
      };

      items =
        feed.items
          .map(
            item =>
              normalize(
                item,
                source
              )
          )
          .filter(
            Boolean
          );
    } else {
      let lastFeedError = null;

      for (
        const feedUrl of
          annFeedUrls
      ) {
        try {
          const parsed =
            await parseFeed(
              feedUrl
            );

          result =
            parsed.result;

          feed =
            parsed.feed;

          break;
        } catch (error) {
          lastFeedError =
            String(
              error?.message ||
              error
            );
        }
      }

      if (!result || !feed) {
        throw new Error(
          lastFeedError ||
          "No usable feed"
        );
      }

      items =
        feed.items
          .map(
            item =>
              normalize(
                item,
                source
              )
          )
          .filter(
            Boolean
          );
    }

    /*
     * ANN only wants news articles.
     */
    if (
      source.id ===
        "ann" &&
      /\/all\/rss\.xml/i.test(
        result.finalUrl
      )
    ) {
      items =
        items.filter(
          item =>
            /\/news\//i.test(
              item.link
            )
        );
    }

    let imageEnrichment =
      null;

    /*
     * ANN image enrichment.
     */
    if (
      source.id ===
      "ann"
    ) {
      const enrichment =
        await enrichAnn(
          items
        );

      items =
        enrichment.items;

      imageEnrichment = {
        attempted:
          enrichment.attempted,

        resolved:
          enrichment.resolved
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

    allArticles.push(
      ...items
    );

    sourceResults.push({
      id:
        source.id,

      name:
        source.name,

      status:
        "ok",

      mode:
        source.kind === "html-list"
          ? "html-list"
          : source.kind === "html-merge"
            ? "html-merge"
            : "rss",

      feedUrl:
        result.finalUrl,

      count:
        items.length,

      imageEnrichment
    });

  } catch (
    error
  ) {
    sourceResults.push({
      id:
        source.id,

      name:
        source.name,

      status:
        "error",

      mode:
        null,

      count:
        0,

      error:
        String(
          error?.message ||
            error
        )
    });

    console.error(
      `✗ ${source.name}: ${
        error?.message ||
        error
      }`
    );
  }
}


async function translateJapaneseText(
  value
) {
  const text =
    String(value || "").trim();

  if (
    !text ||
    !/[\u3040-\u30ff\u3400-\u9fff]/.test(text)
  ) {
    return text;
  }

  /*
   * Google Translate's internal endpoint is
   * GET-based and avoids the failed public
   * LibreTranslate runner dependency.
   */
  try {
    const url =
      "https://translate.googleapis.com/translate_a/single?" +
      new URLSearchParams({
        client: "gtx",
        sl: "ja",
        tl: "en",
        dt: "t",
        q: text
      }).toString();

    const response =
      await fetch(
        url,
        {
          headers: {
            "user-agent":
              USER_AGENT,
            accept:
              "application/json"
          },
          signal:
            AbortSignal.timeout(
              20000
            )
        }
      );

    if (
      response.ok
    ) {
      const data =
        await response.json();

      const translated =
        Array.isArray(data?.[0])
          ? data[0]
              .map(
                part =>
                  Array.isArray(part)
                    ? String(
                        part[0] || ""
                      )
                    : ""
              )
              .join("")
              .trim()
          : "";

      if (
        translated
      ) {
        return translated;
      }
    }
  } catch {
    /*
     * Continue to fallback.
     */
  }

  /*
   * MyMemory fallback.
   * It has a 500-byte input limit, so
   * only use it when the text is small.
   */
  try {
    const bytes =
      Buffer.byteLength(
        text,
        "utf8"
      );

    if (
      bytes <=
      480
    ) {
      const url =
        "https://api.mymemory.translated.net/get?" +
        new URLSearchParams({
          q: text,
          langpair: "ja|en"
        }).toString();

      const response =
        await fetch(
          url,
          {
            headers: {
              "user-agent":
                USER_AGENT,
              accept:
                "application/json"
            },
            signal:
              AbortSignal.timeout(
                20000
              )
          }
        );

      if (
        response.ok
      ) {
        const data =
          await response.json();

        const translated =
          String(
            data?.responseData
              ?.translatedText ||
            ""
          ).trim();

        if (
          translated &&
          translated !==
            text
        ) {
          return translated;
        }
      }
    }
  } catch {
    /*
     * Keep original Japanese text
     * if every translator fails.
     */
  }

  return text;
}

async function translateJapaneseArticles(
  inputArticles
) {
  const japanese =
    inputArticles.filter(
      article =>
        article.source?.language ===
        "ja"
    );

  if (!japanese.length) {
    return {
      items:
        inputArticles,
      translated:
        0,
      attempted:
        0
    };
  }

  const results =
    new Map();

  let attempted =
    0;

  const queue =
    [
      ...japanese
    ];

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

        const entry =
          {};

        if (
          article.title &&
          /[\u3040-\u30ff\u3400-\u9fff]/.test(
            article.title
          )
        ) {
          attempted++;

          entry.title =
            await translateJapaneseText(
              article.title
            );
        }

        if (
          article.excerpt &&
          /[\u3040-\u30ff\u3400-\u9fff]/.test(
            article.excerpt
          )
        ) {
          attempted++;

          entry.excerpt =
            await translateJapaneseText(
              article.excerpt
            );
        }

        if (
          entry.title ||
          entry.excerpt
        ) {
          results.set(
            article.id,
            entry
          );
        }

        await sleep(
          80
        );
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
      () =>
        worker()
    )
  );

  let translated =
    0;

  const output =
    inputArticles.map(
      article => {
        if (
          article.source?.language !==
          "ja"
        ) {
          return article;
        }

        const value =
          results.get(
            article.id
          );

        if (
          !value
        ) {
          return article;
        }

        const translatedTitle =
          value.title ||
          article.title;

        const translatedExcerpt =
          value.excerpt ||
          article.excerpt;

        if (
          translatedTitle !==
            article.title ||
          translatedExcerpt !==
            article.excerpt
        ) {
          translated++;
        }

        return {
          ...article,
          translatedTitle,
          translatedExcerpt
        };
      }
    );

  return {
    items:
      output,
    translated,
    attempted
  };
}


/*
 * ---------------------------------------------------------
 * Deduplicate
 * ---------------------------------------------------------
 */

const unique =
  new Map();

for (
  const article of
    allArticles
) {
  const key =
    article.link
      .replace(
        /\/+$/,
        ""
      )
      .toLowerCase();

  if (
    !unique.has(
      key
    )
  ) {
    unique.set(
      key,
      article
    );
  }
}

const articles =
  [
    ...unique.values()
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

        if (
          right !==
          left
        ) {
          return (
            right -
            left
          );
        }

        return a.title.localeCompare(
          b.title
        );
      }
    )
    .slice(
      0,
      500
    );


const translationResult =
  await translateJapaneseArticles(
    articles
  );

const translatedArticles =
  translationResult.items;

/*
 * ---------------------------------------------------------
 * Output
 * ---------------------------------------------------------
 */

const payload = {
  generatedAt:
    new Date().toISOString(),

  sources:
    SOURCES.map(
      source => ({
        id:
          source.id,

        name:
          source.name,

        short:
          source.short,

        siteUrl:
          source.siteUrl,

        category:
          source.category,

        accent:
          source.accent,

        language:
          source.language ||
          "en"
      })
    ),

  sourceResults,

  stats: {
    sourceCount:
      SOURCES.length,

    successfulSources:
      sourceResults.filter(
        item =>
          item.status ===
          "ok"
      ).length,

    failedSources:
      sourceResults.filter(
        item =>
          item.status ===
          "error"
      ).length,

    articleCount:
      translatedArticles.length,

    translatedJapaneseArticles:
      translationResult.translated,

    translationAttempts:
      translationResult.attempted
  },

  articles:
    translatedArticles
};

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
        sankakuDiagnostics
    },
    null,
    2
  )
);

console.log(
  `Wrote ${articles.length} unique stories.`
);
