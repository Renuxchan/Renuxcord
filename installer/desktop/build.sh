#!/bin/sh
# Renuxcord, a Vencord-based Discord client mod
# Copyright (c) 2026 Larpbase
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Builds Renuxcord Installer for the OS it runs on, into dist/ at the repository root:
#   macOS  dist/RenuxcordInstaller-mac.zip         "Renuxcord Installer.app" for Apple silicon and Intel
#   Linux  dist/RenuxcordInstaller-linux-x64.tar.gz
# Needs Go, and on Linux a C compiler with the OpenGL and X11 headers (Fyne's requirements).

set -eu
cd "$(dirname "$0")"
out=../../dist
mkdir -p "$out" build

go mod tidy

case "$(uname -s)" in
    Darwin)
        CGO_ENABLED=1 GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o build/arm64 .
        CGO_ENABLED=1 GOARCH=amd64 CC="clang -arch x86_64" go build -trimpath -ldflags "-s -w" -o build/amd64 .

        app="build/Renuxcord Installer.app"
        rm -rf "$app"
        mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
        lipo -create -output "$app/Contents/MacOS/RenuxcordInstaller" build/arm64 build/amd64
        cp Info.plist "$app/Contents/Info.plist"

        iconset=build/icon.iconset
        rm -rf "$iconset"
        mkdir -p "$iconset"
        for size in 16 32 128 256 512; do
            sips -z $size $size icon.png --out "$iconset/icon_${size}x${size}.png" > /dev/null
            sips -z $((size * 2)) $((size * 2)) icon.png --out "$iconset/icon_${size}x${size}@2x.png" > /dev/null
        done
        iconutil -c icns "$iconset" -o "$app/Contents/Resources/icon.icns"

        # Ad-hoc signature: Apple silicon won't run unsigned code at all
        codesign --force --deep --sign - "$app"
        rm -f "$out/RenuxcordInstaller-mac.zip"
        ditto -c -k --keepParent "$app" "$out/RenuxcordInstaller-mac.zip"
        echo "Built $out/RenuxcordInstaller-mac.zip"
        ;;
    Linux)
        CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o build/RenuxcordInstaller .
        tar -C build -czf "$out/RenuxcordInstaller-linux-x64.tar.gz" RenuxcordInstaller
        echo "Built $out/RenuxcordInstaller-linux-x64.tar.gz"
        ;;
    *)
        echo "Build this on macOS or Linux (Windows has installer/build.ps1)" >&2
        exit 1
        ;;
esac
