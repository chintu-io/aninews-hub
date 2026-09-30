# AniNews Hub

A personal static RSS news dashboard for anime, Japan and culture news.

## Sources

- Sankaku Complex — https://www.sankakucomplex.com/feed/
- SoraNews24 — https://soranews24.com/feed/
- Anime News Network — https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us
- Crunchyroll News — https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss

The site keeps normalized RSS metadata: headline, date, source, short excerpt, optional RSS image URL, and the original article link. It does not republish full articles.

## Deploy

1. Upload this project to a GitHub repository.
2. In **Settings → Pages**, select **GitHub Actions**.
3. Run **Actions → Refresh RSS news** once manually.
4. The workflow runs every 30 minutes and deploys the latest local feed data to GitHub Pages.

## Credits

Every story displays its publisher and links to the original article. Article text, images, trademarks and branding remain with their respective owners.
