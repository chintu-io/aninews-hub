# AniNews Hub

A personal RSS reader for anime, Japan and culture news.

## Sources

- Sankaku Complex — https://news.sankakucomplex.com/
- SoraNews24 — https://soranews24.com/
- Anime News Network — https://www.animenewsnetwork.com/news/
- Crunchyroll News — https://www.crunchyroll.com/news

The reader uses the publishers' feeds and sends each story to the original publisher. Sankaku Complex's current feed endpoint rejects GitHub-hosted requests, so the updater tries the direct feed first and falls back to a site-restricted Google News RSS query when necessary.

## Updating

GitHub Actions refreshes the feed data every 30 minutes and deploys the site to GitHub Pages.

For Sankaku troubleshooting, run `npm run debug:sankaku`.

## Credits

Stories remain the property of their respective publishers. Full articles are not republished. Each story identifies its source and opens the original publisher's page whenever the feed provides a direct article link.
