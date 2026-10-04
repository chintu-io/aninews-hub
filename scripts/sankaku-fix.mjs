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

const parser = new Parser({
  timeout: 30000
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

  if (text.length <= 300) {
    return text;
  }

  return `${text.slice(0, 297).trimEnd()}…`;
}

function cleanTitle(value = "") {
  const title = stripHtml(value)
    .replace(/^#+\s*/, "")
    .trim();

  if (!title) return "";

  if (
    /^(?:add\s+comment|\d+\s+comments?)$/i.test(title)
  ) {
    return "";
  }

  if (/^just a moment/i.test(title)) {
    return "";
  }

  if (
    /^sankaku companions are the friends you need!?$/i.test(
      title
    )
  ) {
    return "";
  }

  if (
    /^create infinite art with sankaku ai$/i.test(
      title
    )
  ) {
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

async function fetchText(
  url,
  options = {}
) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",

      accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, text/plain, */*",

      ...(options.headers || {})
    },

    redirect: "follow",

    signal: AbortSignal.timeout(
      options.timeout ?? 40000
    )
  });

  return {
    status: response.status,
    finalUrl: response.url,
    contentType:
      response.headers.get(
        "content-type"
      ) || "",
    body: await response.text()
  };
}

function parseRelativeDate(
  text,
  index
) {
  const input = String(text);

  const window = input.slice(
    Math.max(0, index - 350),
    Math.min(
      input.length,
      index + 800
    )
  );

  if (
    /\bjust\s+now\b/i.test(
      window
    )
  ) {
    return new Date().toISOString();
  }

  const relative =
    window.match(
      /\b(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b/i
    );

  if (relative) {
    const amount =
      Number(relative[1]);

    const unit =
      relative[2].toLowerCase();

    const seconds =
      unit.startsWith("minute")
        ? amount * 60
        : unit.startsWith("hour")
          ? amount * 3600
          : unit.startsWith("day")
            ? amount * 86400
            : amount * 604800;

    return new Date(
      Date.now() -
        seconds * 1000
    ).toISOString();
  }

  const absolute =
    window.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}\b/i
    );

  if (absolute) {
    return toIso(
      absolute[0].replace(
        /(\d+)(st|nd|rd|th)/i,
        "$1"
      )
    );
  }

  const iso =
    window.match(
      /\b20\d{2}-\d{2}-\d{2}(?:[T ][0-9:.+\-Z]+)?\b/
    );

  if (iso) {
    return toIso(
      iso[0]
    );
  }

  return null;
}

function normalizeFeedItem(
  item
) {
  const link =
    item.link ||
    item.guid ||
    "";

  if (!realSankakuUrl(link)) {
    return null;
  }

  const publishedAt =
    toIso(item.isoDate) ||
    toIso(item.pubDate) ||
    toIso(item.published) ||
    toIso(item.updated);

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

    publishedAt,

    excerpt: excerpt(
      item.contentSnippet ||
        item.content ||
        item.summary ||
        item.description ||
        ""
    ),

    image: "",

    source: {
      ...SOURCE
    }
  };
}

function parseRecentListing(
  markdown
) {
  const text =
    String(markdown || "");

  const items =
    new Map();

  const add = (
    title,
    link,
    position
  ) => {
    const cleanLink =
      String(link || "")
        .replace(
          /[?#].*$/,
          ""
        );

    const clean =
      cleanTitle(title);

    if (
      !cleanLink ||
      !realSankakuUrl(
        cleanLink
      ) ||
      !clean
    ) {
      return;
    }

    const publishedAt =
      parseRelativeDate(
        text,
        position
      );

    if (!publishedAt) {
      return;
    }

    const existing =
      items.get(cleanLink);

    if (
      !existing ||
      clean.length >
        existing.title.length
    ) {
      items.set(
        cleanLink,
        {
          id: hash(
            `sankaku|${cleanLink}`
          ),

          title: clean,

          link: cleanLink,

          publishedAt,

          excerpt: "",

          image: "",

          source: {
            ...SOURCE
          },

          position
        }
      );
    }
  };

  /*
   * Markdown links:
   *
   * [Title](https://news.sankakucomplex.com/n/...)
   */
  for (
    const match of text.matchAll(
      /\[([^\]]{1,300})\]\((https?:\/\/news\.sankakucomplex\.com\/n\/[^)\s]+)\)/gi
    )
  ) {
    add(
      match[1],
      match[2],
      match.index
    );
  }

  /*
   * HTML anchors:
   *
   * <a href=".../n/...">Title</a>
   */
  for (
    const match of text.matchAll(
      /<a\b[^>]*href=["'](https?:\/\/news\.sankakucomplex\.com\/n\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    )
  ) {
    add(
      match[2],
      match[1],
      match.index
    );
  }

  /*
   * Plain article URLs with a nearby heading.
   */
  for (
    const match of text.matchAll(
      /https?:\/\/news\.sankakucomplex\.com\/n\/[A-Za-z0-9_-]+/gi
    )
  ) {
    const link =
      match[0];

    const start =
      Math.max(
        0,
        match.index - 600
      );

    const end =
      Math.min(
        text.length,
        match.index + 600
      );

    const nearby =
      text.slice(
        start,
        end
      );

    const headings = [
      ...nearby.matchAll(
        /^\s*#{1,6}\s+(.+?)\s*$/gm
      )
    ]
      .map(
        item =>
          cleanTitle(
            item[1]
          )
      )
      .filter(
        title =>
          title.length >= 20
      );

    if (
      headings[0]
    ) {
      add(
        headings[0],
        link,
        match.index
      );
    }
  }

  return [
    ...items.values()
  ]
    .sort(
      (a, b) =>
        Date.parse(
          b.publishedAt
        ) -
        Date.parse(
          a.publishedAt
        )
    );
}

function articleMetadata(
  markdown
) {
  const text =
    String(markdown || "");

  const title =
    cleanTitle(
      text.match(
        /^\s*#\s+(.+?)\s*$/m
      )?.[1] || ""
    ) ||
    cleanTitle(
      text.match(
        /^\s*Title:\s*(.+?)\s*$/im
      )?.[1] || ""
    );

  const publishedRaw =
    text.match(
      /^\s*Published Time:\s*(.+?)\s*$/im
    )?.[1] ||
    text.match(
      /^\s*Published:\s*(.+?)\s*$/im
    )?.[1] ||
    "";

  const publishedAt =
    toIso(
      stripHtml(
        publishedRaw
      )
    );

  const images = [];

  for (
    const match of text.matchAll(
      /!\[[^\]]*\]\(<?([^)\s>]+)>?\)/gi
    )
  ) {
    if (
      /^https?:\/\//i.test(
        match[1]
      )
    ) {
      images.push(
        match[1]
      );
    }
  }

  for (
    const match of text.matchAll(
      /<img\b[^>]*(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/gi
    )
  ) {
    if (
      /^https?:\/\//i.test(
        match[1]
      )
    ) {
      images.push(
        match[1]
      );
    }
  }

  const image =
    images.find(
      url =>
        /\/wp-content\/uploads\//i.test(
          url
        )
    ) ||
    images[0] ||
    "";

  const body =
    text.split(
      /^Markdown Content:\s*$/im
    )[1] ||
    text;

  let summary = "";

  for (
    const line of body.split(
      /\r?\n/
    )
  ) {
    const cleaned =
      stripHtml(line).trim();

    if (
      !cleaned ||
      cleaned === title ||
      cleaned.startsWith("#") ||
      cleaned.length < 70 ||
      /^https?:\/\//i.test(
        cleaned
      ) ||
      /^(?:add\s+comment|\d+\s+comments?)$/i.test(
        cleaned
      ) ||
      /^\[.*\]\(https?:/i.test(
        cleaned
      )
    ) {
      continue;
    }

    summary =
      excerpt(
        cleaned
      );

    break;
  }

  return {
    title,
    publishedAt,
    excerpt: summary,
    image
  };
}

async function enrichOne(
  item
) {
  const articleId =
    item.link.split(
      "/n/"
    )[1];

  if (!articleId) {
    return item;
  }

  /*
   * Direct Sankaku article requests are
   * unreliable from GitHub Actions.
   *
   * Use Jina only for metadata enrichment.
   */
  const readerUrl =
    `https://r.jina.ai/http://news.sankakucomplex.com/n/${encodeURIComponent(articleId)}?t=${Date.now()}`;

  try {
    const result =
      await fetchText(
        readerUrl,
        {
          timeout: 40000,

          headers: {
            "x-no-cache":
              "true",

            "x-cache-tolerance":
              "0"
          }
        }
      );

    if (
      result.status >= 200 &&
      result.status < 300 &&
      result.body.length > 200
    ) {
      const meta =
        articleMetadata(
          result.body
        );

      return {
        ...item,

        title:
          meta.title ||
          item.title,

        publishedAt:
          meta.publishedAt ||
          item.publishedAt,

        excerpt:
          meta.excerpt ||
          item.excerpt,

        image:
          meta.image ||
          item.image
      };
    }
  } catch {
    /*
     * Listing metadata is still usable.
     */
  }

  return item;
}

async function enrichItems(
  items,
  limit = 45
) {
  const queue =
    items.slice(
      0,
      limit
    );

  const results = [];

  const worker = async () => {
    while (
      queue.length
    ) {
      const item =
        queue.shift();

      if (!item) {
        return;
      }

      results.push(
        await enrichOne(
          item
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
            queue.length || 1
          )
      },
      worker
    )
  );

  return results;
}

/*
 * Merge only a small recent window.
 *
 * This is the key fix.
 *
 * Previously every old Sankaku item in the cache
 * was merged back into the new feed, which allowed
 * old/stale/2024 entries to reappear.
 */
function mergeRecent(
  existing,
  fresh,
  days = 8
) {
  const freshDates =
    fresh
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
    !freshDates.length
  ) {
    return fresh;
  }

  const newest =
    Math.max(
      ...freshDates
    );

  const cutoff =
    newest -
    days *
      86400000;

  const existingRecent =
    existing.filter(
      item => {
        const date =
          Date.parse(
            item.publishedAt ||
              ""
          );

        return (
          Number.isFinite(
            date
          ) &&
          date >= cutoff
        );
      }
    );

  const byLink =
    new Map();

  for (
    const item of [
      ...existingRecent,
      ...fresh
    ]
  ) {
    if (
      !realSankakuUrl(
        item.link
      )
    ) {
      continue;
    }

    const key =
      item.link
        .replace(
          /\/+$/,
          ""
        )
        .toLowerCase();

    const current =
      byLink.get(key);

    if (!current) {
      byLink.set(
        key,
        {
          ...item,
          source: {
            ...SOURCE
          }
        }
      );

      continue;
    }

    byLink.set(
      key,
      {
        ...current,
        ...item,

        title:
          item.title &&
          item.title !==
            "Sankaku Complex article"
            ? item.title
            : current.title,

        excerpt:
          item.excerpt ||
          current.excerpt ||
          "",

        image:
          item.image ||
          current.image ||
          "",

        publishedAt:
          item.publishedAt ||
          current.publishedAt ||
          null,

        source: {
          ...SOURCE
        }
      }
    );
  }

  return [
    ...byLink.values()
  ]
    .filter(
      item =>
        realSankakuUrl(
          item.link
        ) &&
        item.title &&
        item.title !==
          "Sankaku Complex article"
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

        return right - left;
      }
    )
    .slice(
      0,
      60
    );
}

const debug = {
  generatedAt:
    new Date().toISOString(),

  officialRss: [],

  recentListing: null,

  mode:
    "unchanged",

  freshCount:
    0,

  selectedCount:
    0,

  newest:
    null,

  oldest:
    null
};

const payload =
  JSON.parse(
    await fs.readFile(
      OUT,
      "utf8"
    )
  );

const allExisting =
  Array.isArray(
    payload.articles
  )
    ? payload.articles
    : [];

const existingSankaku =
  allExisting.filter(
    item =>
      item?.source?.id ===
        "sankaku" &&
      realSankakuUrl(
        item.link
      )
  );

const otherArticles =
  allExisting.filter(
    item =>
      item?.source?.id !==
        "sankaku"
  );

let fresh = [];

/*
 * ----------------------------------------------------
 * STEP 1
 * Official RSS
 *
 * Only use it when it is genuinely current.
 * ----------------------------------------------------
 */

const rssUrls = [
  "https://news.sankakucomplex.com/feed/",
  "https://news.sankakucomplex.com/?feed=rss2",
  "https://www.sankakucomplex.com/feed/"
];

for (
  const url of rssUrls
) {
  try {
    const result =
      await fetchText(
        url,
        {
          timeout: 30000
        }
      );

    debug.officialRss.push(
      {
        url,

        status:
          result.status,

        finalUrl:
          result.finalUrl,

        contentType:
          result.contentType,

        bytes:
          result.body.length
      }
    );

    if (
      result.status < 200 ||
      result.status >= 300 ||
      !result.body.trim()
    ) {
      continue;
    }

    const feed =
      await parser.parseString(
        result.body
      );

    const items =
      (
        feed.items || []
      )
        .map(
          normalizeFeedItem
        )
        .filter(Boolean);

    if (
      !items.length
    ) {
      continue;
    }

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

    const latest =
      dates.length
        ? Math.max(
            ...dates
          )
        : 0;

    const ageHours =
      latest
        ? (
            Date.now() -
            latest
          ) / 3600000
        : Infinity;

    /*
     * RSS must be less than 18 hours old.
     * Sankaku can publish several stories in a day,
     * so a multi-day-old RSS feed is considered stale.
     */
    if (
      ageHours <= 18
    ) {
      fresh =
        items.slice(
          0,
          50
        );

      debug.mode =
        "official-rss";

      break;
    }

    debug.officialRss[
      debug.officialRss.length - 1
    ].staleHours =
      Number(
        ageHours.toFixed(
          2
        )
      );
  } catch (
    error
  ) {
    debug.officialRss.push(
      {
        url,

        error:
          String(
            error?.message ||
              error
          )
      }
    );
  }
}

/*
 * ----------------------------------------------------
 * STEP 2
 * Current Recent Posts listing
 *
 * Used when RSS is stale.
 * ----------------------------------------------------
 */

if (
  !fresh.length
) {
  const listingUrl =
    `https://r.jina.ai/http://news.sankakucomplex.com/recent-posts/?t=${Date.now()}`;

  try {
    const result =
      await fetchText(
        listingUrl,
        {
          timeout: 40000,

          headers: {
            "x-no-cache":
              "true",

            "x-cache-tolerance":
              "0"
          }
        }
      );

    debug.recentListing = {
      url:
        listingUrl,

      status:
        result.status,

      finalUrl:
        result.finalUrl,

      contentType:
        result.contentType,

      bytes:
        result.body.length
    };

    if (
      result.status >= 200 &&
      result.status < 300 &&
      result.body.length >
        500
    ) {
      const candidates =
        parseRecentListing(
          result.body
        );

      debug.recentListing
        .candidateCount =
        candidates.length;

      fresh =
        await enrichItems(
          candidates,
          45
        );

      debug.recentListing
        .enrichedCount =
        fresh.length;

      if (
        fresh.length
      ) {
        debug.mode =
          "recent-posts-jina";
      }
    }
  } catch (
    error
  ) {
    debug.recentListing = {
      url:
        listingUrl,

      error:
        String(
          error?.message ||
            error
        )
    };
  }
}

/*
 * ----------------------------------------------------
 * STEP 3
 * Build the final Sankaku list.
 *
 * Important:
 * We ONLY retain existing articles within 8 days
 * of the newest fresh article.
 *
 * This kills the old 2024/stale cache problem.
 * ----------------------------------------------------
 */

if (
  fresh.length
) {
  const sankakuArticles =
    mergeRecent(
      existingSankaku,
      fresh,
      8
    );

  const dates =
    sankakuArticles
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

  debug.freshCount =
    fresh.length;

  debug.selectedCount =
    sankakuArticles.length;

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
      ...otherArticles,
      ...sankakuArticles
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
      debug.mode;

    sourceResult.count =
      sankakuArticles.length;

    sourceResult.feedUrl =
      debug.mode ===
      "official-rss"
        ? "https://news.sankakucomplex.com/feed/"
        : "https://news.sankakucomplex.com/recent-posts/";
  }
} else {
  /*
   * --------------------------------------------------
   * Total failure fallback.
   *
   * Never restore arbitrary ancient Sankaku rows.
   * Keep only the last 30 days.
   * --------------------------------------------------
   */

  const cutoff =
    Date.now() -
    30 *
      86400000;

  const preserved =
    existingSankaku
      .filter(
        item => {
          const date =
            Date.parse(
              item.publishedAt ||
                ""
            );

          return (
            Number.isFinite(
              date
            ) &&
            date >= cutoff &&
            item.title &&
            item.title !==
              "Sankaku Complex article"
          );
        }
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

          return right - left;
        }
      )
      .slice(
        0,
        60
      );

  payload.articles =
    [
      ...otherArticles,
      ...preserved
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

          return right - left;
        }
      )
      .slice(
        0,
        500
      );

  debug.mode =
    "existing-sankaku-recent-fallback";

  debug.selectedCount =
    preserved.length;
}

/*
 * ----------------------------------------------------
 * Stats/debug
 * ----------------------------------------------------
 */

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
  `Sankaku refresh: ${debug.mode}; ${debug.selectedCount} stories.`
);
