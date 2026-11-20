/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export class BridgeError extends Error { }

// Same locations as DATA_DIR in src/main/utils/constants.ts
function dataDirs() {
    const dirs = [];
    if (process.env.RENUXCORD_USER_DATA_DIR) dirs.push(process.env.RENUXCORD_USER_DATA_DIR);

    if (process.platform === "win32") dirs.push(join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Renuxcord"));
    else if (process.platform === "darwin") dirs.push(join(homedir(), "Library", "Application Support", "Renuxcord"));
    else dirs.push(join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Renuxcord"));

    return dirs;
}

/** Reads bridge.json fresh every call: Discord picks a new token (and maybe port) on each start */
export async function readBridgeInfo() {
    const files = process.env.RENUXCORD_BRIDGE_FILE
        ? [process.env.RENUXCORD_BRIDGE_FILE]
        : dataDirs().map(d => join(d, "bridge.json"));

    for (const file of files) {
        try {
            const info = JSON.parse(await readFile(file, "utf8"));
            if (info?.port && info?.token) return { ...info, file };
        } catch { }
    }

    throw new BridgeError(
        "Renuxcord's bridge isn't running. Open Discord with Renuxcord installed and enable the RenuxBridge plugin "
        + "(Settings > Renuxcord > Plugins)."
    );
}

async function request(path, init, timeoutMs) {
    const info = await readBridgeInfo();

    let res;
    try {
        res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
            ...init,
            headers: { ...init?.headers, Authorization: `Bearer ${info.token}` },
            signal: AbortSignal.timeout(timeoutMs + 5_000)
        });
    } catch (err) {
        const reason = err?.cause?.code ?? err?.name ?? err?.message;
        throw new BridgeError(`Can't reach Discord on port ${info.port} (${reason}). Is Discord open with Renuxcord, and is RenuxBridge enabled?`);
    }

    let body;
    try {
        body = await res.json();
    } catch {
        throw new BridgeError(`The bridge answered HTTP ${res.status} without JSON`);
    }

    if (res.status === 403) throw new BridgeError(
        `Discord rejected the key in ${info.file}. Discord writes a new key every time it starts, so this file is out of date. `
        + "If this runs from a Microsoft Store/MSIX app (the Claude desktop app is one), Windows may be showing it that app's private copy of the folder: "
        + "delete %LOCALAPPDATA%\\Packages\\<that app>\\LocalCache\\Roaming\\Renuxcord and try again."
    );
    if (!body?.ok) throw new BridgeError(body?.error ?? `HTTP ${res.status}`);
    return body.result;
}

export function bridgeStatus() {
    return request("/status", { method: "GET" }, 5_000);
}

/** Runs a RenuxBridge action inside Discord and returns its result */
export function callBridge(method, params = {}, timeoutMs = 60_000) {
    return request("/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params, timeoutMs })
    }, timeoutMs);
}
