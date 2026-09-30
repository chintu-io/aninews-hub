import Parser from "rss-parser";

const parser = new Parser({ timeout: 25000 });

const urls = [
  "https://news.sankakucomplex.com/feed/",
  "https://news.sankakucomplex.com/?feed=rss2",
  "https://news.sankakucomplex.com/recent-posts/",
  "https://news.sankakucomplex.com/wp-json/wp/v2/posts?per_page=10",
  "https://www.sankakucomplex.com/feed/",
  "https://rsshub.app/sankakucomplex/post",
  "https://news.google.com/rss/search?q=site%3Anews.sankakucomplex.com&hl=en-US&gl=US&ceid=US:en"
];

const headers = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
  accept:
    "application/rss+xml, application/atom+xml, application/xml, text/html, application/json, */*"
};

for (const url of urls) {
  console.log(`\n=== ${url} ===`);

  try {
    const response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(25000)
    });

    const type = response.headers.get("content-type") || "";
    const body = await response.text();

    console.log(`status: ${response.status}`);
    console.log(`finalUrl: ${response.url}`);
    console.log(`content-type: ${type}`);
    console.log(`bytes: ${body.length}`);
    console.log(
      `sample: ${body.replace(/\s+/g, " ").slice(0, 240)}`
    );

    if (response.ok && /xml|rss|atom/i.test(type)) {
      try {
        const feed = await parser.parseString(body);

        console.log(`items: ${feed.items?.length ?? 0}`);

        for (const item of (feed.items || []).slice(0, 5)) {
          console.log(` - ${item.title || "(untitled)"}`);
          console.log(
            `   ${item.isoDate || item.pubDate || "(no date)"}`
          );
          console.log(
            `   ${item.link || item.guid || "(no link)"}`
          );
        }
      } catch (error) {
        console.log(`parser: ${error?.message || error}`);
      }
    }
  } catch (error) {
    console.log(`request: ${error?.message || error}`);
  }
}
