/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

// Only these keyless public APIs can be fetched through here
const ALLOWED = new Set([
    "geocoding-api.open-meteo.com",
    "api.open-meteo.com",
    "api.dictionaryapi.dev",
    "api.urbandictionary.com",
    "en.wikipedia.org"
]);

export async function getJson(_: IpcMainInvokeEvent, url: string): Promise<{ ok: true; status: number; data: unknown; } | { ok: false; error: string; }> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, error: "Bad URL" };
    }
    if (parsed.protocol !== "https:" || !ALLOWED.has(parsed.hostname)) return { ok: false, error: "That site isn't allowed" };

    try {
        const res = await fetch(parsed, {
            headers: { "User-Agent": "Renuxcord (Discord client mod; https://github.com/Renuxchan/Renuxcord)", "Accept": "application/json" },
            signal: AbortSignal.timeout(15_000)
        });
        const data = await res.json().catch(() => null);
        return { ok: true, status: res.status, data };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
