/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import { authorName, RawMessage, truncate } from "@utils/renuxcordMessages";
import { timeAgo } from "@utils/renuxcordTime";
import definePlugin, { OptionType } from "@utils/types";
import { CommandArgument } from "@vencord/discord-types";

interface Cached { id: string; content: string; author?: RawMessage["author"]; attachments: string[]; at: number; }
interface Deleted extends Cached { deletedAt: number; }
interface Edited { author?: RawMessage["author"]; before: string; after: string; editedAt: number; messageId: string; }

const PER_CHANNEL = 50;
const MAX_CHANNELS = 150;
const KEEP_SNIPES = 15;

// Recent messages per channel, so deleted ones can still be shown. Insertion order doubles as LRU order
const cache = new Map<string, Map<string, Cached>>();
const deleted = new Map<string, Deleted[]>();
const edits = new Map<string, Edited[]>();

const settings = definePluginSettings({
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore messages from bots",
        default: true
    }
});

function remember(raw: RawMessage) {
    if (!raw?.id || !raw.channel_id) return;
    if (settings.store.ignoreBots && raw.author?.bot) return;

    let channel = cache.get(raw.channel_id);
    if (channel) cache.delete(raw.channel_id);
    else channel = new Map();
    cache.set(raw.channel_id, channel);
    if (cache.size > MAX_CHANNELS) cache.delete(cache.keys().next().value!);

    channel.set(raw.id, {
        id: raw.id,
        content: raw.content ?? "",
        author: raw.author,
        attachments: ((raw.attachments ?? []) as Array<{ filename?: string; url?: string; }>).map(a => a.url ?? a.filename ?? "file"),
        at: raw.timestamp ? Date.parse(raw.timestamp) : Date.now()
    });
    if (channel.size > PER_CHANNEL) channel.delete(channel.keys().next().value!);
}

function onDelete(channelId: string, id: string) {
    const msg = cache.get(channelId)?.get(id);
    if (!msg || (!msg.content && !msg.attachments.length)) return;
    cache.get(channelId)!.delete(id);
    const list = [{ ...msg, deletedAt: Date.now() }, ...deleted.get(channelId) ?? []].slice(0, KEEP_SNIPES);
    deleted.set(channelId, list);
}

function onUpdate(raw: RawMessage) {
    const old = cache.get(raw.channel_id)?.get(raw.id);
    if (old && typeof raw.content === "string" && raw.content !== old.content) {
        const list = [{ author: old.author, before: old.content, after: raw.content, editedAt: Date.now(), messageId: raw.id }, ...edits.get(raw.channel_id) ?? []].slice(0, KEEP_SNIPES);
        edits.set(raw.channel_id, list);
    }
    if (typeof raw.content === "string") remember({ ...raw, author: raw.author ?? old?.author, timestamp: undefined });
}

const quote = (text: string) => truncate(text, 600).split("\n").map(l => `> ${l}`).join("\n");

async function reply(args: CommandArgument[], channelId: string, text: string) {
    if (findOption(args, "public", false)) await sendMessage(channelId, { content: text.slice(0, 2000) });
    else sendBotMessage(channelId, { content: text });
}

const countOption = { name: "count", description: "How many (default 1, max 10)", type: ApplicationCommandOptionType.INTEGER, required: false };
const publicOption = { name: "public", description: "Post it in chat for everyone", type: ApplicationCommandOptionType.BOOLEAN, required: false };

export default definePlugin({
    name: "Snipe",
    description: "/snipe shows the last deleted messages in a channel and /editsnipe what a message said before it was edited. Works for messages that arrive while Discord is open",
    tags: ["Renuxcord", "Chat", "Commands"],
    authors: [RenuxDevs.Larpbase],
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic?: boolean; }) {
            if (!optimistic) remember(message);
        },
        LOAD_MESSAGES_SUCCESS({ messages }: { messages: RawMessage[]; }) {
            for (const m of messages?.slice(0, PER_CHANNEL).reverse() ?? []) remember(m);
        },
        MESSAGE_UPDATE({ message }: { message: RawMessage; }) {
            if (message?.id && message.channel_id) onUpdate(message);
        },
        MESSAGE_DELETE({ id, channelId }: { id: string; channelId: string; }) {
            onDelete(channelId, id);
        },
        MESSAGE_DELETE_BULK({ ids, channelId }: { ids: string[]; channelId: string; }) {
            for (const id of ids ?? []) onDelete(channelId, id);
        }
    },

    commands: [
        {
            name: "snipe",
            description: "Show the last deleted messages in this channel",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [countOption, publicOption],
            execute(args, ctx) {
                const count = Math.min(Math.max(Number(findOption(args, "count", 1)), 1), 10);
                const list = deleted.get(ctx.channel.id)?.slice(0, count) ?? [];
                if (!list.length) return void sendBotMessage(ctx.channel.id, { content: "🎯 Nothing to snipe here. No deleted messages since Discord started." });

                void reply(args, ctx.channel.id, list.map(m => [
                    `🗑️ **${authorName(m.author)}** · deleted ${timeAgo(m.deletedAt)}`,
                    m.content ? quote(m.content) : "",
                    m.attachments.length ? `📎 ${m.attachments.length} attachment${m.attachments.length === 1 ? "" : "s"}` : ""
                ].filter(Boolean).join("\n")).join("\n\n"));
            }
        },
        {
            name: "editsnipe",
            description: "Show what recently edited messages in this channel said before",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [countOption, publicOption],
            execute(args, ctx) {
                const count = Math.min(Math.max(Number(findOption(args, "count", 1)), 1), 10);
                const list = edits.get(ctx.channel.id)?.slice(0, count) ?? [];
                if (!list.length) return void sendBotMessage(ctx.channel.id, { content: "✏️ No edits caught in this channel since Discord started." });

                void reply(args, ctx.channel.id, list.map(e =>
                    `✏️ **${authorName(e.author)}** · edited ${timeAgo(e.editedAt)}\n**Before**\n${quote(e.before || "(empty)")}\n**After**\n${quote(e.after || "(empty)")}`
                ).join("\n\n"));
            }
        }
    ],

    stop() {
        cache.clear();
        deleted.clear();
        edits.clear();
    }
});
