/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./RenuxcordBadge.css";

import { PluginMeta } from "~plugins";

/** Plugins made for Renuxcord carry the "Renuxcord" tag */
export const isRenuxcordExclusive = (plugin: { tags?: readonly string[]; }) => !!plugin.tags?.includes("Renuxcord");

/** Plugins loaded from the user's custom plugins folder */
export const isCustomPlugin = (plugin: { name: string; }) => PluginMeta[plugin.name]?.folderName?.startsWith("custom/") ?? false;

export function RenuxcordExclusiveBadge() {
    return <span className="rx-exclusive-badge">✦ Renuxcord Exclusive</span>;
}

export function CustomPluginBadge() {
    return <span className="rx-exclusive-badge rx-custom-badge">🧩 Custom</span>;
}
