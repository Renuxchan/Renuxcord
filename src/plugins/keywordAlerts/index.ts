/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import { authorName, avatarOf, isViewing, jumpTo, RawMessage, truncate, whereLabel } from "@utils/renuxcordMessages";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

const settings = definePluginSettings({
    keywords: {
        type: OptionType.STRING,
        description: "One keyword or phrase per line. Use /pattern/flags for a regex, e.g. /\\bval(orant)?\\b/i",
        default: "",
        multiline: true
    },
    wholeWords: {
        type: OptionType.BOOLEAN,
        description: "Plain keywords only match whole words (\"cat\" won't match \"category\")",
        default: true
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore messages from bots and webhooks",
        default: true
    },
    alertWhileViewing: {
        type: OptionType.BOOLEAN,
        description: "Alert even when you're looking at that channel",
        default: false
    }
});

interface Rule {
    label: string;
    re: RegExp;
}

interface Hit {
    rule: string;
    author: string;
    where: string;
    content: string;
    channelId: string;
    messageId: string;
    at: number;
}

let compiledFrom: string | null = null;
let compiledWhole: boolean | null = null;
let compiled: Rule[] = [];
const hits: Hit[] = [];

function rules(): Rule[] {
    const source = settings.store.keywords ?? "";
    const { wholeWords } = settings.store;
    if (source === compiledFrom && wholeWords === compiledWhole) return compiled;

    compiledFrom = source;
    compiledWhole = wholeWords;
    compiled = source.split(/\r?\n/).map(l => l.trim()).filter(Boolean).flatMap(line => {
        try {
            const regex = /^\/(.+)\/([a-z]*)$/i.exec(line);
            if (regex) return [{ label: line, re: new RegExp(regex[1], regex[2].replace(/[gy]/g, "")) }];

            const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
            return [{ label: line, re: new RegExp(pattern, "iu") }];
        } catch {
            return [];
        }
    });
    return compiled;
}

export default definePlugin({
    name: "KeywordAlerts",
    description: "Get a notification whenever a message anywhere mentions one of your keywords or regexes (your name, a game, a topic…)",
    tags: ["Renuxcord", "Notifications", "Chat"],
    authors: [RenuxDevs.Larpbase],
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic: boolean; }) {
            if (optimistic || !message?.content || !message.author) return;
            if (message.author.id === UserStore.getCurrentUser()?.id) return;
            if (settings.store.ignoreBots && message.author.bot) return;
            if (!settings.store.alertWhileViewing && isViewing(message.channel_id)) return;

            const rule = rules().find(r => r.re.test(message.content!));
            if (!rule) return;

            const hit: Hit = {
                rule: rule.label,
                author: authorName(message.author),
                where: whereLabel(message.channel_id),
                content: truncate(message.content, 300),
                channelId: message.channel_id,
                messageId: message.id,
                at: Date.now()
            };
            hits.unshift(hit);
            if (hits.length > 50) hits.length = 50;

            showNotification({
                title: `🔔 ${rule.label}`,
                body: `${hit.author} in ${hit.where}: ${truncate(message.content)}`,
                icon: avatarOf(message.author),
                onClick: () => jumpTo(message.channel_id, message.id)
            });
        }
    },

    commands: [{
        name: "keywords",
        description: "Show your keyword rules and the latest matches",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            const list = rules();
            const lines = [
                list.length ? `**Watching ${list.length} keyword${list.length === 1 ? "" : "s"}:** ${list.map(r => `\`${r.label}\``).join(", ")}` : "No keywords yet. Add some in the KeywordAlerts plugin settings.",
                "",
                hits.length ? "**Latest matches:**" : "No matches yet this session.",
                ...hits.slice(0, 10).map(h => `• <t:${Math.floor(h.at / 1000)}:R> **${h.author}** in ${h.where} (\`${h.rule}\`): ${h.content}`)
            ];
            sendBotMessage(ctx.channel.id, { content: lines.join("\n") });
        }
    }],

    stop() {
        hits.length = 0;
    }
});
