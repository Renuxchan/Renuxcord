/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { inflateRawSync } from "zlib";

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;

/** Reads one file out of a zip archive, or null when it isn't there. Handles stored and deflated files */
export function readZipEntry(zip: Buffer, path: string): Buffer | null {
    // The directory's end record is the last 22 bytes, plus a comment of up to 64 KiB
    let end = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
        if (zip.readUInt32LE(i) === END_OF_DIRECTORY) {
            end = i;
            break;
        }
    }
    if (end < 0) throw new Error("That isn't a zip file");

    const count = zip.readUInt16LE(end + 10);
    let pos = zip.readUInt32LE(end + 16);

    for (let n = 0; n < count; n++) {
        if (zip.readUInt32LE(pos) !== DIRECTORY_ENTRY) throw new Error("The zip's file list is damaged");

        const method = zip.readUInt16LE(pos + 10);
        const packedSize = zip.readUInt32LE(pos + 20);
        const size = zip.readUInt32LE(pos + 24);
        const nameLength = zip.readUInt16LE(pos + 28);
        const local = zip.readUInt32LE(pos + 42);
        const name = zip.toString("utf8", pos + 46, pos + 46 + nameLength);
        pos += 46 + nameLength + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32);

        if (name !== path) continue;

        if (zip.readUInt32LE(local) !== LOCAL_ENTRY) throw new Error(`${path} is damaged in the zip`);
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const packed = zip.subarray(start, start + packedSize);

        let data: Buffer;
        if (method === 0) data = Buffer.from(packed);
        else if (method === 8) data = inflateRawSync(packed);
        else throw new Error(`${path} uses a compression method this can't unpack (${method})`);

        if (data.length !== size) throw new Error(`${path} came out the wrong size`);
        return data;
    }

    return null;
}
