/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const EXT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp"
};

function sniff(buf) {
    if (buf.length < 12) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    if (buf.toString("ascii", 0, 4) === "GIF8") return "image/gif";
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    return null;
}

/** Turns a file path, http(s) URL or data URI into a base64 data URI Discord accepts */
export async function toDataUri(input, maxBytes) {
    if (!input) return undefined;
    const value = String(input).trim();
    if (value.startsWith("data:image/")) return value;

    let buf;
    let type;
    if (/^https?:\/\//i.test(value)) {
        const res = await fetch(value, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`Couldn't download the image (HTTP ${res.status})`);
        type = res.headers.get("content-type")?.split(";")[0].trim();
        buf = Buffer.from(await res.arrayBuffer());
    } else {
        buf = await readFile(value);
        type = EXT_TYPES[extname(value).toLowerCase()];
    }

    const sniffed = sniff(buf);
    if (sniffed) type = sniffed;
    if (!type?.startsWith("image/")) throw new Error("That file isn't a PNG, JPEG, GIF or WebP image");
    if (buf.length > maxBytes) throw new Error(`Image is ${(buf.length / 1024).toFixed(0)} KB, the limit here is ${(maxBytes / 1024).toFixed(0)} KB`);

    return `data:${type};base64,${buf.toString("base64")}`;
}
