#!/bin/sh
# Renuxcord for macOS and Linux
# Copyright (c) 2026 Larpbase
# SPDX-License-Identifier: GPL-3.0-or-later
#
#   curl -fsSL https://github.com/Renuxchan/Renuxcord/releases/download/devbuild/install.sh | sh
#   curl -fsSL https://github.com/Renuxchan/Renuxcord/releases/download/devbuild/install.sh | sh -s -- uninstall
#
#   sh install.sh [install|uninstall|status] [--flavor stable|ptb|canary|all] [--location <Discord resources folder>]
#
# install downloads Renuxcord into its data folder and points Discord at it with a small "app" folder next to
# Discord's app.asar, which Discord loads first. Renuxcord then keeps itself updated. A Discord update replaces
# that folder, so run this again after Discord itself updates.

set -eu

RELEASE_URL="${RENUXCORD_RELEASE_URL:-https://github.com/Renuxchan/Renuxcord/releases/download/devbuild}"
REQUIRED_FILES="patcher.js preload.js renderer.js renderer.css"
OPTIONAL_FILES="renuxcord-mcp.mjs"

say() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
    say "Usage: sh install.sh [install|uninstall|status] [--flavor stable|ptb|canary|all] [--location <folder>]"
    say "  --location  a Discord install this script doesn't find by itself: its resources folder (the one with app.asar)"
}

command_name=install
flavor=all
location=""
while [ $# -gt 0 ]; do
    case "$1" in
        install | uninstall | status) command_name=$1 ;;
        --flavor) flavor=${2:-}; [ -n "$flavor" ] || die "--flavor needs stable, ptb, canary or all"; shift ;;
        --location) location=${2:-}; [ -n "$location" ] || die "--location needs a folder"; shift ;;
        -h | --help) usage; exit 0 ;;
        *) usage >&2; die "Unknown argument: $1" ;;
    esac
    shift
done

case "$flavor" in stable | ptb | canary | all) ;; *) die "Unknown flavor \"$flavor\". Use stable, ptb, canary or all" ;; esac

os=$(uname -s)
case "$os" in
    Darwin | Linux) ;;
    *) die "This installer is for macOS and Linux. On Windows, use RenuxcordInstaller.exe from the same release" ;;
esac

if [ "$(id -u)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then
    die "Run this as yourself, not with sudo. It asks for your password only when a Discord folder needs it"
fi

# ---- where Discord lives ----

flatpak_id() {
    case "$1" in
        stable) say com.discordapp.Discord ;;
        canary) say com.discordapp.DiscordCanary ;;
        *) say "" ;;
    esac
}

candidates() {
    f=$1
    if [ "$os" = Darwin ]; then
        case "$f" in
            stable) app="Discord.app" ;;
            ptb) app="Discord PTB.app" ;;
            canary) app="Discord Canary.app" ;;
        esac
        say "/Applications/$app/Contents/Resources"
        say "$HOME/Applications/$app/Contents/Resources"
        return
    fi

    case "$f" in
        stable) names="discord Discord" ;;
        ptb) names="discord-ptb DiscordPTB" ;;
        canary) names="discord-canary DiscordCanary" ;;
    esac
    for n in $names; do
        for base in /usr/share /usr/lib /usr/lib64 /opt "$HOME/.local/share" "$HOME"; do
            say "$base/$n/resources"
        done
    done

    id=$(flatpak_id "$f")
    if [ -n "$id" ]; then
        say "/var/lib/flatpak/app/$id/current/active/files/discord/resources"
        say "$HOME/.local/share/flatpak/app/$id/current/active/files/discord/resources"
    fi
}

# One line per install found: "<flavor>|<resources folder>"
find_installs() {
    if [ -n "$location" ]; then
        dir=${location%/}
        [ -f "$dir/app.asar" ] || dir="$dir/resources"
        [ -f "$dir/app.asar" ] || dir="${location%/}/Contents/Resources"
        [ -f "$dir/app.asar" ] || die "No app.asar in $location. Point --location at Discord's resources folder"
        say "custom|$dir"
        return
    fi

    for f in stable ptb canary; do
        [ "$flavor" = all ] || [ "$flavor" = "$f" ] || continue
        candidates "$f" | while IFS= read -r dir; do
            [ -f "$dir/app.asar" ] || continue
            # The same install can show up twice through symlinks (/opt/discord -> /usr/share/discord)
            say "$f|$(cd "$dir" && pwd -P)"
        done
    done | awk -F'|' '!seen[$2]++'
}

snap_hint() {
    [ "$os" = Linux ] || return 0
    for s in discord discord-canary; do
        [ -d "/snap/$s" ] && warn "Found the Snap package of Discord ($s). Snaps are read-only, so they can't be patched. Install the .deb, .rpm, tar.gz or Flatpak version instead"
    done
    return 0
}

# ---- Renuxcord's data folder (where Discord's Renuxcord looks for its files and settings) ----

data_dir_for() {
    if [ -n "${RENUXCORD_USER_DATA_DIR:-}" ]; then
        say "$RENUXCORD_USER_DATA_DIR"
        return
    fi
    case "$1" in
        */flatpak/app/*)
            # Flatpak Discord only sees its own config folder, and its userData lives there
            id=$(say "$1" | sed 's|.*/flatpak/app/\([^/]*\)/.*|\1|')
            say "$HOME/.var/app/$id/config/Renuxcord"
            ;;
        *)
            if [ "$os" = Darwin ]; then
                say "$HOME/Library/Application Support/Renuxcord"
            else
                say "${XDG_CONFIG_HOME:-$HOME/.config}/Renuxcord"
            fi
            ;;
    esac
}

# ---- helpers ----

fetch() {
    if command -v curl > /dev/null 2>&1; then
        curl -fsSL --retry 3 -o "$2" "$1"
    elif command -v wget > /dev/null 2>&1; then
        wget -q -O "$2" "$1"
    else
        die "Needs curl or wget to download Renuxcord"
    fi
}

# Runs a command with sudo only when the folder isn't writable for us
as_owner() {
    dir=$1
    shift
    if [ -w "$dir" ]; then
        "$@"
    else
        command -v sudo > /dev/null 2>&1 || die "$dir needs admin rights and sudo isn't available"
        sudo "$@"
    fi
}

js_string() {
    printf '"%s"' "$(say "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

state_of() {
    res=$1
    if [ -f "$res/app/index.js" ]; then
        if grep -q "Renuxcord" "$res/app/index.js" 2> /dev/null; then
            say "Renuxcord -> $(sed -n 's/.*require("\(.*\)").*/\1/p' "$res/app/index.js")"
        else
            say "patched by another mod (it has an app folder)"
        fi
    elif [ -f "$res/_app.asar" ]; then
        # install.mjs (and Vencord's installer) swap app.asar for a tiny one that loads the mod
        if [ "$(wc -c < "$res/app.asar")" -lt 4096 ] && grep -q "Renuxcord" "$res/app.asar" 2> /dev/null; then
            say "Renuxcord (app.asar method)"
        else
            say "patched by another mod (probably Vencord, it has _app.asar)"
        fi
    else
        say "vanilla"
    fi
}

mac_permission_hint() {
    [ "$os" = Darwin ] || return 0
    warn "macOS blocked changes to Discord.app. Open System Settings > Privacy & Security > App Management, turn it on for your terminal app, then run this again"
}

download_renuxcord() {
    data=$1
    dist="$data/dist"
    mkdir -p "$dist"
    say "Downloading Renuxcord to $dist"
    # (sh functions share variables with their caller, hence a name nothing else uses)
    for file in $REQUIRED_FILES; do
        fetch "$RELEASE_URL/$file" "$dist/$file.download" || die "Couldn't download $file from $RELEASE_URL"
    done
    for file in $OPTIONAL_FILES; do
        fetch "$RELEASE_URL/$file" "$dist/$file.download" 2> /dev/null || rm -f "$dist/$file.download"
    done
    # Only swap the files in once everything arrived, so a failed download never leaves a half-updated Renuxcord
    for file in $REQUIRED_FILES $OPTIONAL_FILES; do
        if [ -f "$dist/$file.download" ]; then mv -f "$dist/$file.download" "$dist/$file"; fi
    done
    # Keeps a package.json further up (with "type": "module") from changing how these files load
    say "{}" > "$dist/package.json"
}

patch_install() {
    res=$1
    data=$2
    app="$res/app"

    case "$(state_of "$res")" in
        "patched by another mod"*)
            warn "Skipping $res: $(state_of "$res"). Uninstall that mod first"
            return 1
            ;;
        "Renuxcord (app.asar method)")
            say "  $res: already loads Renuxcord"
            return 0
            ;;
    esac

    index="require($(js_string "$data/dist/patcher.js")); // Renuxcord"
    pkg='{ "name": "discord", "main": "index.js" }'
    tmp=$(mktemp -d)
    say "$index" > "$tmp/index.js"
    say "$pkg" > "$tmp/package.json"

    ok=1
    as_owner "$res" mkdir -p "$app" 2> /dev/null || ok=0
    if [ $ok = 1 ]; then
        as_owner "$res" cp "$tmp/index.js" "$tmp/package.json" "$app/" 2> /dev/null || ok=0
    fi
    rm -rf "$tmp"
    if [ $ok = 0 ]; then
        mac_permission_hint
        warn "Couldn't write to $app"
        return 1
    fi
    say "  $res: $(state_of "$res")"
}

unpatch_install() {
    res=$1
    if [ -f "$res/app/index.js" ] && grep -q "Renuxcord" "$res/app/index.js"; then
        as_owner "$res" rm -rf "$res/app" || { mac_permission_hint; die "Couldn't remove $res/app"; }
    elif [ "$(state_of "$res")" = "Renuxcord (app.asar method)" ]; then
        as_owner "$res" mv -f "$res/_app.asar" "$res/app.asar" || { mac_permission_hint; die "Couldn't restore $res/app.asar"; }
    fi
    say "  $res: $(state_of "$res")"
}

# ---- commands ----

installs=$(find_installs)

case "$command_name" in
    status)
        say "Renuxcord release: $RELEASE_URL"
        if [ -z "$installs" ]; then
            say "No Discord installs found."
            snap_hint
            exit 0
        fi
        say "$installs" | while IFS='|' read -r f res; do
            say "  $f: $res"
            say "      $(state_of "$res"), data folder $(data_dir_for "$res")"
        done
        ;;

    install)
        if [ -z "$installs" ]; then
            snap_hint
            die "No Discord install found. Install Discord first, or pass --location <its resources folder>"
        fi
        failed=0
        done_data=""
        # A here-document instead of a pipe, so sudo can still ask for a password
        while IFS='|' read -r f res; do
            data=$(data_dir_for "$res")
            case "|$done_data|" in
                *"|$data|"*) ;;
                *) download_renuxcord "$data"; done_data="$done_data|$data" ;;
            esac
            say "Patching Discord $f"
            patch_install "$res" "$data" || failed=1
        done << EOF
$installs
EOF
        [ $failed = 0 ] || die "Some Discord installs weren't patched (see above)"
        say "Done. Quit Discord completely and open it again to load Renuxcord."
        say "After Discord itself updates, run this again."
        ;;

    uninstall)
        [ -n "$installs" ] || die "No Discord install found"
        while IFS='|' read -r f res; do
            say "Restoring Discord $f"
            unpatch_install "$res"
        done << EOF
$installs
EOF
        say "Done. Restart Discord. Your Renuxcord settings stay in $(data_dir_for "")."
        ;;
esac
