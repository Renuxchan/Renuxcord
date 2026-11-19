/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, IpcMainInvokeEvent, shell } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join } from "path";

export interface FileToSave { url: string; name: string; }

const isDiscordCdn = (host: string) =>
    host === "cdn.discordapp.com" || host === "media.discordapp.net" || host.endsWith(".discordapp.net") || host === "cdn.discord.com" || host === "media.discord.com";

const clean = (s: string, max = 100) =>
    s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "").slice(0, max) || "file";

function uniquePath(dir: string, name: string) {
    const ext = extname(name);
    const base = name.slice(0, name.length - ext.length);
    let candidate = join(dir, name);
    for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${base} (${i})${ext}`);
    return candidate;
}

export function folderFor(_: IpcMainInvokeEvent, folder: string) {
    return join(app.getPath("downloads"), "Renuxcord", clean(folder, 120));
}

/** Downloads Discord CDN files into Downloads\Renuxcord\<folder>. Only Discord's own CDN is allowed */
export async function saveFiles(e: IpcMainInvokeEvent, folder: string, files: FileToSave[]) {
    const dir = folderFor(e, folder);
    mkdirSync(dir, { recursive: true });

    let saved = 0;
    let failed = 0;
    let bytes = 0;
    const queue = [...files];

    async function worker() {
        for (let file = queue.shift(); file; file = queue.shift()) {
            try {
                const url = new URL(file.url);
                if (url.protocol !== "https:" || !isDiscordCdn(url.hostname)) throw new Error("not a Discord CDN link");
                const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = Buffer.from(await res.arrayBuffer());
                writeFileSync(uniquePath(dir, clean(file.name)), data);
                saved++;
                bytes += data.length;
            } catch {
                failed++;
            }
        }
    }

    await Promise.all([worker(), worker(), worker()]);
    return { saved, failed, bytes, dir };
}

export function openFolder(_: IpcMainInvokeEvent, dir: string) {
    const root = join(app.getPath("downloads"), "Renuxcord");
    if (!dir.startsWith(root)) return;
    void shell.openPath(dir);
}
