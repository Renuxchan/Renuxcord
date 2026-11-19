/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { UserStore } from "@webpack/common";

const settings = definePluginSettings({
    flagShorteners: {
        type: OptionType.BOOLEAN,
        description: "Also warn about link shorteners (bit.ly, tinyurl…) since you can't see where they go",
        default: false
    },
    checkOwnMessages: {
        type: OptionType.BOOLEAN,
        description: "Check your own messages too",
        default: false
    }
});

// Domains (and their subdomains) that are the real thing
const OFFICIAL = [
    "discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.gift", "discord.new", "discord.media", "discord.dev",
    "discordstatus.com", "discord.co", "dis.gd",
    "steamcommunity.com", "steampowered.com", "steamstatic.com", "steamusercontent.com", "steamchina.com",
    "roblox.com", "rbxcdn.com", "epicgames.com", "unrealengine.com", "fortnite.com",
    "paypal.com", "paypal.me", "paypalobjects.com",
    "github.com", "githubusercontent.com", "github.io", "githubassets.com",
    "google.com", "googleapis.com", "gstatic.com", "googleusercontent.com", "youtube.com", "youtu.be", "ytimg.com",
    "microsoft.com", "live.com", "xbox.com", "office.com", "minecraft.net", "mojang.com",
    "twitch.tv", "instagram.com", "spotify.com", "riotgames.com", "playvalorant.com", "leagueoflegends.com"
];

const BRANDS = [
    "discord", "discordapp", "steamcommunity", "steampowered", "roblox", "epicgames", "paypal", "github",
    "google", "youtube", "microsoft", "minecraft", "twitch", "instagram", "spotify", "riotgames", "valorant"
];

const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "cutt.ly", "is.gd", "v.gd", "rb.gy", "shorturl.at", "t.ly", "tiny.cc", "ow.ly", "goo.gl", "rebrand.ly", "s.id", "shorturl.asia"]);

const RISKY_WORDS = /nitro|gift|free|claim|promo|drop|login|signin|verify|trade|offer|giveaway|auth|secure|support|bonus|reward|event|airdrop|boost/;
const SCAM_WORDING =/free\s*nitro|nitro\s*(for\s*free|giveaway|gift)|discord\s*nitro\s*free|steam\s*(gift|giveaway)|claim\s*(your\s*)?(free|gift|prize)|airdrop|you\s*(have\s*)?won|gift\s*for\s*you/i;
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const MASKED_RE = /\[([^\]]{1,200})\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/gi;
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "or", "ne"]);

const isOfficial = (host: string) => OFFICIAL.some(d => host === d || host.endsWith(`.${d}`));

function registrable(host: string) {
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const tld = parts.at(-1)!;
    const sld = parts.at(-2)!;
    return (tld.length === 2 && SECOND_LEVEL.has(sld) ? parts.slice(-3) : parts.slice(-2)).join(".");
}

const normalise = (label: string) => label
    .replace(/0/g, "o").replace(/[1!|]/g, "l").replace(/3/g, "e").replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s").replace(/7/g, "t").replace(/rn/g, "m").replace(/vv/g, "w").replace(/[-_]/g, "");

function distance(a: string, b: string) {
    if (Math.abs(a.length - b.length) > 2) return 99;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return row[b.length];
}

function hostOf(url: string) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
        return null;
    }
}

function checkHost(host: string): string | null {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return `${host} is a raw IP address, not a website name`;
    if (host.split(".").some(l => l.startsWith("xn--"))) return `${host} uses look-alike characters`;
    if (isOfficial(host)) return null;

    const base = registrable(host);
    const label = base.split(".")[0];
    const norm = normalise(label);

    for (const brand of BRANDS) {
        if (label === brand) continue;

        // discordjs, discordbots… are fan sites; discord-nitro, steamcommunity-trade… are bait
        if (norm.includes(brand)) {
            const rest = norm.replace(brand, "");
            if (RISKY_WORDS.test(rest)) return `${base} uses the ${brand} name but isn't an official ${brand} site`;
            if (rest.length >= 2) continue;
        }

        const limit = brand.length >= 6 ? 2 : 1;
        if (norm === brand || distance(norm, brand) <= limit)
            return `${base} looks like ${brand} but isn't an official ${brand} site`;
    }

    const embedded = OFFICIAL.find(d => host.startsWith(`${d}.`) || host.startsWith(`${d}-`) || host.includes(`.${d}.`) || host.includes(`.${d}-`));
    if (embedded) return `${host} pretends to be ${embedded}, but the real site is ${base}`;

    if (settings.store.flagShorteners && SHORTENERS.has(base)) return `${base} is a link shortener, so you can't see where it goes`;
    return null;
}

const cache = new Map<string, string[]>();

export function analyse(content: string): string[] {
    const cached = cache.get(content);
    if (cached) return cached;

    const reasons = new Set<string>();
    const hosts = new Set<string>();

    for (const url of content.match(URL_RE) ?? []) {
        const host = hostOf(url);
        if (host) hosts.add(host);
    }

    for (const host of hosts) {
        const reason = checkHost(host);
        if (reason) reasons.add(reason);
    }

    for (const [, text, href] of content.matchAll(MASKED_RE)) {
        const shown = /([a-z0-9-]+\.)+[a-z]{2,}/i.exec(text)?.[0]?.toLowerCase();
        const real = hostOf(href);
        if (shown && real && registrable(shown) !== registrable(real))
            reasons.add(`The link text says ${shown} but it really goes to ${real}`);
    }

    if (SCAM_WORDING.test(content) && [...hosts].some(h => !isOfficial(h)))
        reasons.add("Classic free-gift scam wording next to a link");

    const result = [...reasons];
    cache.set(content, result);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return result;
}

const Warning = ErrorBoundary.wrap(({ message }: { message: Message; }) => {
    if (!message?.content || !/https?:\/\//i.test(message.content)) return null;
    if (!settings.store.checkOwnMessages && message.author?.id === UserStore.getCurrentUser()?.id) return null;

    const reasons = analyse(message.content);
    if (!reasons.length) return null;

    return (
        <div className="rx-linksafety">
            <div className="rx-linksafety-title">⚠️ Careful with this link</div>
            <ul className="rx-linksafety-reasons">
                {reasons.map(r => <li key={r}>{r}</li>)}
            </ul>
        </div>
    );
}, { noop: true });

export default definePlugin({
    name: "LinkSafety",
    description: "Warns you under messages with scam-looking links: fake Discord/Steam/Roblox domains, look-alike characters, raw IPs, mismatched masked links and free-nitro bait",
    tags: ["Renuxcord", "Privacy", "Chat"],
    authors: [RenuxDevs.Larpbase],
    settings,

    renderMessageAccessory: props => <Warning message={props.message} />,

    stop() {
        cache.clear();
    }
});
