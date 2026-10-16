export const ARTICLE_RETENTION_DAYS = 14;
export const MAX_ARTICLES = 1000;

const RETENTION_MS = ARTICLE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const canonicalLink = value =>
  String(value || "").replace(/\/+$/, "").toLowerCase();

const isWithinRetention = (article, now) => {
  const publishedAt = Date.parse(article?.publishedAt || "");
  return Number.isFinite(publishedAt) &&
    publishedAt >= now - RETENTION_MS &&
    publishedAt <= now + 24 * 60 * 60 * 1000;
};

const newestFirst = (a, b) => {
  const left = Date.parse(a.publishedAt || "") || 0;
  const right = Date.parse(b.publishedAt || "") || 0;
  return right - left || String(a.title || "").localeCompare(String(b.title || ""));
};

export function mergeArticleArchive({
  currentArticles = [],
  previousArticles = [],
  activeSourceIds,
  failedSourceIds = new Set(),
  now = Date.now()
}) {
  const activeSources = new Set(activeSourceIds || []);
  const merged = new Map();

  for (const article of currentArticles) {
    if (!article || !activeSources.has(article.source?.id)) continue;
    if (!isWithinRetention(article, now)) continue;

    const key = canonicalLink(article.link);
    if (key && !merged.has(key)) merged.set(key, article);
  }

  for (const article of previousArticles) {
    if (!article || !activeSources.has(article.source?.id)) continue;
    if (!isWithinRetention(article, now)) continue;

    const key = canonicalLink(article.link);
    if (!key || merged.has(key)) continue;

    const archived = { ...article };
    if (failedSourceIds.has(article.source.id)) {
      archived.stale = true;
    } else {
      delete archived.stale;
    }
    merged.set(key, archived);
  }

  return [...merged.values()].sort(newestFirst).slice(0, MAX_ARTICLES);
}
