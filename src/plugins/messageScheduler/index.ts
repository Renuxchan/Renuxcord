/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { RenuxDevs } from "@utils/renuxcord";
import { truncate, whereLabel } from "@utils/renuxcordMessages";
import definePlugin from "@utils/types";
import { ChannelStore, showToast } from "@webpack/common";

interface Scheduled {
    id: number;
    channelId: string;
    content: string;
    at: number;
    createdAt: number;
}

const KEY = "Renuxcord_scheduledMessages";
const MISSED_AFTER = 5 * 60_000;
const MAX_AHEAD = 30 * 24 * 60 * 60_000;
const logger = new Logger("MessageScheduler", "#a78bfa");

let queue: Scheduled[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

const save = () => DataStore.set(KEY, queue);
const stamp = (ms: number, style = "f") => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** "10m", "2h30m", "1d", "in 5 minutes", "18:30", "9pm", "tomorrow 9:00" → timestamp */
export function parseWhen(input: string, now = new Date()): number | null {
    const s = input.trim().toLowerCase();

    const rel = /^(?:in\s+)?(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?$/.exec(s);
    if (rel && rel.slice(1).some(Boolean)) {
        const [d, h, m, sec] = rel.slice(1).map(v => Number(v ?? 0));
        const ms = ((d * 24 + h) * 60 + m) * 60_000 + sec * 1000;
        return ms > 0 ? now.getTime() + ms : null;
    }

    const abs = /^(tomorrow\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
    if (abs) {
        let hour = Number(abs[2]);
        const min = Number(abs[3] ?? 0);
        if (abs[4]) {
            if (hour < 1 || hour > 12) return null;
            hour = hour % 12 + (abs[4] === "pm" ? 12 : 0);
        }
        if (hour > 23 || min > 59) return null;

        const date = new Date(now);
        date.setHours(hour, min, 0, 0);
        if (abs[1] || date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
        return date.getTime();
    }

    return null;
}

async function send(item: Scheduled) {
    queue = queue.filter(q => q.id !== item.id);
    void save();

    if (!ChannelStore.getChannel(item.channelId)) {
        showNotification({ title: "Scheduled message not sent", body: `Couldn't find the channel any more: ${truncate(item.content)}` });
        return;
    }

    try {
        await sendMessage(item.channelId, { content: item.content }, false);
        showToast({ text: `⏰ Sent your scheduled message in ${whereLabel(item.channelId)}`, variant: "success" });
    } catch (err) {
        logger.error("Sending failed", err);
        showNotification({ title: "Scheduled message failed", body: truncate(item.content) });
    }
}

function tick() {
    const now = Date.now();
    for (const item of queue.filter(q => q.at <= now)) void send(item);
}

export default definePlugin({
    name: "MessageScheduler",
    description: "Schedule messages to send later with /schedule (10m, 2h, 18:30, tomorrow 9am…). Sends while Discord is open",
    tags: ["Renuxcord", "Chat", "Commands", "Utility"],
    authors: [RenuxDevs.Larpbase],

    commands: [
        {
            name: "schedule",
            description: "Send a message later (Discord has to be open then)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "when", description: "10m, 2h30m, 1d, 18:30, 9pm, tomorrow 9:00", type: ApplicationCommandOptionType.STRING, required: true },
                { name: "message", description: "What to send", type: ApplicationCommandOptionType.STRING, required: true }
            ],
            execute(args, ctx) {
                const when = parseWhen(findOption(args, "when", ""));
                const content = findOption(args, "message", "").replaceAll("\\n", "\n");

                if (!when) return sendBotMessage(ctx.channel.id, { content: "❌ I didn't get that time. Try `10m`, `2h30m`, `18:30`, `9pm` or `tomorrow 9:00`." });
                if (when - Date.now() > MAX_AHEAD) return sendBotMessage(ctx.channel.id, { content: "❌ That's too far away, 30 days is the limit." });
                if (content.length > 2000) return sendBotMessage(ctx.channel.id, { content: "❌ Scheduled messages can be at most 2000 characters." });

                queue.push({ id: Date.now(), channelId: ctx.channel.id, content, at: when, createdAt: Date.now() });
                queue.sort((a, b) => a.at - b.at);
                void save();

                sendBotMessage(ctx.channel.id, {
                    content: `⏰ Scheduled for ${stamp(when, "F")} (${stamp(when, "R")}). Keep Discord open until then. \`/scheduled list\` to see or cancel it.`
                });
            }
        },
        {
            name: "scheduled",
            description: "See or cancel your scheduled messages",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "list", description: "List scheduled messages", type: ApplicationCommandOptionType.SUB_COMMAND, options: [] },
                {
                    name: "cancel",
                    description: "Cancel one by its number from the list",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [{ name: "number", description: "Number from /scheduled list", type: ApplicationCommandOptionType.INTEGER, required: true }]
                },
                { name: "clear", description: "Cancel all of them", type: ApplicationCommandOptionType.SUB_COMMAND, options: [] }
            ],
            execute(args, ctx) {
                const reply = (content: string) => sendBotMessage(ctx.channel.id, { content });

                switch (args[0].name) {
                    case "list":
                        return reply(queue.length
                            ? queue.map((q, i) => `**${i + 1}.** ${stamp(q.at, "f")} (${stamp(q.at, "R")}) in ${whereLabel(q.channelId)}: ${truncate(q.content, 120)}`).join("\n")
                            : "Nothing scheduled.");
                    case "cancel": {
                        const n = findOption(args[0].options, "number", 0);
                        const item = queue[n - 1];
                        if (!item) return reply("❌ No scheduled message with that number.");
                        queue = queue.filter(q => q !== item);
                        void save();
                        return reply(`🗑️ Cancelled: ${truncate(item.content, 120)}`);
                    }
                    case "clear": {
                        const count = queue.length;
                        queue = [];
                        void save();
                        return reply(`🗑️ Cancelled ${count} scheduled message${count === 1 ? "" : "s"}.`);
                    }
                }
            }
        }
    ],

    async start() {
        queue = (await DataStore.get<Scheduled[]>(KEY)) ?? [];

        const now = Date.now();
        const missed = queue.filter(q => now - q.at > MISSED_AFTER);
        if (missed.length) {
            queue = queue.filter(q => !missed.includes(q));
            void save();
            showNotification({
                title: `${missed.length} scheduled message${missed.length === 1 ? " was" : "s were"} missed`,
                body: `Discord was closed when ${missed.length === 1 ? "it was" : "they were"} due, so nothing was sent: ${missed.map(m => truncate(m.content, 60)).join(" · ")}`
            });
        }

        timer = setInterval(tick, 5_000);
        tick();
    },

    stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }
});
