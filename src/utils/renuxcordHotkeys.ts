/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Whether a keydown matches a shortcut like "ctrl+shift+k" or "alt+space" */
export function matchesHotkey(hotkey: string, e: KeyboardEvent) {
    const parts = hotkey.toLowerCase().split("+").map(s => s.trim()).filter(Boolean);
    const key = parts.pop();
    if (!key) return false;

    const wants = (...names: string[]) => names.some(n => parts.includes(n));
    const pressed = e.key.toLowerCase() === key
        || e.code.toLowerCase() === `key${key}`
        || e.code.toLowerCase() === `digit${key}`
        || (key === "space" && e.code === "Space");

    return pressed
        && e.ctrlKey === wants("ctrl", "control")
        && e.shiftKey === wants("shift")
        && e.altKey === wants("alt", "option")
        && e.metaKey === wants("meta", "cmd", "win");
}
