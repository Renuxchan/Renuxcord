/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import { authorName, avatarOf, jumpTo, mentionsUser, RawMessage, truncate, whereLabel } from "@utils/renuxcordMessages";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

const settings = definePluginSettings({
    maxAgeMinutes: {
        type: OptionType.NUMBER,
        description: "Only alert if the ping disappears within this many minutes",
        default: 30
    },
    includeRoles: {
        type: OptionType.BOOLEAN,
        description: "Count role pings for roles you have",
        default: true
    },
    includeEveryone: {
        type: OptionType.BOOLEAN,
        description: "Count @everyone and @here pings",
        default: false
    },
    editedOut: {
        type: OptionType.BOOLEAN,
        description: "Also alert when someone edits the ping out of their message",
        default: true
    }
});

const pings = new Map<string, { msg: RawMessage; at: number; }>();

function prune() {
    const maxAge = Math.max(1, settings.store.maxAgeMinutes) * 60_000;
    const now = Date.now();
    for (const [id, entry] of pings)
        if (now - entry.at > maxAge) pings.delete(id);

    while (pings.size > 1000) pings.delete(pings.keys().next().value!);
}

const opts = () => ({ roles: settings.store.includeRoles, everyone: settings.store.includeEveryone });

function alert(msg: RawMessage, what: string) {
    showNotification({
        title: `👻 Ghost ping from ${authorName(msg.author)}`,
        body: `${what} in ${whereLabel(msg.channel_id)}: ${truncate(msg.content?.trim() || "(no text)")}`,
        icon: avatarOf(msg.author),
        onClick: () => jumpTo(msg.channel_id)
    });
}

function take(id: string) {
    prune();
    const entry = pings.get(id);
    if (entry) pings.delete(id);
    return entry;
}

export default definePlugin({
    name: "GhostPingAlert",
    description: "Tells you who pinged you and what they said when they delete the message (or edit the ping out) before you see it",
    tags: ["Renuxcord", "Notifications", "Chat"],
    authors: [RenuxDevs.Larpbase],
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic: boolean; }) {
            if (optimistic || !message?.author) return;
            const me = UserStore.getCurrentUser()?.id;
            if (!me || message.author.id === me) return;
            if (!mentionsUser(message, me, opts())) return;

            pings.set(message.id, { msg: message, at: Date.now() });
            prune();
        },

        MESSAGE_UPDATE({ message }: { message: Partial<RawMessage> & { id: string; }; }) {
            if (!settings.store.editedOut || message?.content == null) return;
            const entry = pings.get(message.id);
            const me = UserStore.getCurrentUser()?.id;
            if (!entry || !me) return;

            const updated = { ...entry.msg, ...message } as RawMessage;
            if (mentionsUser(updated, me, opts())) return;

            pings.delete(message.id);
            alert(entry.msg, "Edited the ping out");
        },

        MESSAGE_DELETE({ id, mlDeleted }: { id: string; mlDeleted?: boolean; }) {
            if (mlDeleted) return;
            const entry = take(id);
            if (entry) alert(entry.msg, "Deleted a message that pinged you");
        },

        MESSAGE_DELETE_BULK({ ids }: { ids: string[]; }) {
            for (const id of ids ?? []) {
                const entry = take(id);
                if (entry) alert(entry.msg, "A ping to you was bulk-deleted");
            }
        }
    },

    stop() {
        pings.clear();
    }
});
