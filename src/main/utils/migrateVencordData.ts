/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { cpSync, existsSync } from "fs";
import { join } from "path";

// On the first Renuxcord launch, carry settings, QuickCSS and themes over from an existing Vencord install
export function migrateVencordData(dataDir: string) {
    if (process.env.RENUXCORD_USER_DATA_DIR || process.env.VENCORD_USER_DATA_DIR) return;

    try {
        const vencordDir = join(app.getPath("userData"), "..", "Vencord");
        if (existsSync(join(dataDir, "settings", "settings.json")) || !existsSync(vencordDir)) return;

        for (const dir of ["settings", "themes"]) {
            const from = join(vencordDir, dir);
            if (existsSync(from)) cpSync(from, join(dataDir, dir), { recursive: true });
        }

        console.log("[Renuxcord] Imported settings and themes from", vencordDir);
    } catch (err) {
        console.error("[Renuxcord] Failed to import Vencord settings", err);
    }
}
