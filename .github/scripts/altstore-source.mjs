/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Prints the SideStore / AltStore source for the Renuxcord iOS app, so those apps can install it and offer updates.
//   node .github/scripts/altstore-source.mjs <Renuxcord.ipa> <owner/repo> <build number>
import { statSync } from "fs";

const [ipa, repo, build] = process.argv.slice(2);
if (!ipa || !repo) {
    console.error("Usage: node altstore-source.mjs <Renuxcord.ipa> <owner/repo> <build number>");
    process.exit(1);
}

const site = "https://renuxchan.github.io/Renuxcord";
const icon = `${site}/icon-512.png`;
const description =
    "Discord with Renuxcord's plugins on your iPhone and iPad. The app opens Discord's web app with Renuxcord loaded " +
    "into it, keeps Renuxcord updated by itself, and adds a Renuxcord app page to Discord's settings.";

const source = {
    name: "Renuxcord",
    identifier: "dev.renuxcord.source",
    subtitle: "Discord with Renuxcord's plugins",
    description,
    iconURL: icon,
    website: site,
    tintColor: "#ff5a2c",
    featuredApps: ["dev.renuxcord.app"],
    apps: [
        {
            name: "Renuxcord",
            bundleIdentifier: "dev.renuxcord.app",
            developerName: "Larpbase",
            subtitle: "Discord with Renuxcord's plugins",
            localizedDescription: description,
            iconURL: icon,
            tintColor: "#ff5a2c",
            category: "social",
            screenshots: [],
            versions: [
                {
                    version: "1.0.0",
                    buildVersion: String(build || "1"),
                    date: new Date().toISOString(),
                    localizedDescription: "The newest build of the Renuxcord app.",
                    downloadURL: `https://github.com/${repo}/releases/download/devbuild/Renuxcord.ipa`,
                    size: statSync(ipa).size,
                    minOSVersion: "15.0"
                }
            ],
            // Has to match the app's Info.plist, which SideStore and AltStore check before installing
            appPermissions: {
                entitlements: [],
                privacy: {
                    NSMicrophoneUsageDescription: "Discord voice and video calls use your microphone.",
                    NSCameraUsageDescription: "Discord video calls and photos use your camera.",
                    NSPhotoLibraryUsageDescription: "Lets you send photos and videos in Discord.",
                    NSPhotoLibraryAddUsageDescription: "Lets you save images from Discord."
                }
            }
        }
    ],
    news: []
};

console.log(JSON.stringify(source, null, 4));
