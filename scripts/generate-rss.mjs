import fs from "node:fs/promises";

const SITE_URL = "https://chintu-io.github.io/aninews-hub/";
const data = JSON.parse(
  await fs.readFile("./site/data/articles.json", "utf8")
);

const rssDir = "./site/rss";
await fs.mkdir(rssDir, { recursive: true });

const xmlEscape = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const rssDate = value => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toUTCString()
    : date.toUTCString();
};

const imageMime = value => {
  const path = String(value || "").split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
};

const itemXml = article => {
  const image = article.image
    ? `
      <media:content url="${xmlEscape(article.image)}" medium="image" type="${imageMime(article.image)}" />
      <media:thumbnail url="${xmlEscape(article.image)}" />`
    : "";

  return `
    <item>
      <title>${xmlEscape(article.title)}</title>
      <link>${xmlEscape(article.link)}</link>
      <guid isPermaLink="true">${xmlEscape(article.link)}</guid>
      <pubDate>${rssDate(article.publishedAt)}</pubDate>
      <description>${xmlEscape(article.excerpt || "")}</description>
      <category>${xmlEscape(article.source?.name || "News")}</category>
      ${image}
    </item>`;
};

const buildFeed = (title, description, channelLink, articles) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xmlEscape(title)}</title>
    <link>${xmlEscape(channelLink)}</link>
    <description>${xmlEscape(description)}</description>
    <lastBuildDate>${rssDate(new Date())}</lastBuildDate>
    <ttl>30</ttl>
    ${articles.map(itemXml).join("\n")}
  </channel>
</rss>
`;

await fs.writeFile(
  `${rssDir}/all.xml`,
  buildFeed(
    "AniNews Hub — All Sources",
    "Combined anime, Japan and culture news from AniNews Hub.",
    SITE_URL,
    data.articles || []
  )
);

for (const source of data.sources || []) {
  const articles = (data.articles || []).filter(
    article => article.source?.id === source.id
  );

  await fs.writeFile(
    `${rssDir}/${source.id}.xml`,
    buildFeed(
      `${source.name} — AniNews Hub RSS`,
      `Latest stories from ${source.name} through AniNews Hub.`,
      source.siteUrl || SITE_URL,
      articles
    )
  );
}
