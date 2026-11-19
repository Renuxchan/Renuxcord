/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import { dayKey, shortDuration } from "@utils/renuxcordTime";
import definePlugin, { OptionType } from "@utils/types";
import { Modal, openModal, RunningGameStore, useState } from "@webpack/common";

/** day → game → milliseconds */
type Days = Record<string, Record<string, number>>;

const KEY = "Renuxcord_playtime";
const TICK = 60_000;
const KEEP_DAYS = 400;

let days: Days = {};
let lastTick = 0;
let timer: ReturnType<typeof setInterval> | undefined;
/** game → when the current session started, for break reminders */
const sessions = new Map<string, { start: number; reminded: number; }>();

const settings = definePluginSettings({
    breakReminder: {
        type: OptionType.SLIDER,
        description: "Remind me to take a break after this many hours of playing in one go (0 = never)",
        markers: [0, 1, 2, 3, 4, 6],
        default: 2,
        stickToMarkers: true
    }
});

const PERIODS: Record<string, { label: string; days: number; }> = {
    today: { label: "Today", days: 1 },
    week: { label: "Last 7 days", days: 7 },
    month: { label: "Last 30 days", days: 30 },
    all: { label: "All time", days: KEEP_DAYS }
};

function runningGames() {
    try {
        return [...new Set(RunningGameStore.getRunningGames().map(g => g.name).filter(Boolean))];
    } catch {
        return [];
    }
}

function tick() {
    const now = Date.now();
    // Cap the step so sleep or a frozen app doesn't count as playtime
    const step = lastTick ? Math.min(now - lastTick, TICK * 2) : 0;
    lastTick = now;

    const games = runningGames();
    for (const name of [...sessions.keys()]) if (!games.includes(name)) sessions.delete(name);
    if (!games.length) return;

    const today = (days[dayKey()] ??= {});
    for (const name of games) {
        today[name] = (today[name] ?? 0) + step;

        const session = sessions.get(name) ?? { start: now, reminded: 0 };
        sessions.set(name, session);
        const every = settings.store.breakReminder * 3_600_000;
        if (every > 0 && now - session.start >= every * (session.reminded + 1)) {
            session.reminded++;
            showNotification({
                title: `🎮 ${shortDuration(now - session.start)} of ${name}`,
                body: "Good time for a quick break: stretch, drink some water, rest your eyes."
            });
        }
    }

    const cutoff = dayKey(new Date(now - KEEP_DAYS * 86_400_000));
    for (const day of Object.keys(days)) if (day < cutoff) delete days[day];
    void DataStore.set(KEY, days);
}

export function totals(periodDays: number) {
    const sums: Record<string, number> = {};
    for (let i = 0; i < periodDays; i++) {
        const day = days[dayKey(new Date(Date.now() - i * 86_400_000))];
        if (day) for (const [game, ms] of Object.entries(day)) sums[game] = (sums[game] ?? 0) + ms;
    }
    return Object.entries(sums).filter(([, ms]) => ms >= 60_000).sort((a, b) => b[1] - a[1]);
}

const bar = (fraction: number, width = 12) => "█".repeat(Math.max(1, Math.round(fraction * width))).padEnd(width, "░");

function summary(period: string) {
    const { label, days: n } = PERIODS[period] ?? PERIODS.week;
    const rows = totals(n);
    if (!rows.length) return `🎮 **${label}:** no games tracked yet. Discord has to detect the game (Settings › Registered Games).`;

    const total = rows.reduce((a, [, ms]) => a + ms, 0);
    const now = runningGames().map(g => `**${g}** for ${shortDuration(Date.now() - (sessions.get(g)?.start ?? Date.now()))}`);
    return [
        `🎮 **Playtime · ${label}** · ${shortDuration(total)} total`,
        ...rows.slice(0, 12).map(([game, ms], i) => `\`${bar(ms / rows[0][1])}\` ${i + 1}. **${game}** · ${shortDuration(ms)}`),
        ...now.length ? [`\n▶️ Playing right now: ${now.join(", ")}`] : []
    ].join("\n");
}

function StatsModal() {
    const [period, setPeriod] = useState("week");
    const rows = totals(PERIODS[period].days);
    const max = rows[0]?.[1] ?? 1;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 6 }}>
                {Object.entries(PERIODS).map(([id, p]) => (
                    <button
                        key={id}
                        onClick={() => setPeriod(id)}
                        style={{
                            padding: "6px 12px", borderRadius: 999, border: "none", cursor: "pointer", fontWeight: 600,
                            background: id === period ? "var(--brand-500, #5865f2)" : "var(--background-mod-strong, rgb(255 255 255 / 10%))",
                            color: id === period ? "#fff" : "var(--text-default, var(--text-normal))"
                        }}
                    >{p.label}</button>
                ))}
            </div>
            {rows.length ? rows.slice(0, 20).map(([game, ms]) => (
                <div key={game} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 2fr 70px", alignItems: "center", gap: 10 }}>
                    <b style={{ color: "var(--text-default, var(--text-normal))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{game}</b>
                    <div style={{ height: 10, borderRadius: 5, background: "var(--background-mod-strong, rgb(255 255 255 / 10%))" }}>
                        <div style={{ width: `${Math.max(3, ms / max * 100)}%`, height: "100%", borderRadius: 5, background: "linear-gradient(90deg, #a78bfa, #ec4899)" }} />
                    </div>
                    <span style={{ color: "var(--text-muted)", textAlign: "right" }}>{shortDuration(ms)}</span>
                </div>
            )) : <span style={{ color: "var(--text-muted)" }}>Nothing tracked for this period yet.</span>}
        </div>
    );
}

const openStats = () => openModal(props => (
    <Modal {...props} size="md" title="🎮 Playtime" subtitle="Tracked on this computer while Discord is open">
        <StatsModal />
    </Modal>
));

export default definePlugin({
    name: "PlaytimeTracker",
    description: "Tracks how long you play each game (today, this week, this month, all time) with /playtime, and reminds you to take breaks on long sessions",
    tags: ["Renuxcord", "Activity", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    toolboxActions: {
        "Playtime stats": openStats
    },

    flux: {
        RUNNING_GAMES_CHANGE: () => tick()
    },

    commands: [{
        name: "playtime",
        description: "How long you've been playing your games",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{
            name: "period",
            description: "Which time range (default last 7 days)",
            type: ApplicationCommandOptionType.STRING,
            required: false,
            choices: Object.entries(PERIODS).map(([value, p]) => ({ name: p.label, label: p.label, value }))
        }],
        execute(args, ctx) {
            tick();
            sendBotMessage(ctx.channel.id, { content: summary(findOption(args, "period", "week")) });
        }
    }],

    async start() {
        days = (await DataStore.get<Days>(KEY)) ?? {};
        lastTick = Date.now();
        timer = setInterval(tick, TICK);
    },

    stop() {
        clearInterval(timer);
        tick();
        lastTick = 0;
        sessions.clear();
    }
});
