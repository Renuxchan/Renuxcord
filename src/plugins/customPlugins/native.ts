/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { ipcMain, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Only functions may be exported from a native file: every export becomes an IPC handler
const CUSTOM_PLUGINS_DIR = join(DATA_DIR, "plugins");

const README = [
    "# Renuxcord custom plugins",
    "",
    "Every `.js` file in this folder loads when Discord starts, before Discord's own code, so custom plugins can do",
    "everything built-in plugins can: patches, slash commands, context menus, flux events, settings, message buttons.",
    "",
    "1. Drop a `.js` file here (see `HelloRenuxcord.js` for a working example).",
    "2. Reload Discord (Ctrl+R) or press Reload in Settings > Renuxcord > Custom Plugins.",
    "3. Turn it on in Settings > Renuxcord > Plugins. Custom plugins carry a CUSTOM badge.",
    "",
    "Files starting with `_` are skipped, so rename a plugin to `_Name.js` to switch it off completely.",
    "",
    "## The plugin file",
    "",
    "Set `module.exports` to a plugin object (or a function that returns one). The `Renuxcord` helper is in scope:",
    "",
    "- `Renuxcord.definePlugin(plugin)` and `Renuxcord.definePluginSettings(settings)`",
    "- `Renuxcord.OptionType`, `Renuxcord.CommandOptionType`, `Renuxcord.StartAt` (the enum values)",
    "- `Renuxcord.Common` (Discord stores, React, Menu, RestAPI, showToast...), `Renuxcord.Webpack` (find, findByProps, findStore...)",
    "- `Renuxcord.Api` (Commands, ContextMenu, DataStore, Notifications, MessageEvents...), `Renuxcord.Util`, `Renuxcord.Components`",
    "- `Renuxcord.showToast(text)`, `Renuxcord.notify(title, body)`",
    "",
    "Use `Renuxcord.React.createElement` for UI (no JSX in plain .js files).",
    "",
    "## Safety",
    "",
    "A plugin runs with full access to your Discord account. Only add files you wrote or trust.",
    ""
].join("\n");

const EXAMPLE = [
    "// Example Renuxcord custom plugin. Turn it on in Settings > Renuxcord > Plugins.",
    "const { definePlugin, definePluginSettings, OptionType, CommandOptionType } = Renuxcord;",
    "",
    "const settings = definePluginSettings({",
    "    greeting: { type: OptionType.STRING, description: \"What /hello says\", default: \"Hello\" }",
    "});",
    "",
    "module.exports = definePlugin({",
    "    name: \"HelloRenuxcord\",",
    "    description: \"Example custom plugin: a /hello command and a toast when it starts\",",
    "    authors: [{ name: \"You\" }],",
    "    settings,",
    "",
    "    commands: [{",
    "        name: \"hello\",",
    "        description: \"Say hi (only you can see it)\",",
    "        options: [{ name: \"who\", description: \"Who to greet\", type: CommandOptionType.STRING, required: false }],",
    "        execute(args, ctx) {",
    "            const who = args.find(a => a.name === \"who\")?.value ?? \"world\";",
    "            Renuxcord.Api.Commands.sendBotMessage(ctx.channel.id, { content: `${settings.store.greeting} ${who}! 👋` });",
    "        }",
    "    }],",
    "",
    "    start() {",
    "        Renuxcord.showToast(\"HelloRenuxcord is running\");",
    "    }",
    "});",
    ""
].join("\n");

function ensureFolder() {
    if (existsSync(CUSTOM_PLUGINS_DIR)) return;
    mkdirSync(CUSTOM_PLUGINS_DIR, { recursive: true });
    writeFileSync(join(CUSTOM_PLUGINS_DIR, "README.md"), README);
    writeFileSync(join(CUSTOM_PLUGINS_DIR, "HelloRenuxcord.js"), EXAMPLE);
}

// The preload asks for the plugin files synchronously so they can run before Discord's code
ipcMain.on("RenuxcordGetCustomPlugins", e => {
    try {
        ensureFolder();
        e.returnValue = readdirSync(CUSTOM_PLUGINS_DIR)
            .filter(f => f.endsWith(".js") && !f.startsWith("_") && !f.startsWith("."))
            .sort()
            .map(file => ({ file, source: readFileSync(join(CUSTOM_PLUGINS_DIR, file), "utf-8") }));
    } catch (err) {
        console.error("[Renuxcord] Couldn't read custom plugins", err);
        e.returnValue = [];
    }
});

export function openFolder() {
    ensureFolder();
    return shell.openPath(CUSTOM_PLUGINS_DIR);
}

export function folderPath() {
    return CUSTOM_PLUGINS_DIR;
}
