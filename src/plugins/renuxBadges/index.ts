/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { RENUXCORD_LOGO, RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

import gitRemote from "~git-remote";

const logger = new Logger("RenuxBadges", "#a78bfa");
// badges.json at the root of the Renuxcord repository
const BADGES_URL = `https://raw.githubusercontent.com/${gitRemote}/main/badges.json`;

const svg = (body: string) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>${body}</svg>`);

const BUILT_IN_ICONS: Record<string, string> = {
    logo: RENUXCORD_LOGO,
    crown: svg("<defs><linearGradient id='c' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#fde047'/><stop offset='1' stop-color='#f59e0b'/></linearGradient></defs><rect width='64' height='64' rx='16' fill='#1f1b2e'/><path d='M12 44 8 20l14 10 10-16 10 16 14-10-4 24z' fill='url(#c)'/><rect x='12' y='47' width='40' height='6' rx='3' fill='url(#c)'/>"),
    dev: svg("<rect width='64' height='64' rx='16' fill='#0f172a'/><path d='m24 20-12 12 12 12M40 20l12 12-12 12' stroke='#38bdf8' stroke-width='6' fill='none' stroke-linecap='round' stroke-linejoin='round'/>"),
    heart: svg("<rect width='64' height='64' rx='16' fill='#2a1325'/><path d='M32 50S12 38 12 25a10 10 0 0 1 20-4 10 10 0 0 1 20 4c0 13-20 25-20 25z' fill='#f472b6'/>"),
    star: svg("<rect width='64' height='64' rx='16' fill='#1c1a2e'/><path d='m32 10 6.5 14 15.5 1.7-11.6 10.4 3.3 15.2L32 43.5l-13.7 7.8 3.3-15.2L10 25.7 25.5 24z' fill='#a78bfa'/>")
};

interface BadgeDef {
    tooltip: string;
    icon: string;
}

const settings = definePluginSettings({
    selfBadge: {
        type: OptionType.BOOLEAN,
        description: "Show a Renuxcord badge on your own profile (only you can see it)",
        default: true
    }
});

let byUser: Record<string, BadgeDef[]> = {};
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
    try {
        const res = await fetch(BADGES_URL, { cache: "no-cache" });
        if (!res.ok) return;
        const data = await res.json();
        const types: Record<string, BadgeDef> = data?.badges ?? {};

        const next: Record<string, BadgeDef[]> = {};
        for (const [userId, list] of Object.entries<string[]>(data?.users ?? {})) {
            next[userId] = (Array.isArray(list) ? list : [])
                .map(t => types[t])
                .filter(Boolean)
                .map(b => ({ tooltip: String(b.tooltip), icon: BUILT_IN_ICONS[b.icon] ?? String(b.icon) }));
        }
        byUser = next;
    } catch (err) {
        logger.warn("Couldn't load badges", err);
    }
}

const badge: ProfileBadge = {
    id: "renuxcord-badges",
    getBadges({ userId }) {
        const list = [...(byUser[userId] ?? [])];
        if (settings.store.selfBadge && !list.length && userId === UserStore.getCurrentUser()?.id)
            list.push({ tooltip: "Renuxcord User", icon: RENUXCORD_LOGO });

        return list.map((b, i) => ({
            id: `renuxcord-${i}`,
            key: `renuxcord-${i}`,
            description: b.tooltip,
            iconSrc: b.icon,
            position: BadgePosition.START,
            props: { style: { borderRadius: "6px" } }
        }));
    }
};

export default definePlugin({
    name: "RenuxBadges",
    description: "Renuxcord profile badges (owner, devs, friends of the project), loaded from the Renuxcord repo and visible to everyone using Renuxcord",
    tags: ["Renuxcord", "Customisation", "Fun"],
    authors: [RenuxDevs.Larpbase],
    enabledByDefault: true,
    settings,

    start() {
        addProfileBadge(badge);
        void load();
        timer = setInterval(load, 30 * 60_000);
    },

    stop() {
        removeProfileBadge(badge);
        if (timer) clearInterval(timer);
        timer = null;
    }
});
