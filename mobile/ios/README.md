# Renuxcord for iOS

An iPhone and iPad app that opens Discord's web app with Renuxcord loaded into it before Discord's own code runs,
so the same plugins work on your phone. It downloads Renuxcord (`browser.js` and `browser.css`) from the `devbuild`
release, keeps it up to date, and adds a **Renuxcord app** page to Discord's settings (update check, phone or
desktop layout).

## Install

Apple only lets App Store apps install normally, so **Renuxcord.ipa** is sideloaded:

- **SideStore** or **AltStore**: add the IPA, it signs it with your own Apple ID (free accounts renew every 7 days).
- **Sideloadly** on a computer: drag the IPA in, sign in with your Apple ID, plug in the phone.
- **TrollStore** (if your iOS version supports it): open the IPA with TrollStore. No renewing.

No sideloading? Install the free **Userscripts** app from the App Store, add `Renuxcord.user.js` from the same
release, turn the extension on for discord.com in Safari and open discord.com.

## Build

Needs a Mac with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
cd mobile/ios
xcodegen generate
xcodebuild -project Renuxcord.xcodeproj -scheme Renuxcord -configuration Release -sdk iphoneos \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
mkdir -p Payload && cp -R build/Build/Products/Release-iphoneos/Renuxcord.app Payload/ && zip -qry Renuxcord.ipa Payload
```

CI does exactly this on every change and checks Renuxcord loads in the iOS simulator.

iOS doesn't let apps strip Discord's content security policy, so plugins that fetch from sites Discord doesn't
allow can't do that here. Desktop-only plugins (the AI bridge, files on your computer, Drover) don't work either.
