/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import { matchesHotkey } from "@utils/renuxcordHotkeys";
import definePlugin, { makeRange, OptionType } from "@utils/types";

const settings = definePluginSettings({
    hotkey: {
        type: OptionType.STRING,
        description: "Shortcut that hides/shows Discord instantly (Discord doesn't use ctrl+alt+b)",
        default: "ctrl+alt+b"
    },
    strength: {
        type: OptionType.SLIDER,
        description: "Blur strength",
        markers: makeRange(4, 40, 4),
        default: 20,
        stickToMarkers: false,
        onChange: () => active && apply()
    },
    blurWhenUnfocused: {
        type: OptionType.BOOLEAN,
        description: "Blur automatically whenever Discord isn't the focused window (great when screen sharing everything)",
        default: false
    },
    clickToReveal: {
        type: OptionType.BOOLEAN,
        description: "Clicking the blurred window reveals it again",
        default: true
    }
});

let active = false;
let autoBlurred = false;
let style: HTMLStyleElement | null = null;
let overlay: HTMLDivElement | null = null;

function apply() {
    style ??= Object.assign(document.createElement("style"), { id: "renuxcord-panic-blur" });
    style.textContent = `#app-mount{filter:blur(${settings.store.strength}px) saturate(.6)!important;transition:filter .12s ease-out}`;
    if (!style.isConnected) document.head.appendChild(style);

    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "renuxcord-panic-overlay";
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:rgb(0 0 0/.25);color:#fff;font:600 16px/1.4 'gg sans',system-ui,sans-serif;text-shadow:0 1px 8px #000;cursor:pointer;user-select:none";
        overlay.addEventListener("click", () => settings.store.clickToReveal && hide());
    }
    overlay.textContent = `🙈 Hidden · ${settings.store.hotkey.toUpperCase()}${settings.store.clickToReveal ? " or click" : ""} to show`;
    if (!overlay.isConnected) document.body.appendChild(overlay);
}

function show() {
    active = true;
    apply();
}

function hide() {
    active = false;
    autoBlurred = false;
    style?.remove();
    overlay?.remove();
}

export function togglePanicBlur() {
    if (active) hide();
    else show();
}

function onKeyDown(e: KeyboardEvent) {
    if (!matchesHotkey(settings.store.hotkey, e)) return;
    e.preventDefault();
    e.stopPropagation();
    togglePanicBlur();
}

function onWindowBlur() {
    if (!settings.store.blurWhenUnfocused || active) return;
    autoBlurred = true;
    show();
}

function onWindowFocus() {
    if (autoBlurred) hide();
}

export default definePlugin({
    name: "PanicBlur",
    description: "One hotkey (Ctrl+Alt+B) blurs all of Discord instantly, for streaming or nosy people. Can also blur whenever Discord loses focus",
    tags: ["Renuxcord", "Privacy", "Shortcuts"],
    authors: [RenuxDevs.Larpbase],
    settings,

    toolboxActions: {
        "Toggle panic blur": togglePanicBlur
    },

    start() {
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("focus", onWindowFocus);
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);
        hide();
    }
});
