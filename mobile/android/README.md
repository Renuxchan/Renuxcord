# Renuxcord for Android

An Android app that opens Discord's web app with Renuxcord loaded into it, so the same plugins run on your phone.
It downloads Renuxcord (`browser.js` and `browser.css`) from the `devbuild` release and keeps it up to date by itself.

Based on [Vendroid](https://github.com/Vencord/Vendroid) by Vendicated and contributors, licensed under the
GPL-3.0 (see [LICENSE](LICENSE)). Renuxcord's changes: its own package (`dev.renuxcord.app`), name, icon and update
source.

## Install

Download **Renuxcord.apk** from the [latest release](https://github.com/Renuxchan/Renuxcord/releases/tag/devbuild),
open it and allow your browser or file manager to install apps when Android asks. Needs Android 8 or newer.

## Build

```sh
cd mobile/android
./gradlew assembleRelease
```

The APK lands in `app/build/outputs/apk/release/`. CI signs release builds with the key in the repository's
secrets (`RENUXCORD_KEYSTORE*`), so new APKs install over old ones. Builds without it use the debug key.

Some desktop-only plugins (the AI bridge, files on your computer, the voice chat unblocker) can't work in the app.
