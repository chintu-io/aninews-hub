export const SOURCES = [
  {
    id: "sankaku",
    name: "Sankaku Complex",
    short: "Sankaku",
    feedUrls: [
      "https://www.sankakucomplex.com/feed/",
      "https://www.sankakucomplex.com/?feed=rss2",
      "https://news.sankakucomplex.com/feed/",
      "https://news.sankakucomplex.com/?feed=rss2"
    ],
    siteUrl: "https://news.sankakucomplex.com/",
    category: "Anime & Culture",
    accent: "#a78bfa",
    language: "en"
  },
  {
    id: "soranews24",
    name: "SoraNews24",
    short: "SoraNews",
    feedUrls: [
      "https://soranews24.com/feed/"
    ],
    siteUrl: "https://soranews24.com/",
    category: "Japan",
    accent: "#6fc9e6",
    language: "en"
  },
  {
    id: "ann",
    name: "Anime News Network",
    short: "ANN",
    feedUrls: [
      "https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us"
    ],
    siteUrl: "https://www.animenewsnetwork.com/news/",
    category: "Anime News",
    accent: "#ffb45f",
    enrichImages: true,
    language: "en"
  },
  {
    id: "crunchyroll",
    name: "Crunchyroll News",
    short: "Crunchyroll",
    feedUrls: [
      "https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss"
    ],
    siteUrl: "https://www.crunchyroll.com/news",
    category: "Anime News",
    accent: "#ff6784",
    language: "en"
  },
  {
    id: "mal",
    name: "MyAnimeList",
    short: "MAL",
    feedUrls: [
      "https://myanimelist.net/rss/news.xml"
    ],
    siteUrl: "https://myanimelist.net/news",
    category: "Anime News",
    accent: "#5ca8ff",
    language: "en"
  },
  {
    id: "kotaku",
    name: "Kotaku",
    short: "Kotaku",
    feedUrls: [
      "https://kotaku.com/feed"
    ],
    siteUrl: "https://kotaku.com/",
    category: "Gaming & Culture",
    accent: "#ff6b9d",
    language: "en"
  },

  {
    id: "billboardjapan",
    name: "Billboard JAPAN",
    short: "Billboard JP",
    feedUrls: [
      "https://www.billboard-japan.com/d_news/"
    ],
    siteUrl: "https://www.billboard-japan.com/d_news/",
    category: "Japanese Music",
    accent: "#7dd7ff",
    language: "ja",
    kind: "html-list",
    articlePattern: "^https://www\\.billboard-japan\\.com/d_news/detail/[0-9]+/?$"
  },
  {
    id: "barks",
    name: "BARKS",
    short: "BARKS",
    feedUrls: [
      "https://barks.jp/tag/news/feed/"
    ],
    siteUrl: "https://barks.jp/tag/news/",
    category: "Japanese Music",
    accent: "#ff9f78",
    language: "ja"
  },
  {
    id: "ototoy",
    name: "OTOTOY",
    short: "OTOTOY",
    feedUrls: [
      "https://ototoy.jp/news/feed.rss"
    ],
    siteUrl: "https://ototoy.jp/news/",
    category: "Japanese Music",
    accent: "#e6a4ff",
    language: "ja",
    mergeFeeds: false
  },
];
