/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import { showNotice } from "@api/Notices";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { RENUXCORD_LOGO, RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { Constants, FluxDispatcher, RestAPI, showToast, UserProfileStore, UserStore } from "@webpack/common";

import gitRemote from "~git-remote";

const logger = new Logger("RenuxBadges", "#a78bfa");
// badges.json at the root of the Renuxcord repository
const BADGES_URL = `https://raw.githubusercontent.com/${gitRemote}/main/badges.json`;

// Renuxcord users find each other by a tag at the end of their About Me, written in Unicode tag characters. Those draw
// nothing, so people without Renuxcord see the About Me exactly as before
const TAG = Array.from("RNXC", c => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join("");

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
    // Accounts that have seen the one-time "your badge is on" notice
    announced: {
        type: OptionType.CUSTOM,
        default: [] as string[]
    }
});

let byUser: Record<string, BadgeDef[]> = {};
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let syncedFor: string | null = null;
let warnedFull = false;

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

export function usesRenuxcord(userId: string) {
    if (userId === UserStore.getCurrentUser()?.id) return true;
    return UserProfileStore.getUserProfile(userId)?.bio?.includes(TAG) ?? false;
}

const badge: ProfileBadge = {
    id: "renuxcord-badges",
    getBadges({ userId }) {
        const list = [...(byUser[userId] ?? [])];
        if (!list.length && usesRenuxcord(userId))
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

async function fetchProfile(userId: string) {
    const { body } = await RestAPI.get({
        url: Constants.Endpoints.USER_PROFILE(userId),
        query: { with_mutual_guilds: false, with_mutual_friends_count: false },
        oldFormErrors: true
    });
    return body;
}

/** Puts the tag in your About Me (on), or takes it out (off: only when RenuxBadges itself is switched off) */
async function setTag(on: boolean) {
    const me = UserStore.getCurrentUser();
    if (!me || busy) return;

    busy = true;
    try {
        const profile = await fetchProfile(me.id);
        const bio: string = profile?.user_profile?.bio ?? profile?.user?.bio ?? "";
        if (bio.includes(TAG) === on) return;

        const next = on
            ? (bio ? `${bio} ${TAG}` : TAG)
            : bio.split(` ${TAG}`).join("").split(TAG).join("");
        await RestAPI.patch({ url: "/users/@me/profile", body: { bio: next } });
        // So Discord's own profile editor has the new About Me and doesn't save over it
        FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: await fetchProfile(me.id) });

        if (on && !settings.store.announced.includes(me.id)) {
            settings.store.announced = [...settings.store.announced, me.id];
            showNotice({
                message: "Your Renuxcord badge is on: everyone using Renuxcord sees it on your profile now. It works through an invisible tag at the end of your About Me.",
                buttonText: "Nice",
                callback: () => { }
            });
        }
    } catch (err: any) {
        logger.warn("Couldn't update your About Me", err);
        if (on && err?.body?.errors?.bio && !warnedFull) {
            warnedFull = true;
            showToast({ text: "Your About Me is full, so your Renuxcord badge can't show. Free up a few characters", variant: "critical" });
        }
    } finally {
        busy = false;
    }
}

// Once per account and session: puts the tag back if it went missing (a fresh About Me, another device)
function syncOnce() {
    const me = UserStore.getCurrentUser();
    if (!me || syncedFor === me.id) return;
    syncedFor = me.id;
    void setTag(true);
}

export default definePlugin({
    name: "RenuxBadges",
    description: "Renuxcord badges on profiles, always on: everyone using Renuxcord gets a Renuxcord User badge (through an invisible tag at the end of their About Me), plus owner, dev and friend badges from the Renuxcord repo",
    tags: ["Renuxcord", "Customisation", "Fun"],
    authors: [RenuxDevs.Larpbase],
    // Every Renuxcord user shows up as one, so it can't be switched off
    required: true,
    settings,

    flux: {
        CONNECTION_OPEN: syncOnce
    },

    start() {
        addProfileBadge(badge);
        void load();
        timer = setInterval(load, 30 * 60_000);
        syncOnce();
    },

    stop() {
        removeProfileBadge(badge);
        if (timer) clearInterval(timer);
        timer = null;
        syncedFor = null;
        // Required, so this only happens if a later version makes it optional again: the tag is invisible, so whoever
        // switches it off couldn't take it out themselves
        void setTag(false);
    }
});
