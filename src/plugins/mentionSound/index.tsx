/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Logger } from "@utils/Logger";
import { RenuxDevs } from "@utils/renuxcord";
import { isViewing, mentionsUser, RawMessage } from "@utils/renuxcordMessages";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { ChannelStore, showToast, UserStore } from "@webpack/common";

const logger = new Logger("MentionSound", "#a78bfa");

type Synth = (ac: AudioContext, out: AudioNode) => void;

function note(ac: AudioContext, out: AudioNode, freq: number, at: number, dur: number, type: OscillatorType = "sine", peak = 1) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const t = ac.currentTime + at;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
}

// Original synthesized sounds, so nothing has to be downloaded
const SOUNDS: Record<string, Synth> = {
    pling(ac, out) {
        note(ac, out, 1318.5, 0, 0.22);
        note(ac, out, 1975.5, 0.085, 0.4);
    },
    pop(ac, out) {
        const osc = note(ac, out, 820, 0, 0.12, "triangle");
        osc.frequency.exponentialRampToValueAtTime(240, ac.currentTime + 0.1);
    },
    chime(ac, out) {
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => note(ac, out, f, i * 0.06, 0.7, "sine", 0.6));
    },
    arcade(ac, out) {
        [659, 988, 1319].forEach((f, i) => note(ac, out, f, i * 0.065, 0.09, "square", 0.25));
    },
    bubble(ac, out) {
        const osc = note(ac, out, 380, 0, 0.18, "sine");
        osc.frequency.exponentialRampToValueAtTime(1400, ac.currentTime + 0.16);
    }
};

const settings = definePluginSettings({
    sound: {
        type: OptionType.SELECT,
        description: "Which sound to play",
        options: [
            { label: "Pling", value: "pling", default: true },
            { label: "Pop", value: "pop" },
            { label: "Chime", value: "chime" },
            { label: "Arcade", value: "arcade" },
            { label: "Bubble", value: "bubble" },
            { label: "Custom (URL below)", value: "custom" }
        ]
    },
    customUrl: {
        type: OptionType.STRING,
        description: "Sound file URL for Custom (mp3, ogg or wav). Hosts not on Discord's allowlist will ask for permission",
        default: ""
    },
    volume: {
        type: OptionType.SLIDER,
        description: "Volume",
        markers: makeRange(0, 100, 10),
        default: 60,
        stickToMarkers: false
    },
    onMentions: {
        type: OptionType.BOOLEAN,
        description: "Play when someone mentions you (including role mentions)",
        default: true
    },
    onEveryone: {
        type: OptionType.BOOLEAN,
        description: "Play on @everyone / @here",
        default: false
    },
    onDMs: {
        type: OptionType.BOOLEAN,
        description: "Play on direct messages",
        default: true
    },
    skipViewing: {
        type: OptionType.BOOLEAN,
        description: "Stay quiet for the channel you're looking at",
        default: true
    },
    test: {
        type: OptionType.COMPONENT,
        component: () => <Button size="small" onClick={() => play(true)}>Play sound</Button>
    }
});

let audioCtx: AudioContext | null = null;
let lastPlayed = 0;

async function playCustom(url: string, volume: number) {
    const allowed = await VencordNative.csp.isDomainAllowed(url, ["media-src"]).catch(() => true);
    if (!allowed) {
        const res = await VencordNative.csp.requestAddOverride(url, ["media-src"], "MentionSound");
        if (res === "ok") showToast({ text: "Allowed. Restart Discord once to use this sound", variant: "success" });
        return;
    }
    const audio = new Audio(url);
    audio.volume = volume;
    await audio.play();
}

export function play(force = false) {
    const now = Date.now();
    if (!force && now - lastPlayed < 1200) return;
    lastPlayed = now;

    const volume = Math.min(Math.max(settings.store.volume, 0), 100) / 100;
    const { sound, customUrl } = settings.store;

    try {
        if (sound === "custom") {
            if (customUrl) playCustom(customUrl, volume).catch(err => logger.warn("Custom sound failed", err));
            return;
        }

        audioCtx ??= new AudioContext();
        if (audioCtx.state === "suspended") void audioCtx.resume();

        const out = audioCtx.createGain();
        out.gain.value = volume * 0.45;
        out.connect(audioCtx.destination);
        (SOUNDS[sound] ?? SOUNDS.pling)(audioCtx, out);
    } catch (err) {
        logger.warn("Couldn't play sound", err);
    }
}

export default definePlugin({
    name: "MentionSound",
    description: "Plays a custom sound (built-in synth sounds or your own file) when you get pinged or DMed",
    tags: ["Renuxcord", "Notifications", "Customisation"],
    authors: [RenuxDevs.Larpbase],
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic: boolean; }) {
            if (optimistic || !message?.author) return;
            const me = UserStore.getCurrentUser()?.id;
            if (!me || message.author.id === me) return;
            if (settings.store.skipViewing && isViewing(message.channel_id)) return;

            const isDM = !message.guild_id && !ChannelStore.getChannel(message.channel_id)?.guild_id;
            const pinged = settings.store.onMentions && mentionsUser(message, me, { everyone: settings.store.onEveryone, roles: true });

            if (pinged || (isDM && settings.store.onDMs)) play();
        }
    },

    stop() {
        void audioCtx?.close();
        audioCtx = null;
    }
});
