/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { openPrivateChannel } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { Menu, PresenceStore, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    watched: {
        type: OptionType.CUSTOM,
        default: [] as string[]
    },
    announceGames: {
        type: OptionType.BOOLEAN,
        description: "Also tell me when they start playing a game",
        default: true
    },
    announceOffline: {
        type: OptionType.BOOLEAN,
        description: "Also tell me when they go offline",
        default: false
    },
    list: {
        type: OptionType.COMPONENT,
        component: () => <WatchedList />
    }
});

interface Seen {
    status: string;
    game: string | null;
}

const seen = new Map<string, Seen>();
const lastNotified = new Map<string, number>();

const isOnline = (status: string) => status !== "offline" && status !== "invisible";
const nameOf = (user?: User) => user?.globalName || user?.username || "Someone";

function snapshot(id: string): Seen {
    return {
        status: PresenceStore.getStatus(id) ?? "offline",
        game: PresenceStore.getActivities(id)?.find(a => a.type === 0)?.name ?? null
    };
}

function notify(id: string, title: string, body = "") {
    const key = `${id}:${title}`;
    if (Date.now() - (lastNotified.get(key) ?? 0) < 60_000) return;
    lastNotified.set(key, Date.now());

    const user = UserStore.getUser(id);
    showNotification({
        title,
        body: body || "Click to message them",
        icon: user?.getAvatarURL?.(undefined, 128),
        onClick: () => openPrivateChannel(id)
    });
}

function onPresenceChange() {
    for (const id of settings.store.watched ?? []) {
        const now = snapshot(id);
        const before = seen.get(id);
        seen.set(id, now);
        if (!before) continue;

        const name = nameOf(UserStore.getUser(id));
        if (!isOnline(before.status) && isOnline(now.status)) notify(id, `🟢 ${name} is online`, now.status === "online" ? "" : `Status: ${now.status}`);
        else if (settings.store.announceOffline && isOnline(before.status) && !isOnline(now.status)) notify(id, `⚫ ${name} went offline`);

        if (settings.store.announceGames && now.game && now.game !== before.game) notify(id, `🎮 ${name} is playing ${now.game}`);
    }
}

function toggleWatch(id: string) {
    const list = settings.store.watched ?? [];
    settings.store.watched = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    if (settings.store.watched.includes(id)) seen.set(id, snapshot(id));
    else seen.delete(id);
}

function WatchedList() {
    const { watched } = settings.use(["watched"]);
    if (!watched?.length) return <Paragraph style={{ color: "var(--text-muted)" }}>Nobody yet. Right-click someone and pick "Watch online status".</Paragraph>;

    return (
        <Flex flexDirection="column" gap={8}>
            {watched.map(id => {
                const user = UserStore.getUser(id);
                return (
                    <Flex key={id} alignItems="center" justifyContent="space-between">
                        <Paragraph>{nameOf(user)} <span style={{ color: "var(--text-muted)" }}>({PresenceStore.getStatus(id) ?? "unknown"})</span></Paragraph>
                        <Button size="small" variant="secondary" onClick={() => toggleWatch(id)}>Stop watching</Button>
                    </Flex>
                );
            })}
        </Flex>
    );
}

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id || user.bot) return;
    children.push(
        <Menu.MenuCheckboxItem
            id="rx-friendwatch"
            label="Watch online status"
            checked={(settings.store.watched ?? []).includes(user.id)}
            action={() => toggleWatch(user.id)}
        />
    );
};

export default definePlugin({
    name: "FriendWatch",
    description: "Get notified when the people you pick come online or start a game. Right-click a user and choose Watch online status",
    tags: ["Renuxcord", "Friends", "Notifications"],
    authors: [RenuxDevs.Larpbase],
    settings,

    contextMenus: {
        "user-context": userContext
    },

    start() {
        for (const id of settings.store.watched ?? []) seen.set(id, snapshot(id));
        PresenceStore.addChangeListener(onPresenceChange);
    },

    stop() {
        PresenceStore.removeChangeListener(onPresenceChange);
        seen.clear();
        lastNotified.clear();
    }
});
