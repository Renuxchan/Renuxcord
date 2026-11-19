/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import { isViewing, RawMessage } from "@utils/renuxcordMessages";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

const settings = definePluginSettings({
    triggers: {
        type: OptionType.STRING,
        description: "Words that fire confetti when they show up in the chat you're looking at (comma separated)",
        default: "congrats, congratulations, happy birthday, hbd, 🎉, 🥳, 🎊"
    },
    ownMessages: {
        type: OptionType.BOOLEAN,
        description: "Also fire for your own messages",
        default: true
    },
    amount: {
        type: OptionType.SLIDER,
        description: "How much confetti",
        markers: [50, 100, 200, 300],
        default: 160,
        stickToMarkers: false
    }
});

interface Piece { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; color: string; round: boolean; tilt: number; }

const COLORS = ["#a78bfa", "#ec4899", "#f59e0b", "#22d3ee", "#34d399", "#f43f5e", "#facc15", "#ffffff"];
let canvas: HTMLCanvasElement | null = null;
let pieces: Piece[] = [];
let frame = 0;
let lastAuto = 0;

function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:100000";
    document.body.appendChild(canvas);
    return canvas;
}

function step() {
    const c = canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== innerWidth * dpr || c.height !== innerHeight * dpr) {
        c.width = innerWidth * dpr;
        c.height = innerHeight * dpr;
    }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);

    for (const p of pieces) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.tilt += 0.1;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.scale(1, Math.cos(p.tilt));
        g.fillStyle = p.color;
        if (p.round) {
            g.beginPath();
            g.arc(0, 0, p.w / 2, 0, Math.PI * 2);
            g.fill();
        } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
    }
    pieces = pieces.filter(p => p.y < innerHeight + 40);

    if (pieces.length) frame = requestAnimationFrame(step);
    else {
        canvas?.remove();
        canvas = null;
        frame = 0;
    }
}

/** Two confetti cannons from the bottom corners */
export function burst(amount = settings.store.amount) {
    ensureCanvas();
    const per = Math.round(amount / 2);
    for (const side of [0, 1]) {
        for (let i = 0; i < per; i++) {
            const angle = (side ? -1 : 1) * (0.35 + Math.random() * 0.45);
            const speed = 13 + Math.random() * 11;
            pieces.push({
                x: side ? innerWidth + 10 : -10,
                y: innerHeight * (0.75 + Math.random() * 0.1),
                vx: Math.sin(angle) * speed,
                vy: -Math.cos(Math.abs(angle)) * speed,
                rot: Math.random() * Math.PI,
                vr: (Math.random() - 0.5) * 0.3,
                w: 6 + Math.random() * 7,
                h: 4 + Math.random() * 5,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                round: Math.random() < 0.25,
                tilt: Math.random() * Math.PI
            });
        }
    }
    if (!frame) frame = requestAnimationFrame(step);
}

function matches(text: string) {
    const lower = text.toLowerCase();
    return settings.store.triggers.split(",").map(t => t.trim().toLowerCase()).filter(Boolean).some(t => {
        if (/^[\p{L}\p{N} ]+$/u.test(t)) return new RegExp(`(?:^|[^\\p{L}\\p{N}])${t}(?=$|[^\\p{L}\\p{N}])`, "u").test(lower);
        return lower.includes(t);
    });
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default definePlugin({
    name: "Confetti",
    description: "🎉 Confetti cannons when someone says congrats or happy birthday in the chat you're looking at, or whenever you want with /confetti",
    tags: ["Renuxcord", "Fun", "Chat"],
    authors: [RenuxDevs.Larpbase],
    settings,

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic?: boolean; }) {
            if (optimistic || !message?.content || !isViewing(message.channel_id) || reducedMotion()) return;
            if (!settings.store.ownMessages && message.author?.id === UserStore.getCurrentUser()?.id) return;
            if (Date.now() - lastAuto < 12_000 || !matches(message.content)) return;
            lastAuto = Date.now();
            burst();
        }
    },

    commands: [{
        name: "confetti",
        description: "🎉",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: () => burst()
    }],

    stop() {
        cancelAnimationFrame(frame);
        frame = 0;
        pieces = [];
        canvas?.remove();
        canvas = null;
    }
});
