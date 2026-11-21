#!/bin/sh
# CI only, runs inside the Android emulator job: installs the debug APK, gives it the Renuxcord web build from this
# commit (so it doesn't depend on what the release has yet), opens it and checks Renuxcord loads into Discord. Then
# checks calls, notifications and starting without internet.
#   sh .github/scripts/android-smoke.sh <debug apk> <folder with browser.js and browser.css>
set -u
apk=$1
web=$2
pkg=dev.renuxcord.app.dbg
here=$(dirname "$0")
failed=0

adb install -r "$apk" || exit 1
adb push "$web/browser.js" /data/local/tmp/browser.js
adb push "$web/browser.css" /data/local/tmp/browser.css
adb shell chmod 644 /data/local/tmp/browser.js /data/local/tmp/browser.css
adb shell run-as $pkg mkdir -p files/renuxcord
adb shell run-as $pkg cp /data/local/tmp/browser.js files/renuxcord/browser.js
adb shell run-as $pkg cp /data/local/tmp/browser.css files/renuxcord/browser.css
adb shell run-as $pkg ls -la files/renuxcord
# What a person grants on the first call and the first notification
for permission in RECORD_AUDIO CAMERA POST_NOTIFICATIONS; do
    adb shell pm grant $pkg android.permission.$permission
done

loaded() { adb logcat -d | grep -q "\[RenuxcordMobile\] Renuxcord loaded"; }
wait_loaded() {
    waited=0
    while [ $waited -lt "$1" ] && ! loaded; do
        sleep 5
        waited=$((waited + 5))
    done
    loaded
}

adb logcat -c
adb shell am start -n $pkg/dev.renuxcord.app.MainActivity
wait_loaded 90
sleep 10
adb exec-out screencap -p > android-shot.png
adb logcat -d > android-logcat.txt
grep -E "Renuxcord|AndroidRuntime" android-logcat.txt | head -60

if loaded; then
    echo "Renuxcord loaded in the Android app"
else
    echo "Renuxcord never reported loading"
    exit 1
fi

# ---- calls and notifications, checked inside the page ----
socket=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*" | head -1)
if [ -n "$socket" ]; then
    adb forward tcp:9222 "localabstract:$socket" > /dev/null
    node "$here/webview-check.mjs" 9222 || failed=1
    adb forward --remove tcp:9222 2> /dev/null
    sleep 3
    if adb shell dumpsys notification --noredact | grep -q "Renuxcord CI"; then
        echo "ok   the notification shows in Android's notification shade"
    else
        echo "FAIL the notification isn't in Android's notification shade"
        failed=1
    fi
else
    echo "FAIL no WebView DevTools socket (is this the debug APK?)"
    failed=1
fi

# ---- no internet: the app shows its own screen with Try again instead of closing ----
online() { adb shell ping -c 1 -W 3 1.1.1.1 > /dev/null 2>&1; }
adb shell am force-stop $pkg
adb shell cmd connectivity airplane-mode enable
sleep 8
if online; then
    echo "skip the emulator stayed online in airplane mode, can't check the offline screen"
else
    adb logcat -c
    adb shell am start -n $pkg/dev.renuxcord.app.MainActivity
    sleep 20
    adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
    adb shell cat /sdcard/ui.xml > android-offline.xml
    adb exec-out screencap -p > android-offline.png
    if grep -q "reach Discord" android-offline.xml && adb shell pidof $pkg > /dev/null; then
        echo "ok   offline: the app stays open and shows its Try again screen"
    else
        echo "FAIL offline: no Try again screen"
        failed=1
    fi

    adb shell cmd connectivity airplane-mode disable
    waited=0
    while [ $waited -lt 60 ] && ! online; do
        sleep 3
        waited=$((waited + 3))
    done
    # Tap "Try again" in the middle of its bounds. The log is cleared first: the offline page also ran Renuxcord
    bounds=$(tr '>' '\n' < android-offline.xml | grep -i 'text="Try again"' | grep -o 'bounds="[^"]*"' | head -1 | tr -c '0-9\n' ' ')
    if [ -n "$bounds" ]; then
        adb logcat -c
        set -- $bounds
        adb shell input tap $((($1 + $3) / 2)) $((($2 + $4) / 2))
        if wait_loaded 90; then
            echo "ok   back online: Try again loads Discord with Renuxcord"
        else
            echo "FAIL back online: Try again didn't load Discord"
            failed=1
        fi
    else
        echo "FAIL couldn't find the Try again button"
        failed=1
    fi
fi
adb shell cmd connectivity airplane-mode disable 2> /dev/null
adb logcat -d >> android-logcat.txt

exit $failed
