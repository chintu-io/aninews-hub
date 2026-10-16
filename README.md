# AniNews Hub

AniNews Hub is an anime-inspired reader for anime, manga, Japanese culture, and music news. It brings publisher headlines and excerpts together while linking readers to each publisher for the full story.

🌐 **Website:** [aninews-hub.pages.dev](https://aninews-hub.pages.dev/)

## Publishers

The homepage lists publishers in this order:

1. Crunchyroll News
2. Anime News Network (ANN)
3. MyAnimeList (MAL)
4. SoraNews24
5. Sankaku Complex
6. BARKS
7. Billboard JAPAN
8. OTOTOY

Kotaku is not included.

## Features

- Anime-inspired magazine design with responsive card grid and compact list views
- Rolling 14-day story archive, capped at 1,000 articles
- Search, publisher and language filters, category tabs, sorting, and pagination
- Bookmarks and read-story tracking saved in the browser
- Dark and light themes
- Japanese-language story translations when available
- Combined RSS feed and an RSS feed for each publisher
- Direct links to the original publisher; full articles remain on their source websites

## Refresh and deployment

A seedbox refresh runs every 30 minutes. It fetches the configured publisher feeds, merges recent stories into the archive, processes Sankaku stories, generates the RSS files, and validates the output. When generated data changes, the seedbox commits it to `main`; a GitHub Actions workflow then deploys the `site/` directory.

The archive keeps stories published within the last 14 days, subject to the 1,000-article cap. Its history accumulates over successive successful refreshes.

## RSS feeds

- [All publishers](https://aninews-hub.pages.dev/rss/all.xml)
- [Crunchyroll News](https://aninews-hub.pages.dev/rss/crunchyroll.xml)
- [Anime News Network](https://aninews-hub.pages.dev/rss/ann.xml)
- [MyAnimeList](https://aninews-hub.pages.dev/rss/mal.xml)
- [SoraNews24](https://aninews-hub.pages.dev/rss/soranews24.xml)
- [Sankaku Complex](https://aninews-hub.pages.dev/rss/sankaku.xml)
- [BARKS](https://aninews-hub.pages.dev/rss/barks.xml)
- [Billboard JAPAN](https://aninews-hub.pages.dev/rss/billboardjapan.xml)
- [OTOTOY](https://aninews-hub.pages.dev/rss/ototoy.xml)

## Run a refresh locally

Requirements: Node.js 22 or newer and npm.

```sh
npm ci
npm run fetch
node scripts/sankaku-fix.mjs
npm run generate:rss
npm run validate
```

`npm run validate` checks article IDs and links, source membership, ordering, article limits, and the combined and per-publisher RSS feeds.

## Repository layout

- `site/` — static website, generated article data, and RSS feeds
- `scripts/` — publisher collection, archive, RSS generation, and validation
- `.github/workflows/` — GitHub Actions checks and Pages deployment

> AniNews Hub aggregates headlines, excerpts, and images. Stories remain the property of their respective publishers; readers are sent to the original source for the full article.

