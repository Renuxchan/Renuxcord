/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";

type Key = "key" | "space" | "enter" | "back";

const settings = definePluginSettings({
    profile: {
        type: OptionType.SELECT,
        description: "Keyboard sound",
        options: [
            { label: "Thocky mechanical", value: "thock", default: true },
            { label: "Clicky blue switches", value: "clicky" },
            { label: "Typewriter (with the ding)", value: "typewriter" },
            { label: "Soft bubble pops", value: "bubble" },
            { label: "Retro 8-bit", value: "retro" }
        ],
        onChange: () => preview()
    },
    volume: {
        type: OptionType.SLIDER,
        description: "Volume",
        markers: [0, 25, 50, 75, 100],
        default: 45,
        stickToMarkers: false,
        onChange: () => preview()
    },
    everywhere: {
        type: OptionType.BOOLEAN,
        description: "Also click in search boxes and other text fields, not just the message box",
        default: false
    }
});

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let lastAt = 0;

function audio() {
    if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.connect(ctx.destination);
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    master!.gain.value = (settings.store.volume / 100) ** 1.6;
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
}

const vary = (n: number) => n * (0.92 + Math.random() * 0.16);

function burst(ac: AudioContext, at: number, type: BiquadFilterType, freq: number, q: number, duration: number, gain: number) {
    const src = ac.createBufferSource();
    src.buffer = noise;
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ac.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(filter).connect(env).connect(master!);
    src.start(at, Math.random() * 0.1);
    src.stop(at + duration + 0.02);
}

function tone(ac: AudioContext, at: number, type: OscillatorType, from: number, to: number, duration: number, gain: number) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), at + duration);
    const env = ac.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env).connect(master!);
    osc.start(at);
    osc.stop(at + duration + 0.02);
}

const PROFILES: Record<string, (ac: AudioContext, at: number, key: Key) => void> = {
    thock(ac, at, key) {
        const low = key === "space" || key === "enter";
        burst(ac, at, "lowpass", vary(low ? 1100 : 1800), 0.8, low ? 0.07 : 0.05, low ? 0.8 : 0.6);
        tone(ac, at, "sine", vary(low ? 120 : 170), low ? 40 : 60, low ? 0.09 : 0.06, low ? 0.6 : 0.45);
    },
    clicky(ac, at, key) {
        const f = key === "space" ? 2600 : key === "enter" ? 3000 : 4200;
        burst(ac, at, "highpass", vary(f), 1, 0.022, 0.5);
        burst(ac, at + 0.014, "bandpass", vary(f * 1.4), 3, 0.014, 0.35);
    },
    typewriter(ac, at, key) {
        burst(ac, at, "bandpass", vary(key === "space" ? 1500 : 2400), 0.8, 0.045, 0.75);
        tone(ac, at, "triangle", vary(900), 300, 0.03, 0.12);
        if (key === "enter") {
            burst(ac, at + 0.03, "lowpass", 900, 0.5, 0.18, 0.5);
            tone(ac, at + 0.12, "sine", 1760, 1740, 0.7, 0.22);
            tone(ac, at + 0.12, "sine", 3520, 3500, 0.4, 0.06);
        }
    },
    bubble(ac, at, key) {
        const base = key === "space" ? 420 : key === "enter" ? 330 : 620;
        tone(ac, at, "sine", vary(base), vary(base * 2.2), 0.05, 0.35);
        tone(ac, at + 0.05, "sine", vary(base * 2.2), base * 1.6, 0.04, 0.12);
    },
    retro(ac, at, key) {
        const scale = [523, 587, 659, 784, 880, 1047];
        const f = key === "enter" ? 1319 : key === "space" ? 392 : scale[Math.floor(Math.random() * scale.length)];
        tone(ac, at, "square", f, f, 0.045, 0.1);
        if (key === "enter") tone(ac, at + 0.05, "square", 1760, 1760, 0.06, 0.08);
    }
};

function play(key: Key) {
    if (settings.store.volume <= 0) return;
    const ac = audio();
    (PROFILES[settings.store.profile] ?? PROFILES.thock)(ac, ac.currentTime + 0.002, key);
}

let previewTimer: ReturnType<typeof setTimeout> | undefined;
function preview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        ["key", "key", "space", "key", "enter"].forEach((k, i) => setTimeout(() => play(k as Key), i * 110));
    }, 250);
}

function isTypingTarget(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    if (!el?.closest) return false;
    if (el.closest('[role="textbox"][contenteditable="true"]')) return true;
    return settings.store.everywhere && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function onKeyDown(e: KeyboardEvent) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !isTypingTarget(e.target)) return;

    let key: Key;
    if (e.key === " ") key = "space";
    else if (e.key === "Enter") key = "enter";
    else if (e.key === "Backspace" || e.key === "Delete") key = "back";
    else if (e.key.length === 1) key = "key";
    else return;

    const now = performance.now();
    if (now - lastAt < 18) return;
    lastAt = now;
    play(key);
}

export default definePlugin({
    name: "TypingSounds",
    description: "Satisfying keyboard sounds while you type a message: thocky mechanical, clicky, typewriter with the ding, bubble pops or retro 8-bit",
    tags: ["Renuxcord", "Fun", "Chat"],
    authors: [RenuxDevs.Larpbase],
    settings,

    start() {
        document.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        void ctx?.close();
        ctx = master = null;
        noise = null;
    }
});
