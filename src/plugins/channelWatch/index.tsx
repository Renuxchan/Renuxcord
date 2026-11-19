/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import { authorName, avatarOf, isViewing, jumpTo, RawMessage, truncate, whereLabel } from "@utils/renuxcordMessages";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, Menu, showToast, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    channels: {
        type: OptionType.CUSTOM,
        default: [] as string[]
    },
    includeBots: {
        type: OptionType.BOOLEAN,
        description: "Also notify for messages from bots and webhooks (announcements, feeds, drops)",
        default: true
    }
});

const watched = () => new Set(settings.store.channels ?? []);

function toggle(channel: Channel) {
    const set = watched();
    const on = !set.has(channel.id);
    if (on) set.add(channel.id);
    else set.delete(channel.id);
    settings.store.channels = [...set];
    showToast({ text: on ? `👁️ Watching ${whereLabel(channel.id)}: you'll get a notification for every message` : "Stopped watching that channel", variant: on ? "success" : "default" });
}

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel) return;
    children.push(
        <Menu.MenuCheckboxItem
            id="rx-watch-channel"
            label="Watch channel (notify every message)"
            checked={watched().has(channel.id)}
            action={() => toggle(channel)}
        />
    );
};

export default definePlugin({
    name: "ChannelWatch",
    description: "Right-click any channel → Watch to get a notification for every new message in it, even in muted servers. Great for announcements, drops and giveaways",
    tags: ["Renuxcord", "Notifications", "Servers"],
    authors: [RenuxDevs.Larpbase],
    settings,

    contextMenus: {
        "channel-context": channelContext,
        "thread-context": channelContext
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage & { webhook_id?: string; }; optimistic?: boolean; }) {
            if (optimistic || !message?.channel_id || !watched().has(message.channel_id)) return;
            if (message.author?.id === UserStore.getCurrentUser()?.id || isViewing(message.channel_id)) return;
            if (!settings.store.includeBots && (message.author?.bot || message.webhook_id)) return;

            const files = message.attachments?.length ? ` 📎 ${message.attachments.length}` : "";
            showNotification({
                title: `👁️ ${whereLabel(message.channel_id)}`,
                body: `${authorName(message.author)}: ${truncate(message.content || "(no text)", 200)}${files}`,
                icon: avatarOf(message.author),
                onClick: () => jumpTo(message.channel_id, message.id)
            });
        }
    },

    commands: [{
        name: "watching",
        description: "Channels you're watching with ChannelWatch",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            const list = [...watched()].filter(id => ChannelStore.getChannel(id));
            sendBotMessage(ctx.channel.id, {
                content: list.length
                    ? ["👁️ **Watching**", ...list.map(id => `• <#${id}> · ${whereLabel(id)}`)].join("\n")
                    : "👁️ You're not watching any channels. Right-click a channel → Watch channel."
            });
        }
    }]
});
