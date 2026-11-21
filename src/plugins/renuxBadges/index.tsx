/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { RENUXCORD_LOGO, RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { Constants, FluxDispatcher, Modal, openModal, RestAPI, showToast, UserProfileStore, UserStore } from "@webpack/common";

import gitRemote from "~git-remote";

const logger = new Logger("RenuxBadges", "#a78bfa");
// badges.json at the root of the Renuxcord repository
const BADGES_URL = `https://raw.githubusercontent.com/${gitRemote}/main/badges.json`;
const WELCOME_SEEN = "Renuxcord_welcomeSeen";

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
    selfBadge: {
        type: OptionType.BOOLEAN,
        description: "Show the Renuxcord badge on your own profile",
        default: true
    },
    shareBadge: {
        type: OptionType.BOOLEAN,
        description: "Let other Renuxcord users see your badge. For this, Renuxcord adds a tiny invisible tag to the end of your About Me; people without Renuxcord see nothing different",
        default: false,
        onChange: () => void syncTag(true)
    },
    asked: {
        type: OptionType.CUSTOM,
        default: false
    }
});

let byUser: Record<string, BadgeDef[]> = {};
let timer: ReturnType<typeof setInterval> | null = null;
let asking: ReturnType<typeof setInterval> | null = null;
let busy = false;
let synced = false;

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
    if (userId === UserStore.getCurrentUser()?.id) return settings.store.selfBadge;
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

/**
 * Makes your About Me match the setting. On its own (fromUser false) it only ever puts a missing tag back, never takes
 * one out, so a second install that hasn't been switched on can't fight the first
 */
async function syncTag(fromUser: boolean) {
    const me = UserStore.getCurrentUser();
    if (!me || busy) return;
    const share = settings.store.shareBadge;
    if (!share && !fromUser) return;

    busy = true;
    try {
        const profile = await fetchProfile(me.id);
        const bio: string = profile?.user_profile?.bio ?? profile?.user?.bio ?? "";
        if (bio.includes(TAG) === share) return;

        const next = share
            ? (bio ? `${bio} ${TAG}` : TAG)
            : bio.split(` ${TAG}`).join("").split(TAG).join("");
        await RestAPI.patch({ url: "/users/@me/profile", body: { bio: next } });
        // So Discord's own profile editor has the new About Me and doesn't save over it
        FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: await fetchProfile(me.id) });

        if (fromUser) showToast({
            text: share ? "Other Renuxcord users can see your badge now" : "Took the Renuxcord tag out of your About Me",
            variant: "success"
        });
    } catch (err: any) {
        logger.warn("Couldn't update your About Me", err);
        if (!fromUser) return;
        showToast({
            text: err?.body?.errors?.bio
                ? "Your About Me is full. Free up a few characters, then switch this on again"
                : "Couldn't change your About Me. Try again in a bit",
            variant: "critical"
        });
    } finally {
        busy = false;
    }
}

function askToShare() {
    settings.store.asked = true;
    openModal(props => (
        <Modal
            {...props}
            size="sm"
            title="Show your Renuxcord badge?"
            subtitle="Everyone else using Renuxcord would see a Renuxcord badge on your profile."
            actions={[
                { text: "No thanks", variant: "secondary", onClick: props.onClose },
                {
                    text: "Show my badge",
                    variant: "primary",
                    onClick: () => {
                        props.onClose();
                        settings.store.shareBadge = true;
                        void syncTag(true);
                    }
                }
            ]}
        >
            <Paragraph>
                For that, Renuxcord adds a tiny invisible tag to the end of your About Me. People without Renuxcord see
                nothing different. You can change this any time in RenuxBadges' settings.
            </Paragraph>
        </Modal>
    ));
}

function stopAsking() {
    if (asking) clearInterval(asking);
    asking = null;
}

// Once per install, after the welcome screen and never on top of another window
function askWhenFree() {
    stopAsking();
    let waited = 0;
    asking = setInterval(async () => {
        if (settings.store.asked) return stopAsking();
        if (!UserStore.getCurrentUser() || !await DataStore.get(WELCOME_SEEN) || settings.store.asked) return;
        // Waits up to two minutes for other windows to close
        if (document.querySelector("[role=dialog]") && ++waited < 24) return;
        stopAsking();
        askToShare();
    }, 5000);
}

function syncOnce() {
    if (synced || !UserStore.getCurrentUser()) return;
    synced = true;
    void syncTag(false);
}

export default definePlugin({
    name: "RenuxBadges",
    description: "Renuxcord badges on profiles: everyone who uses Renuxcord gets one, plus owner, dev and friend badges from the Renuxcord repo. Everyone using Renuxcord can see them",
    tags: ["Renuxcord", "Customisation", "Fun"],
    authors: [RenuxDevs.Larpbase],
    enabledByDefault: true,
    settings,

    flux: {
        CONNECTION_OPEN: syncOnce
    },

    start() {
        addProfileBadge(badge);
        void load();
        timer = setInterval(load, 30 * 60_000);
        syncOnce();
        if (!settings.store.asked) askWhenFree();
    },

    stop() {
        removeProfileBadge(badge);
        if (timer) clearInterval(timer);
        timer = null;
        stopAsking();
    }
});
