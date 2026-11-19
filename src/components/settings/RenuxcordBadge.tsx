/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./RenuxcordBadge.css";

/** Plugins made for Renuxcord carry the "Renuxcord" tag */
export const isRenuxcordExclusive = (plugin: { tags?: readonly string[]; }) => !!plugin.tags?.includes("Renuxcord");

export function RenuxcordExclusiveBadge() {
    return <span className="rx-exclusive-badge">✦ Renuxcord Exclusive</span>;
}
