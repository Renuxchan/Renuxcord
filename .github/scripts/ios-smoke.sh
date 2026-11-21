#!/bin/sh
# CI only: installs the simulator build, gives it the Renuxcord web build from this commit (so it doesn't depend on
# what the release has yet), opens it and checks Renuxcord loads into Discord. Retries the launch once, and prints
# the app's crash report if it has one.
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

# The app logs through NSLog, which lands in the simulator's system log
xcrun simctl spawn "$udid" log stream --level info --style compact --predicate 'process == "Renuxcord"' > ios-app.log 2>&1 &
logger=$!
sleep 3

loaded() { grep -q "Renuxcord loaded in the page" ios-app.log; }

for launch in 1 2; do
    echo "Launch $launch"
    xcrun simctl terminate "$udid" "$bundle" 2> /dev/null || true
    xcrun simctl launch "$udid" "$bundle" || true
    waited=0
    while [ $waited -lt 90 ] && ! loaded; do
        sleep 5
        waited=$((waited + 5))
    done
    loaded && break
done

# The viewport line comes once the page's HTML is in, a little after Renuxcord itself
waited=0
while loaded && [ $waited -lt 30 ] && ! grep -q "Viewport: " ios-app.log; do
    sleep 3
    waited=$((waited + 3))
done
sleep 5

xcrun simctl io "$udid" screenshot ios-shot.png > /dev/null 2>&1 || true
kill "$logger" 2> /dev/null || true
xcrun simctl terminate "$udid" "$bundle" 2> /dev/null || true

grep -i "renuxcord" ios-app.log | head -20
if loaded; then
    echo "Renuxcord loaded in the iOS app"
    # Text boxes smaller than 16px make iOS zoom the whole page when tapped, unless the viewport says not to
    if grep -q "Viewport: .*maximum-scale=1" ios-app.log; then
        echo "ok   the page can't zoom when you tap a text box"
        exit 0
    fi
    echo "FAIL the viewport fix didn't apply"
    exit 1
fi

echo "Renuxcord never reported loading"
for report in ~/Library/Logs/DiagnosticReports/Renuxcord*; do
    [ -f "$report" ] && { echo "---- $report"; head -60 "$report"; }
done
exit 1
