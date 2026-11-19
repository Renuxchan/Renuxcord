/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { GuildStore, PresenceStore, RelationshipStore, RunningGameStore } from "@webpack/common";

interface CustomStatus { text: string; emojiId: string; emojiName: string; expiresAtMs: string; createdAtMs: string; }

const CustomStatusSetting = getUserSettingLazy<CustomStatus | undefined>("status", "customStatus")!;
const logger = new Logger("StatusRotator");

const settings = definePluginSettings({
    statuses: {
        type: OptionType.STRING,
        description: "One status per line. Start a line with an emoji to use it as the status emoji. Tokens: {time} {date} {day} {game} {servers} {online}",
        multiline: true,
        default: "🎮 playing {game}\n🕐 it's {time} here\n✨ running Renuxcord\n💬 {online} friends online",
        onChange: () => restart()
    },
    minutes: {
        type: OptionType.NUMBER,
        description: "Minutes between changes (at least 2)",
        default: 5,
        onChange: () => restart()
    },
    shuffle: {
        type: OptionType.BOOLEAN,
        description: "Random order instead of top to bottom",
        default: false
    },
    original: {
        type: OptionType.CUSTOM,
        default: null as CustomStatus | null
    },
    saved: {
        type: OptionType.CUSTOM,
        default: false
    }
});

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
let index = -1;

const EMOJI_AT_START = /^(<a?:(\w+):(\d+)>|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;

function fill(text: string) {
    const now = new Date();
    const game = (() => {
        try {
            return RunningGameStore.getVisibleGame()?.name;
        } catch {
            return undefined;
        }
    })();
    const online = RelationshipStore.getFriendIDs().filter(id => {
        const s = PresenceStore.getStatus(id);
        return s && s !== "offline" && s !== "invisible";
    }).length;

    return text
        .replace(/\{time\}/g, now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))
        .replace(/\{date\}/g, now.toLocaleDateString(undefined, { month: "short", day: "numeric" }))
        .replace(/\{day\}/g, now.toLocaleDateString(undefined, { weekday: "long" }))
        .replace(/\{game\}/g, game ?? "nothing rn")
        .replace(/\{servers\}/g, String(Object.keys(GuildStore.getGuilds()).length))
        .replace(/\{online\}/g, String(online));
}

export function parseLine(line: string): Omit<CustomStatus, "expiresAtMs" | "createdAtMs"> {
    const m = EMOJI_AT_START.exec(line);
    if (!m) return { text: line.trim(), emojiId: "0", emojiName: "" };
    const rest = line.slice(m[0].length).trim();
    return m[3]
        ? { text: rest, emojiId: m[3], emojiName: m[2] }
        : { text: rest, emojiId: "0", emojiName: m[1] };
}

const lines = () => settings.store.statuses.split("\n").map(l => l.trim()).filter(Boolean);

async function rotate() {
    const list = lines();
    if (!list.length) return;
    index = settings.store.shuffle && list.length > 1
        ? (index + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length
        : (index + 1) % list.length;

    const { text, emojiId, emojiName } = parseLine(fill(list[index]));
    try {
        await CustomStatusSetting.updateSetting({ text: text.slice(0, 128), emojiId, emojiName, expiresAtMs: "0", createdAtMs: String(Date.now()) });
    } catch (err) {
        logger.error("Couldn't update the custom status", err);
    }
}

function restart() {
    clearInterval(timer);
    if (!running) return;
    const minutes = Math.max(2, Number(settings.store.minutes) || 5);
    void rotate();
    timer = setInterval(rotate, minutes * 60_000);
}

export default definePlugin({
    name: "StatusRotator",
    description: "Cycles your custom status through a list every few minutes, with live tokens like {time}, {game} and {online}. Your normal status comes back when you turn it off",
    tags: ["Renuxcord", "Customisation", "Activity"],
    authors: [RenuxDevs.Larpbase],
    settings,

    start() {
        // Remember the status they had before, once, so it survives restarts
        if (!settings.store.saved) {
            try {
                const current = CustomStatusSetting.getSetting();
                settings.store.original = current ? { ...current } : null;
            } catch {
                settings.store.original = null;
            }
            settings.store.saved = true;
        }
        running = true;
        restart();
    },

    stop() {
        running = false;
        clearInterval(timer);
        const { original } = settings.store;
        try {
            void CustomStatusSetting.updateSetting(original?.text || original?.emojiName ? { ...original, createdAtMs: String(Date.now()) } : undefined);
        } catch (err) {
            logger.error("Couldn't restore the custom status", err);
        }
        settings.store.saved = false;
        settings.store.original = null;
    }
});
