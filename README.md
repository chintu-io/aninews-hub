# [AniNews Hub](https://chintune.github.io/aninews-hub/)

A personal RSS reader for anime, Japan and culture news.

## Sources

- Sankaku Complex — https://news.sankakucomplex.com/
- SoraNews24 — https://soranews24.com/
- Anime News Network — https://www.animenewsnetwork.com/news/
- Crunchyroll News — https://www.crunchyroll.com/news

The reader uses the publishers' feeds and sends each story to the original publisher.

## Updating

GitHub Actions refreshes the feed data every 30 minutes and deploys the site to GitHub Pages.

## Credits

Stories remain the property of their respective publishers. Full articles are not republished. Each story identifies its source and opens the original publisher's page whenever the feed provides a direct article link.

## Seedbox refresh

For predictable 30-minute updates, feed fetching and RSS generation can run on your always-on seedbox. GitHub Actions is used only to deploy the already-generated `site/` files to GitHub Pages.

### One-time seedbox setup

Clone the repository somewhere such as `~/aninews-hub`, install dependencies with `npm ci`, then make `scripts/seedbox-refresh.sh` executable:

```bash
chmod +x ~/aninews-hub/scripts/seedbox-refresh.sh
```

The refresh script runs the complete pipeline:

```
fetch feeds → refresh Sankaku → generate RSS → commit generated files → push to main
```

Configure a GitHub SSH deploy key with write access to this repository, then test:

```~/aninews-hub/scripts/seedbox-refresh.sh```

Finally add a user cron entry:

```cron
*/30 * * * * $HOME/aninews-hub/scripts/seedbox-refresh.sh >> $HOME/aninews-hub/seedbox-refresh.log 2>&1
```

The script only pushes when generated data changes, so an unchanged feed does not create a GitHub deployment.
