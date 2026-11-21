#!/bin/sh
# CI only, runs inside the Android emulator job: installs the debug APK, gives it the Renuxcord web build from this
# commit (so it doesn't depend on what the release has yet), opens it and checks Renuxcord loads into Discord.
#   sh .github/scripts/android-smoke.sh <debug apk> <folder with browser.js and browser.css>
set -u
apk=$1
web=$2
pkg=dev.renuxcord.app.dbg

adb install -r "$apk" || exit 1
adb push "$web/browser.js" /data/local/tmp/browser.js
adb push "$web/browser.css" /data/local/tmp/browser.css
adb shell chmod 644 /data/local/tmp/browser.js /data/local/tmp/browser.css
adb shell run-as $pkg mkdir -p files/renuxcord
adb shell run-as $pkg cp /data/local/tmp/browser.js files/renuxcord/browser.js
adb shell run-as $pkg cp /data/local/tmp/browser.css files/renuxcord/browser.css
adb shell run-as $pkg ls -la files/renuxcord

adb logcat -c
adb shell am start -n $pkg/dev.renuxcord.app.MainActivity
sleep 75
adb exec-out screencap -p > android-shot.png
adb logcat -d > android-logcat.txt
grep -E "Renuxcord|AndroidRuntime" android-logcat.txt | head -60

if grep -q "\[RenuxcordMobile\] Renuxcord loaded" android-logcat.txt; then
    echo "Renuxcord loaded in the Android app"
else
    echo "Renuxcord never reported loading"
    exit 1
fi
