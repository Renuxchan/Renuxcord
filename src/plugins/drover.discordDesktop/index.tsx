/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotice } from "@api/Notices";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { IS_WINDOWS } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { relaunch } from "@utils/native";
import { useAwaiter } from "@utils/react";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { showToast } from "@webpack/common";

import type { DroverConfig } from "./native";

const Native = VencordNative.pluginHelpers.Drover as PluginNative<typeof import("./native")>;
const logger = new Logger("Drover");

let timer: ReturnType<typeof setTimeout> | undefined;
const applySoon = () => {
    clearTimeout(timer);
    timer = setTimeout(applyNow, 1000);
};

const settings = definePluginSettings({
    mode: {
        type: OptionType.SELECT,
        description: "What Drover does",
        options: [
            { label: "Unblock voice only, no proxy (for places like the UAE)", value: "direct", default: true },
            { label: "Use an HTTP proxy (and unblock voice)", value: "http" },
            { label: "Use a SOCKS5 proxy (and unblock voice)", value: "socks5" }
        ],
        onChange: applySoon
    },
    proxyHost: { type: OptionType.STRING, description: "Proxy address", default: "127.0.0.1", onChange: applySoon },
    proxyPort: { type: OptionType.NUMBER, description: "Proxy port", default: 1080, onChange: applySoon },
    proxyUser: { type: OptionType.STRING, description: "Proxy username (HTTP only, leave empty if none)", default: "", onChange: applySoon },
    proxyPassword: { type: OptionType.STRING, description: "Proxy password (HTTP only)", default: "", onChange: applySoon },
    extraPacket: {
        type: OptionType.BOOLEAN,
        description: "Also send Drover's extra packet when voice connects. Helps on stricter networks",
        default: true,
        onChange: applySoon
    },
    panel: { type: OptionType.COMPONENT, component: () => <Panel /> }
});

const config = (): DroverConfig => ({
    mode: settings.store.mode as DroverConfig["mode"],
    host: settings.store.proxyHost,
    port: settings.store.proxyPort,
    user: settings.store.proxyUser,
    password: settings.store.proxyPassword,
    extraPacket: settings.store.extraPacket
});

const askRestart = (message: string) => showNotice({ message, buttonText: "Restart", callback: relaunch });

async function applyNow() {
    try {
        const res = await Native.apply(config());
        for (const s of res.skipped) showToast(`Drover: ${s}`);
        if (res.restartNeeded) askRestart("Drover is set up. Restart Discord to turn it on.");
    } catch (err) {
        logger.error("Couldn't set up Drover", err);
        showToast(`Drover: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function Panel() {
    const [status] = useAwaiter(() => Native.status(), { fallbackValue: null });
    return (
        <div>
            {!IS_WINDOWS && <Paragraph>On macOS and Linux only the proxy works (Renuxcord sets it when Discord starts). Voice unblocking needs Windows.</Paragraph>}
            {status && IS_WINDOWS && (
                <Paragraph>
                    Drover {status.release} is {status.loaded ? "running" : "not running"} in this Discord.{" "}
                    {status.folders.map(f => `${f.name}: ${f.dll === "drover" ? "installed" : f.dll === "other" ? "has another version.dll" : "not installed"}`).join(" · ")}
                </Paragraph>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {IS_WINDOWS && <Button size="small" onClick={applyNow}>Apply now</Button>}
                <Button size="small" variant="secondary" onClick={relaunch}>Restart Discord</Button>
            </div>
            <Paragraph style={{ marginTop: 8, color: "var(--text-muted)" }}>
                Drover is made by hdrover (github.com/hdrover/discord-drover). Renuxcord downloads its official release and checks it before installing.
            </Paragraph>
        </div>
    );
}

export default definePlugin({
    name: "Drover",
    description: "Gets Discord voice working where it's blocked (like the UAE) and can send Discord through an HTTP or SOCKS5 proxy. Sets up hdrover's Discord Drover for you on Windows",
    tags: ["Renuxcord", "Voice", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    start() {
        if (IS_WINDOWS) applyNow();
    },

    async stop() {
        clearTimeout(timer);
        const res = await Native.remove();
        if (res.restartNeeded) askRestart("Drover is off. Restart Discord to finish turning it off.");
    }
});
