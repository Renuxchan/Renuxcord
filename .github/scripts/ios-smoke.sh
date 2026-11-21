#!/bin/sh
# CI only: installs the simulator build, gives it the Renuxcord web build from this commit (so it doesn't depend on
# what the release has yet), opens it and checks Renuxcord loads into Discord.
#   sh .github/scripts/ios-smoke.sh <Renuxcord.app for the simulator> <folder with browser.js and browser.css>
set -u
app=$1
web=$2
bundle=dev.renuxcord.app

udid=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
phones = [d for runtime, ds in sorted(devices.items(), reverse=True) if "iOS" in runtime for d in ds if d["name"].startswith("iPhone")]
print(phones[0]["udid"] if phones else "")
')
[ -n "$udid" ] || { echo "No iPhone simulator on this runner"; exit 1; }
echo "Simulator $udid"

xcrun simctl boot "$udid" 2> /dev/null || true
xcrun simctl bootstatus "$udid" -b > /dev/null
xcrun simctl install "$udid" "$app" || exit 1

data=$(xcrun simctl get_app_container "$udid" "$bundle" data)
mkdir -p "$data/Library/Application Support/renuxcord"
cp "$web/browser.js" "$web/browser.css" "$data/Library/Application Support/renuxcord/"
xcrun simctl spawn "$udid" defaults write "$bundle" installedHash ci

xcrun simctl launch --console-pty "$udid" "$bundle" > ios-app.log 2>&1 &
launcher=$!
sleep 75
xcrun simctl io "$udid" screenshot ios-shot.png > /dev/null 2>&1 || true
kill "$launcher" 2> /dev/null || true
xcrun simctl terminate "$udid" "$bundle" 2> /dev/null || true

cat ios-app.log | head -60
if grep -q "\[Renuxcord\] Renuxcord loaded in the page" ios-app.log; then
    echo "Renuxcord loaded in the iOS app"
else
    echo "Renuxcord never reported loading"
    exit 1
fi
