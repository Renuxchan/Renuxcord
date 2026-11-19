/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { isPluginEnabled } from "@api/PluginManager";
import { RenuxDevs } from "@utils/renuxcord";
import { timeAgo } from "@utils/renuxcordTime";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { Menu, PresenceStore, RelationshipStore, UserStore } from "@webpack/common";

const KEY = "Renuxcord_lastSeen";
/** userId → last time we saw them online */
let seen: Record<string, number> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

const isOnline = (id: string) => {
    const status = PresenceStore.getStatus(id);
    return !!status && status !== "offline" && status !== "invisible";
};

function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, seen), 5000);
}

function refreshOnlineFriends() {
    const now = Date.now();
    for (const id of RelationshipStore.getFriendIDs()) if (isOnline(id)) seen[id] = now;
    persist();
}

/** "online now", "3 hours ago", or null if never seen. Used by Friend Groups and WhoIs too */
export function lastSeenText(userId: string): string | null {
    if (!isPluginEnabled("LastSeen")) return null;
    if (isOnline(userId)) return "online now";
    const at = seen[userId];
    return at ? timeAgo(at) : null;
}

export function lastSeenAt(userId: string): number | undefined {
    return isPluginEnabled("LastSeen") ? seen[userId] : undefined;
}

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.bot || user.id === UserStore.getCurrentUser()?.id) return;
    const text = lastSeenText(user.id);
    if (!text) return;
    children.push(
        <Menu.MenuItem
            id="rx-lastseen"
            label={text === "online now" ? "🟢 Online now" : `🕓 Last seen ${text}`}
            disabled
        />
    );
};

interface PresenceUpdate { user?: { id: string; }; status?: string; }

export default definePlugin({
    name: "LastSeen",
    description: "Remembers when your friends were last online: see \"last seen 3 hours ago\" when you right-click them, in Friend Groups, in /whois and with /lastseen",
    tags: ["Renuxcord", "Friends", "Utility"],
    authors: [RenuxDevs.Larpbase],

    contextMenus: {
        "user-context": userContext
    },

    flux: {
        PRESENCE_UPDATES({ updates }: { updates: PresenceUpdate[]; }) {
            const now = Date.now();
            let changed = false;
            for (const u of updates ?? []) {
                const id = u.user?.id;
                if (!id || !RelationshipStore.isFriend(id)) continue;
                // Going offline still means they were online up to now
                seen[id] = now;
                changed = true;
            }
            if (changed) persist();
        }
    },

    commands: [{
        name: "lastseen",
        description: "When was someone last online?",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{ name: "user", description: "Who", type: ApplicationCommandOptionType.USER, required: true }],
        execute(args, ctx) {
            const id = findOption<string>(args, "user", "");
            const user = UserStore.getUser(id);
            const name = user?.globalName || user?.username || "They";
            const at = seen[id];
            sendBotMessage(ctx.channel.id, {
                content: isOnline(id)
                    ? `🟢 **${name}** is online right now.`
                    : at
                        ? `🕓 **${name}** was last seen **${timeAgo(at)}** (<t:${Math.floor(at / 1000)}:f>).`
                        : RelationshipStore.isFriend(id)
                            ? `🕓 I haven't seen **${name}** online since LastSeen started watching.`
                            : `🕓 LastSeen only keeps track of your friends, and **${name}** isn't on your friends list.`
            });
        }
    }],

    async start() {
        seen = (await DataStore.get<Record<string, number>>(KEY)) ?? {};
        refreshOnlineFriends();
        refreshTimer = setInterval(refreshOnlineFriends, 5 * 60_000);
    },

    stop() {
        clearInterval(refreshTimer);
        clearTimeout(saveTimer);
        void DataStore.set(KEY, seen);
    }
});
