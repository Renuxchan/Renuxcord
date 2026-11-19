/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { RenuxDevs } from "@utils/renuxcord";
import { matchesHotkey } from "@utils/renuxcordHotkeys";
import definePlugin, { OptionType } from "@utils/types";
import { showToast } from "@webpack/common";

interface Session { endsAt: number | null; previousStatus: string | null; ourStatus: string | null; reason: "manual" | "quiet"; }

const StatusSetting = getUserSettingLazy<string>("status", "status")!;

const settings = definePluginSettings({
    status: {
        type: OptionType.SELECT,
        description: "Status while focusing",
        options: [
            { label: "Do Not Disturb (no notifications)", value: "dnd", default: true },
            { label: "Invisible", value: "invisible" },
            { label: "Don't change my status", value: "keep" }
        ]
    },
    minutes: {
        type: OptionType.NUMBER,
        description: "Default session length in minutes (0 = until you end it)",
        default: 25
    },
    hideServers: {
        type: OptionType.BOOLEAN,
        description: "Hide the server list while focusing",
        default: true
    },
    hideMembers: {
        type: OptionType.BOOLEAN,
        description: "Hide member lists and Active Now while focusing",
        default: true
    },
    hotkey: {
        type: OptionType.STRING,
        description: "Shortcut to start or end focus",
        default: "ctrl+alt+f"
    },
    quietHours: {
        type: OptionType.BOOLEAN,
        description: "Turn focus on by itself during quiet hours",
        default: false
    },
    quietStart: {
        type: OptionType.STRING,
        description: "Quiet hours start (24h, e.g. 23:00)",
        default: "23:00"
    },
    quietEnd: {
        type: OptionType.STRING,
        description: "Quiet hours end (24h, e.g. 07:00)",
        default: "07:00"
    },
    session: {
        type: OptionType.CUSTOM,
        default: null as Session | null
    }
});

let pill: HTMLDivElement | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;
let quietTimer: ReturnType<typeof setInterval> | undefined;

const CSS_ID = "rx-focus-style";
const CSS = `
body.rx-focus-servers nav[class*="guilds_"] { display: none !important; }
body.rx-focus-members [class*="membersWrap_"], body.rx-focus-members [class*="nowPlayingColumn_"] { display: none !important; }
#rx-focus-pill {
    position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 10000;
    padding: 6px 14px; border-radius: 999px; cursor: pointer; user-select: none;
    background: linear-gradient(90deg, #7c3aed, #db2777); color: #fff;
    font: 600 13px var(--font-primary, sans-serif); box-shadow: 0 6px 20px rgb(0 0 0 / 35%);
}
#rx-focus-pill:hover { filter: brightness(1.1); }
`;

const minutesOf = (hhmm: string) => {
    const m = /^(\d{1,2}):?(\d{2})?$/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    return h < 24 && min < 60 ? h * 60 + min : null;
};

function inQuietHours(now = new Date()) {
    const start = minutesOf(settings.store.quietStart);
    const end = minutesOf(settings.store.quietEnd);
    if (start == null || end == null || start === end) return false;
    const t = now.getHours() * 60 + now.getMinutes();
    return start < end ? t >= start && t < end : t >= start || t < end;
}

function applyLayout(on: boolean) {
    document.body.classList.toggle("rx-focus-servers", on && settings.store.hideServers);
    document.body.classList.toggle("rx-focus-members", on && settings.store.hideMembers);
}

function renderPill() {
    const { session } = settings.store;
    if (!session) {
        pill?.remove();
        pill = null;
        return;
    }
    if (!pill) {
        pill = document.createElement("div");
        pill.id = "rx-focus-pill";
        pill.title = "Click to end focus";
        pill.onclick = () => endFocus(true);
        document.body.appendChild(pill);
    }
    if (session.endsAt) {
        const left = Math.max(0, session.endsAt - Date.now());
        const mm = Math.floor(left / 60_000);
        const ss = String(Math.floor(left % 60_000 / 1000)).padStart(2, "0");
        pill.textContent = `🎯 Focus · ${mm}:${ss} left`;
    } else {
        pill.textContent = session.reason === "quiet" ? "🌙 Quiet hours · click to end" : "🎯 Focus mode · click to end";
    }
}

function tick() {
    const { session } = settings.store;
    if (session?.endsAt && Date.now() >= session.endsAt) {
        endFocus(false);
        showNotification({ title: "🎉 Focus session done", body: "Nice work. Take a short break before the next one." });
        return;
    }
    renderPill();
}

async function startFocus(minutes: number | null, reason: Session["reason"] = "manual") {
    if (settings.store.session) return;

    let previousStatus: string | null = null;
    let ourStatus: string | null = null;
    if (settings.store.status !== "keep") {
        try {
            previousStatus = StatusSetting.getSetting();
            ourStatus = settings.store.status;
            if (previousStatus !== ourStatus) await StatusSetting.updateSetting(ourStatus);
        } catch {
            previousStatus = ourStatus = null;
        }
    }

    settings.store.session = { endsAt: minutes ? Date.now() + minutes * 60_000 : null, previousStatus, ourStatus, reason };
    applyLayout(true);
    tick();
    clearInterval(ticker);
    ticker = setInterval(tick, 1000);
    if (reason === "manual") showToast({ text: minutes ? `🎯 Focusing for ${minutes} minutes` : "🎯 Focus mode on", variant: "success" });
}

function endFocus(announce: boolean) {
    const { session } = settings.store;
    if (!session) return;

    settings.store.session = null;
    clearInterval(ticker);
    applyLayout(false);
    renderPill();

    // Only put the old status back if nobody changed it in the meantime
    try {
        if (session.previousStatus && session.ourStatus && StatusSetting.getSetting() === session.ourStatus && session.previousStatus !== session.ourStatus)
            void StatusSetting.updateSetting(session.previousStatus);
    } catch { }

    if (announce) showToast({ text: "Focus mode off" });
}

function toggle(minutes?: number) {
    if (settings.store.session) endFocus(true);
    else void startFocus(minutes ?? (settings.store.minutes > 0 ? settings.store.minutes : null));
}

function checkQuietHours() {
    const { session } = settings.store;
    const quiet = settings.store.quietHours && inQuietHours();
    if (quiet && !session) void startFocus(null, "quiet");
    else if (!quiet && session?.reason === "quiet") endFocus(false);
}

function onKeyDown(e: KeyboardEvent) {
    if (!settings.store.hotkey || !matchesHotkey(settings.store.hotkey, e)) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
}

export default definePlugin({
    name: "FocusMode",
    description: "One key (Ctrl+Alt+F) to focus: Do Not Disturb, hides the server and member lists, optional Pomodoro timer, and quiet hours that switch it on by themselves. Your old status comes back after",
    tags: ["Renuxcord", "Utility", "Appearance"],
    authors: [RenuxDevs.Larpbase],
    settings,

    toolboxActions: {
        "Toggle Focus Mode": () => toggle()
    },

    commands: [{
        name: "focus",
        description: "Start or end a focus session",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{ name: "minutes", description: "How long (0 = until you end it). Leave empty to toggle", type: ApplicationCommandOptionType.INTEGER, required: false }],
        execute(args, ctx) {
            const minutes = findOption<number | undefined>(args, "minutes", undefined);
            if (minutes === undefined) return void toggle();
            if (settings.store.session) endFocus(false);
            void startFocus(minutes > 0 ? minutes : null);
            sendBotMessage(ctx.channel.id, { content: minutes > 0 ? `🎯 Focusing for ${minutes} minutes. Click the pill at the top to stop early.` : "🎯 Focus mode on until you end it." });
        }
    }],

    start() {
        const style = document.createElement("style");
        style.id = CSS_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
        document.addEventListener("keydown", onKeyDown, true);

        // Pick up a session that was running when Discord closed
        if (settings.store.session) {
            applyLayout(true);
            ticker = setInterval(tick, 1000);
            tick();
        }
        checkQuietHours();
        quietTimer = setInterval(checkQuietHours, 60_000);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        clearInterval(quietTimer);
        endFocus(false);
        document.getElementById(CSS_ID)?.remove();
    }
});
