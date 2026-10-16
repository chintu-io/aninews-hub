import fs from "node:fs/promises";

const SITE_URL = "https://aninews-hub.pages.dev/";
const data = JSON.parse(
  await fs.readFile("./site/data/articles.json", "utf8")
);

const rssDir = "./site/rss";
await fs.mkdir(rssDir, { recursive: true });

const activeFeedFiles = new Set([
  "all.xml",
  ...(data.sources || []).map(source => `${source.id}.xml`)
]);
for (const file of await fs.readdir(rssDir)) {
  if (file.endsWith(".xml") && !activeFeedFiles.has(file)) {
    await fs.rm(`${rssDir}/${file}`);
  }
}

const xmlEscape = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const rssDate = value => {
  if (!value) return "";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toUTCString();
};

const imageMime = value => {
  const path = String(value || "").split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".avif")) return "image/avif";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "";
};

const itemXml = article => {
  const mime = imageMime(article.image);
  const image = article.image
    ? `
      <media:content url="${xmlEscape(article.image)}" medium="image"${mime ? ` type="${mime}"` : ""} />
      <media:thumbnail url="${xmlEscape(article.image)}" />`
    : "";
  const publishedDate = rssDate(article.publishedAt);
  const pubDate = publishedDate
    ? `<pubDate>${publishedDate}</pubDate>`
    : "";

  return `
    <item>
      <title>${xmlEscape(article.title)}</title>
      <link>${xmlEscape(article.link)}</link>
      <guid isPermaLink="true">${xmlEscape(article.link)}</guid>
      ${pubDate}
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
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
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
      SITE_URL,
      articles
    )
  );
}
