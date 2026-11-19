/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** "3h 12m", "45m", "20s" */
export function shortDuration(ms: number) {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor(s % 86400 / 3600);
    const m = Math.floor(s % 3600 / 60);
    if (d) return h ? `${d}d ${h}h` : `${d}d`;
    if (h) return m ? `${h}h ${m}m` : `${h}h`;
    if (m) return `${m}m`;
    return `${s}s`;
}

/** "just now", "5 minutes ago", "3 days ago" */
export function timeAgo(timestamp: number, now = Date.now()) {
    const s = Math.max(0, (now - timestamp) / 1000);
    if (s < 45) return "just now";
    const units: Array<[string, number]> = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [name, secs] of units) {
        const n = Math.floor(s / secs);
        if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
    return "just now";
}

/** Local calendar day key, e.g. "2026-11-19" */
export function dayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** When a Discord ID (snowflake) was created */
export const snowflakeDate = (id: string) => new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
