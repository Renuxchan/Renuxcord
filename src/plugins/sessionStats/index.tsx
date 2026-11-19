/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { RenuxDevs } from "@utils/renuxcord";
import { mentionsUser, RawMessage, whereLabel } from "@utils/renuxcordMessages";
import definePlugin from "@utils/types";
import { Modal, openModal, SelectedChannelStore, UserStore } from "@webpack/common";

interface DayStats {
    messages: number;
    chars: number;
    mentions: number;
    voiceSeconds: number;
    onlineSeconds: number;
    channels: Record<string, number>;
}

const KEY = "Renuxcord_stats";
const TICK = 30;

let days: Record<string, DayStats> = {};
let dirty = false;
let timer: ReturnType<typeof setInterval> | null = null;
let sessionStart = Date.now();
let ticks = 0;

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function day(key = dayKey()): DayStats {
    return days[key] ??= { messages: 0, chars: 0, mentions: 0, voiceSeconds: 0, onlineSeconds: 0, channels: {} };
}

function sum(keys: string[]): DayStats {
    const total: DayStats = { messages: 0, chars: 0, mentions: 0, voiceSeconds: 0, onlineSeconds: 0, channels: {} };
    for (const k of keys) {
        const d = days[k];
        if (!d) continue;
        total.messages += d.messages;
        total.chars += d.chars;
        total.mentions += d.mentions;
        total.voiceSeconds += d.voiceSeconds;
        total.onlineSeconds += d.onlineSeconds;
        for (const [c, n] of Object.entries(d.channels)) total.channels[c] = (total.channels[c] ?? 0) + n;
    }
    return total;
}

function lastDays(n: number) {
    return Array.from({ length: n }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return dayKey(d);
    });
}

const hours = (s: number) => s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;

function save() {
    if (!dirty) return;
    dirty = false;

    const keys = Object.keys(days).sort();
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete days[k];
    void DataStore.set(KEY, days);
}

function summary() {
    const today = day();
    const week = sum(lastDays(7));
    const all = sum(Object.keys(days));
    const top = Object.entries(week.channels).sort((a, b) => b[1] - a[1]).slice(0, 3);

    return [
        `**📊 Your Discord stats** (this session: ${hours((Date.now() - sessionStart) / 1000)})`,
        `**Today:** ${today.messages} messages · ${today.chars.toLocaleString()} characters · ${today.mentions} pings · ${hours(today.voiceSeconds)} in voice · ${hours(today.onlineSeconds)} online`,
        `**Last 7 days:** ${week.messages} messages · ${week.mentions} pings · ${hours(week.voiceSeconds)} in voice · ${hours(week.onlineSeconds)} online`,
        `**All time (since Renuxcord):** ${all.messages.toLocaleString()} messages · ${hours(all.voiceSeconds)} in voice`,
        top.length ? `**Most active this week:** ${top.map(([c, n]) => `${whereLabel(c)} (${n})`).join(", ")}` : ""
    ].filter(Boolean).join("\n");
}

function openStats() {
    openModal(props => (
        <Modal {...props} title="Your Discord stats" subtitle="Tracked on this computer only" actions={[{ text: "Close", variant: "secondary", onClick: props.onClose }]}>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, color: "var(--text-default, var(--text-normal))" }}>
                {summary().replace(/\*\*/g, "")}
            </div>
        </Modal>
    ));
}

export default definePlugin({
    name: "SessionStats",
    description: "Tracks your own Discord habits locally: messages sent, pings, time online and in voice, most active channels (/stats)",
    tags: ["Renuxcord", "Utility", "Fun"],
    authors: [RenuxDevs.Larpbase],

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic: boolean; }) {
            if (optimistic || !message?.author) return;
            const me = UserStore.getCurrentUser()?.id;
            if (!me) return;

            if (message.author.id === me) {
                const d = day();
                d.messages++;
                d.chars += message.content?.length ?? 0;
                d.channels[message.channel_id] = (d.channels[message.channel_id] ?? 0) + 1;
                dirty = true;
            } else if (mentionsUser(message, me)) {
                day().mentions++;
                dirty = true;
            }
        }
    },

    commands: [{
        name: "stats",
        description: "Show your Discord stats (only you can see it)",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: (_, ctx) => void sendBotMessage(ctx.channel.id, { content: summary() })
    }],

    toolboxActions: {
        "Show my stats": openStats
    },

    async start() {
        days = (await DataStore.get<Record<string, DayStats>>(KEY)) ?? {};
        sessionStart = Date.now();

        timer = setInterval(() => {
            const d = day();
            d.onlineSeconds += TICK;
            if (SelectedChannelStore.getVoiceChannelId()) d.voiceSeconds += TICK;
            dirty = true;
            if (++ticks % 4 === 0) save();
        }, TICK * 1000);
    },

    stop() {
        if (timer) clearInterval(timer);
        timer = null;
        save();
    }
});
