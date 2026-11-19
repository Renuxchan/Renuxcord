/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { showToast } from "@webpack/common";

const logger = new Logger("RenuxTheme", "#a78bfa");

interface Preset {
    accent: string;
    /** lowest → highest surface */
    surfaces: [string, string, string, string];
}

const PRESETS: Record<string, Preset> = {
    midnight: { accent: "#a78bfa", surfaces: ["#07070d", "#0c0c16", "#11111d", "#181828"] },
    sakura: { accent: "#f472b6", surfaces: ["#140b11", "#1a0f17", "#21131d", "#2b1826"] },
    ocean: { accent: "#38bdf8", surfaces: ["#050d14", "#08131d", "#0c1a27", "#122434"] },
    forest: { accent: "#4ade80", surfaces: ["#060d09", "#09130d", "#0d1a12", "#132419"] },
    ember: { accent: "#fb923c", surfaces: ["#120a06", "#180e09", "#20130c", "#2a1a11"] },
    oled: { accent: "#e4e4e7", surfaces: ["#000000", "#000000", "#050505", "#0e0e0e"] }
};

const apply = () => update();

const settings = definePluginSettings({
    preset: {
        type: OptionType.SELECT,
        description: "Colour preset",
        options: [
            { label: "Midnight (purple)", value: "midnight", default: true },
            { label: "Sakura (pink)", value: "sakura" },
            { label: "Ocean (blue)", value: "ocean" },
            { label: "Forest (green)", value: "forest" },
            { label: "Ember (orange)", value: "ember" },
            { label: "OLED (pure black)", value: "oled" },
            { label: "Keep Discord's colours", value: "none" }
        ],
        onChange: apply
    },
    accent: {
        type: OptionType.STRING,
        description: "Custom accent colour, e.g. #ff4d8d (empty = preset's)",
        default: "",
        onChange: apply
    },
    backgroundImage: {
        type: OptionType.STRING,
        description: "Background image URL (imgur, Discord CDN and GitHub work straight away; other sites ask once)",
        default: "",
        onChange: apply
    },
    backgroundBlur: {
        type: OptionType.SLIDER,
        description: "Background blur",
        markers: makeRange(0, 30, 5),
        default: 6,
        stickToMarkers: false,
        onChange: apply
    },
    backgroundDim: {
        type: OptionType.SLIDER,
        description: "Background darkness (%)",
        markers: makeRange(0, 90, 10),
        default: 50,
        stickToMarkers: false,
        onChange: apply
    },
    glass: {
        type: OptionType.SLIDER,
        description: "Panel see-through amount with a background image (%)",
        markers: makeRange(0, 90, 10),
        default: 40,
        stickToMarkers: false,
        onChange: apply
    },
    radius: {
        type: OptionType.SLIDER,
        description: "Corner roundness (px)",
        markers: makeRange(0, 24, 4),
        default: 8,
        stickToMarkers: false,
        onChange: apply
    },
    font: {
        type: OptionType.STRING,
        description: "Google Font name, e.g. Inter, Nunito, Space Grotesk (empty = Discord's)",
        default: "",
        onChange: apply
    }
});

const isHex = (s?: string) => !!s && /^#?[\da-f]{6}$/i.test(s.trim());
const hex = (s: string) => `#${s.trim().replace(/^#/, "")}`;

function rgb(color: string, alpha = 1) {
    const n = parseInt(color.replace("#", ""), 16);
    return `rgb(${n >> 16 & 255} ${n >> 8 & 255} ${n & 255} / ${alpha})`;
}

function shade(color: string, amount: number) {
    const n = parseInt(color.replace("#", ""), 16);
    const f = (c: number) => Math.round(Math.min(255, Math.max(0, c + 255 * amount)));
    return `rgb(${f(n >> 16 & 255)} ${f(n >> 8 & 255)} ${f(n & 255)})`;
}

function safeUrl(url: string) {
    try {
        const u = new URL(url.trim());
        return /^https?:$/.test(u.protocol) ? u.href.replace(/["\\\n]/g, encodeURIComponent) : null;
    } catch {
        return null;
    }
}

export function buildCss() {
    const s = settings.store;
    const preset = PRESETS[s.preset];
    const accent = isHex(s.accent) ? hex(s.accent) : preset?.accent;
    const image = s.backgroundImage ? safeUrl(s.backgroundImage) : null;
    const font = s.font?.trim().replace(/["'<>;{}]/g, "");

    const out: string[] = [];
    const vars: string[] = [];

    if (font) out.push(`@import url("https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap");`);

    if (preset) {
        const alpha = image ? Math.max(0.1, 1 - s.glass / 100) : 1;
        const [l0, l1, l2, l3] = preset.surfaces.map(c => rgb(c, alpha));
        vars.push(
            `--background-base-lowest:${l0}`, `--background-tertiary:${l0}`, `--app-background-frame:${l0}`,
            `--background-base-lower:${l1}`, `--background-secondary:${l1}`, `--background-secondary-alt:${l1}`,
            `--background-base-low:${l2}`, `--background-primary:${l2}`, `--chat-background-default:${l2}`, `--bg-base-primary:${l2}`,
            `--background-surface-high:${l3}`, `--background-surface-higher:${l3}`, `--background-surface-highest:${l3}`,
            `--background-floating:${rgb(preset.surfaces[3])}`, `--modal-background:${rgb(preset.surfaces[3])}`, `--channeltextarea-background:${l3}`
        );
    }

    if (accent) {
        vars.push(
            `--brand-500:${accent}`, `--brand-560:${shade(accent, -0.06)}`, `--brand-600:${shade(accent, -0.12)}`, `--brand-experiment:${accent}`,
            `--control-brand-foreground:${accent}`, `--control-brand-foreground-new:${accent}`, `--text-brand:${accent}`, `--text-link:${accent}`,
            `--button-filled-brand-background:${accent}`, `--button-filled-brand-background-hover:${shade(accent, -0.08)}`,
            `--button-filled-brand-background-active:${shade(accent, -0.14)}`,
            `--mention-foreground:${accent}`, `--mention-background:${rgb(accent, 0.18)}`
        );
    }

    if (s.radius !== 8) {
        const r = s.radius;
        vars.push(`--radius-xs:${Math.round(r / 2)}px`, `--radius-sm:${Math.round(r * 0.75)}px`, `--radius-md:${r}px`, `--radius-lg:${Math.round(r * 1.5)}px`, `--radius-xl:${r * 2}px`);
    }

    if (font) {
        const stack = `"${font}", "gg sans", "Noto Sans", sans-serif`;
        vars.push(`--font-primary:${stack}`, `--font-display:${stack}`, `--font-headline:${stack}`);
    }

    if (vars.length)
        out.push(`:root, .theme-dark, .theme-light, .theme-darker, .theme-midnight, .visual-refresh { ${vars.map(v => `${v} !important`).join("; ")} }`);

    if (image) {
        const blur = Math.round(s.backgroundBlur);
        out.push(
            "html, body, #app-mount { background: transparent !important; }",
            `body::before { content: ""; position: fixed; inset: ${-blur * 2}px; background: url("${image}") center / cover no-repeat; filter: blur(${blur}px); z-index: -2; pointer-events: none; }`,
            `body::after { content: ""; position: fixed; inset: 0; background: rgb(0 0 0 / ${s.backgroundDim / 100}); z-index: -1; pointer-events: none; }`
        );
    }

    return out.join("\n");
}

let style: HTMLStyleElement | null = null;
let running = false;
const askedFor = new Set<string>();

async function checkImageAllowed(url: string) {
    if (askedFor.has(url)) return;
    askedFor.add(url);
    try {
        if (await VencordNative.csp.isDomainAllowed(url, ["img-src"])) return;
        const res = await VencordNative.csp.requestAddOverride(url, ["img-src"], "RenuxTheme");
        if (res === "ok") showToast({ text: "Background site allowed. Restart Discord once to load it", variant: "success" });
    } catch (err) {
        logger.warn("CSP check failed", err);
    }
}

function update() {
    if (!running) return;
    style ??= Object.assign(document.createElement("style"), { id: "renuxcord-theme" });
    style.textContent = buildCss();
    if (!style.isConnected) document.head.appendChild(style);

    const image = settings.store.backgroundImage ? safeUrl(settings.store.backgroundImage) : null;
    if (image) void checkImageAllowed(image);
}

export default definePlugin({
    name: "RenuxTheme",
    description: "Built-in theme engine: colour presets, custom accent, background image with blur/dim/glass, rounder corners and any Google Font. Changes apply live",
    tags: ["Renuxcord", "Appearance", "Customisation"],
    authors: [RenuxDevs.Larpbase],
    settings,

    start() {
        running = true;
        update();
    },

    stop() {
        running = false;
        style?.remove();
        style = null;
    }
});
