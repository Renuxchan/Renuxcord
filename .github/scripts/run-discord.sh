#!/bin/sh
# CI only: starts Discord for a while, saves its output and a screenshot, then checks whether Renuxcord loaded.
#   sh .github/scripts/run-discord.sh renuxcord   # expect Renuxcord
#   sh .github/scripts/run-discord.sh vanilla     # expect plain Discord
set -u
expect=$1
log="discord-$expect.log"
shot="discord-$expect.png"
seconds=60

case "$(uname -s)" in
    Linux)
        # Ubuntu runners block the Chromium sandbox's user namespaces, hence --no-sandbox
        xvfb-run -a -s "-screen 0 1280x800x24" sh -c "
            discord --no-sandbox > '$log' 2>&1 &
            sleep $seconds
            command -v import > /dev/null && import -window root '$shot'
            pkill -f /usr/share/discord/Discord
            sleep 3
        "
        ;;
    Darwin)
        "/Applications/Discord.app/Contents/MacOS/Discord" > "$log" 2>&1 &
        sleep $seconds
        screencapture -x "$shot" || true
        pkill -f "Discord.app" || true
        sleep 3
        ;;
esac

echo "---- first lines of $log"
head -40 "$log"

if [ "$expect" = renuxcord ]; then
    grep -q "\[Renuxcord\] Starting up" "$log" || { echo "Renuxcord's patcher never ran"; exit 1; }
    grep -q "\[Renuxcord\] Loading original Discord app.asar" "$log" || { echo "Renuxcord didn't hand over to Discord"; exit 1; }
    echo "Renuxcord loaded"
else
    if grep -q "\[Renuxcord\]" "$log"; then
        echo "Renuxcord still loads after uninstalling"
        exit 1
    fi
    echo "Discord is vanilla"
fi
