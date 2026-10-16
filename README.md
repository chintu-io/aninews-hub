# AniNews Hub

### Anime, Japan, and culture news in one place.

Follow the stories shaping anime, manga, Japanese culture, and music. AniNews Hub brings fresh headlines and previews from trusted publishers into one easy-to-browse news reader, with every story linking back to its original source.

**[Visit AniNews Hub →](https://aninews-hub.pages.dev/)**

## The latest from the publishers you follow

Read news from **Crunchyroll News**, **Anime News Network**, **MyAnimeList**, **SoraNews24**, **Sankaku Complex**, **BARKS**, **Billboard JAPAN**, and **OTOTOY**.

Explore anime and manga announcements, Japan and everyday life, gaming and technology, and Japanese music—all in one place.

## Made for your daily read

- Browse a rolling library of recent stories, with articles kept for up to 14 days
- Switch between image-rich cards and a compact list
- Search headlines and filter by topic, publisher, or language
- Save stories to revisit and keep track of what you’ve read
- Choose a light or dark theme
- Read Japanese-language coverage with English translations when available
- Follow the combined feed or subscribe to an individual publisher feed

News is refreshed throughout the day, about every 30 minutes. When new stories arrive, the website updates with them.

## Android app

The `android/` folder contains a native Android shell around the news reader. The home screen loads the live website, so site and feed updates appear without rebuilding the app; the copy packaged in the APK is an offline fallback. On first launch after switching from the bundled home screen to the live site, saved theme, bookmarks, and read-story preferences are copied to the live site origin. Publisher articles open in an in-app browser without losing the feed position. The launcher mark matches the site wordmark, and notification preferences can cover all publishers or selected publishers while following the site's light or dark theme.

Notifications are checked on-device with Android WorkManager about every 30 minutes. Android may delay background work because of battery or network conditions. This does not use Firebase or a push-notification server, so alerts are not instant. Android 13 and newer ask for notification permission when the user saves an enabled subscription.

To open the Android project, open the `android/` folder in Android Studio. To build a local debug APK from a command prompt, run `gradlew.bat :app:assembleDebug` from that folder. Android Studio/Gradle needs a JDK 17 or newer runtime and will resolve the Gradle and AndroidX dependencies on first sync. The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

### Android releases

Pushing a tag named `android-v1.0.0` (with the desired version) starts `.github/workflows/android-release.yml`, which builds and attaches a signed APK to a GitHub Release. Before the first tag, add these repository Actions secrets under **Settings → Secrets and variables → Actions**:

- `ANDROID_SIGNING_KEYSTORE_BASE64` — base64 contents of the signing keystore
- `ANDROID_SIGNING_KEYSTORE_PASSWORD`
- `ANDROID_SIGNING_KEY_ALIAS`
- `ANDROID_SIGNING_KEY_PASSWORD`

For upgrades to the APK already installed from this project, keep using the same private keystore that signed it. The local keystore is `work/android-debug.keystore` (ignored by Git); back it up securely and never commit or publish it. In PowerShell, copy its base64 value to the clipboard with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("work\android-debug.keystore")) | Set-Clipboard
```

Paste that value into `ANDROID_SIGNING_KEYSTORE_BASE64`. This existing key uses alias `androiddebugkey` and the default Android debug store/key password `android`; enter those for the other three secrets. The release workflow keeps its signing key private, verifies the APK, and creates a monotonically increasing Android version code for each new tag.

## Follow the stories with RSS

- [All AniNews Hub stories](https://aninews-hub.pages.dev/rss/all.xml)
- [Crunchyroll News](https://aninews-hub.pages.dev/rss/crunchyroll.xml)
- [Anime News Network](https://aninews-hub.pages.dev/rss/ann.xml)
- [MyAnimeList](https://aninews-hub.pages.dev/rss/mal.xml)
- [SoraNews24](https://aninews-hub.pages.dev/rss/soranews24.xml)
- [Sankaku Complex](https://aninews-hub.pages.dev/rss/sankaku.xml)
- [BARKS](https://aninews-hub.pages.dev/rss/barks.xml)
- [Billboard JAPAN](https://aninews-hub.pages.dev/rss/billboardjapan.xml)
- [OTOTOY](https://aninews-hub.pages.dev/rss/ototoy.xml)

AniNews Hub brings together headlines, previews, and images for discovery. Full stories are published by and remain the property of their original publishers.
