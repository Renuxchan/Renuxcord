/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ipcRenderer, webFrame } from "electron/renderer";

const clean = (s: string) => s.replace(/[^\w.-]/g, "_");

/** Runs the user's custom plugin files right after Renuxcord, before Discord's own code */
export function loadCustomPlugins() {
    let files: { file: string; source: string; }[] = [];
    try {
        files = ipcRenderer.sendSync("RenuxcordGetCustomPlugins") ?? [];
    } catch (err) {
        console.error("[Renuxcord] Couldn't load custom plugins", err);
        return;
    }
    if (!files.length) return;

    webFrame.executeJavaScript(`window.RenuxcordCustomPlugins?.expect(${JSON.stringify(files.map(f => f.file))});`);

    // One script per file, so a broken plugin can't take the others down
    for (const { file, source } of files) {
        const code = `(()=>{const registry=window.RenuxcordCustomPlugins;if(!registry)return;registry.register(${JSON.stringify(file)},function(module,exports,Renuxcord){\n${source}\n});})();\n//# sourceURL=renuxcord-plugins:///${clean(file)}`;
        webFrame.executeJavaScript(code).catch(err => console.error(`[Renuxcord] Custom plugin ${file} failed to run`, err));
    }
}
