/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Installs Renuxcord into the Discord desktop app on this computer.
//
//   node scripts/renuxcord/install.mjs status
//   node scripts/renuxcord/install.mjs install   [--flavor stable|ptb|canary|development|all] [--dist <dir>] [--enable A,B] [--no-restart] [--force]
//   node scripts/renuxcord/install.mjs uninstall [--flavor ...] [--no-restart]
//
// install copies the built files (default: ./dist) to the Renuxcord data folder and points Discord at them,
// so the built-in updater can keep them current. The original app.asar is kept as _app.asar.

import { execFileSync, spawn } from "child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, relative, resolve } from "path";

const FLAVORS = {
    stable: { folder: "Discord", exe: "Discord.exe", mac: "Discord.app" },
    ptb: { folder: "DiscordPTB", exe: "DiscordPTB.exe", mac: "Discord PTB.app" },
    canary: { folder: "DiscordCanary", exe: "DiscordCanary.exe", mac: "Discord Canary.app" },
    development: { folder: "DiscordDevelopment", exe: "DiscordDevelopment.exe", mac: "Discord Development.app" }
};

const REQUIRED_FILES = ["patcher.js", "preload.js", "renderer.js", "renderer.css"];
const OPTIONAL_FILES = ["renuxcord-mcp.mjs", "patcher.js.map", "preload.js.map", "renderer.js.map", "renderer.css.map", "patcher.js.LEGAL.txt", "renderer.js.LEGAL.txt"];

const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith("--")) ?? "status";
const flag = name => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : (args[i + 1]?.startsWith("--") || args[i + 1] == null ? true : args[i + 1]);
};

function dataDir() {
    if (process.env.RENUXCORD_USER_DATA_DIR) return process.env.RENUXCORD_USER_DATA_DIR;
    if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Renuxcord");
    if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Renuxcord");
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Renuxcord");
}

function vencordDir() {
    return join(dataDir(), "..", "Vencord");
}

// Microsoft Store/MSIX apps (the Claude desktop app is one) run their child processes with AppData writes redirected
// into the app's private %LOCALAPPDATA%\Packages\<app>\LocalCache\Roaming. Installing from a terminal inside such an app
// puts Renuxcord where only that app can see it: Discord started from the Start menu then can't find patcher.js.
const packagesDir = () => join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Packages");

/** The package whose private storage our AppData writes land in, or null when they reach the real AppData */
function redirectingPackage() {
    if (process.platform !== "win32" || !process.env.APPDATA || !existsSync(packagesDir())) return null;
    const probe = join(process.env.APPDATA, `.renuxcord-probe-${process.pid}-${Date.now()}`);
    try {
        writeFileSync(probe, "");
        const rel = relative(process.env.APPDATA, probe);
        return readdirSync(packagesDir()).find(pkg => existsSync(join(packagesDir(), pkg, "LocalCache", "Roaming", rel))) ?? null;
    } catch {
        return null;
    } finally {
        rmSync(probe, { force: true });
    }
}

/** Packages holding their own private Renuxcord folder, which hides the real one from programs started inside them */
function privateCopies() {
    if (process.platform !== "win32" || !existsSync(packagesDir())) return [];
    const rel = relative(process.env.APPDATA ?? "", dataDir());
    if (rel.startsWith("..")) return [];
    return readdirSync(packagesDir())
        .map(pkg => join(packagesDir(), pkg, "LocalCache", "Roaming", rel))
        .filter(existsSync);
}

function warnAboutRedirection() {
    const pkg = redirectingPackage();
    if (pkg) console.log(`  Warning: this terminal runs inside the packaged app ${pkg}. Windows redirects its AppData writes into that app's private storage, so Discord started normally won't see them. Use a normal PowerShell window.`);
    for (const dir of privateCopies())
        console.log(`  Warning: ${dir} is a private copy of the Renuxcord folder. Programs started from that app see it instead of the real one. Delete it unless you know you need it.`);
    return pkg;
}

function compareVersions(a, b) {
    const pa = a.replace(/^app-/, "").split(".").map(Number);
    const pb = b.replace(/^app-/, "").split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

/** Every resources folder of a Discord flavor (all installed versions on Windows) */
function resourceDirs(flavor) {
    const info = FLAVORS[flavor];
    if (process.platform === "win32") {
        const base = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), info.folder);
        if (!existsSync(base)) return [];
        return readdirSync(base)
            .filter(d => /^app-\d/.test(d))
            .sort(compareVersions)
            .map(d => join(base, d, "resources"))
            .filter(existsSync);
    }
    if (process.platform === "darwin") {
        const dir = join("/Applications", info.mac, "Contents", "Resources");
        return existsSync(dir) ? [dir] : [];
    }
    const name = info.folder.toLowerCase().replace("discord", "discord-");
    return [
        `/usr/share/${info.folder.toLowerCase()}/resources`, `/usr/lib/${info.folder.toLowerCase()}/resources`,
        `/opt/${info.folder}/resources`, `/opt/${info.folder.toLowerCase()}/resources`, `/usr/share/${name}/resources`,
        join(homedir(), ".local/share", info.folder.toLowerCase(), "resources")
    ].filter(existsSync);
}

/** The same tiny asar Vencord's installer writes: index.js requires our patcher */
export function makeStubAsar(patcherPath) {
    const index = Buffer.from(`require(${JSON.stringify(patcherPath)})`);
    const pkg = Buffer.from(JSON.stringify({ name: "discord", main: "index.js" }, null, "\t"));
    const header = Buffer.from(JSON.stringify({
        files: {
            "index.js": { size: index.length, offset: "0" },
            "package.json": { size: pkg.length, offset: String(index.length) }
        }
    }));
    const padded = Math.ceil(header.length / 4) * 4;

    const out = Buffer.alloc(16 + padded + index.length + pkg.length);
    out.writeUInt32LE(4, 0);
    out.writeUInt32LE(8 + padded, 4);
    out.writeUInt32LE(4 + padded, 8);
    out.writeUInt32LE(header.length, 12);
    header.copy(out, 16);
    index.copy(out, 16 + padded);
    pkg.copy(out, 16 + padded + index.length);
    return out;
}

function describe(resources) {
    const app = join(resources, "app.asar");
    const backup = join(resources, "_app.asar");
    if (!existsSync(app)) return "broken (no app.asar)";
    if (!existsSync(backup)) return "vanilla";
    if (statSync(app).size > 4096) return "patched by something unknown";
    const target = /require\("(.+)"\)/.exec(readFileSync(app, "latin1"))?.[1]?.replace(/\\\\/g, "\\") ?? "?";
    if (/renuxcord/i.test(target)) return `Renuxcord -> ${target}`;
    if (/vencord/i.test(target)) return `Vencord -> ${target}`;
    return `other mod -> ${target}`;
}

function killDiscord(flavor) {
    if (process.platform !== "win32") return;
    try {
        execFileSync("taskkill", ["/F", "/T", "/IM", FLAVORS[flavor].exe], { stdio: "ignore" });
    } catch { }
    // taskkill returns before handles on app.asar are gone
    const until = Date.now() + 3000;
    while (Date.now() < until) { }
}

function startDiscord(flavor) {
    if (process.platform !== "win32") return console.log("  Start Discord again yourself.");
    const updater = join(process.env.LOCALAPPDATA, FLAVORS[flavor].folder, "Update.exe");
    if (!existsSync(updater)) return;
    spawn(updater, ["--processStart", FLAVORS[flavor].exe], { detached: true, stdio: "ignore" }).unref();
}

function copyDist(from, to) {
    for (const f of REQUIRED_FILES)
        if (!existsSync(join(from, f))) throw new Error(`${f} is missing from ${from}. Build first: pnpm build --standalone`);

    mkdirSync(to, { recursive: true });
    for (const f of [...REQUIRED_FILES, ...OPTIONAL_FILES])
        if (existsSync(join(from, f))) copyFileSync(join(from, f), join(to, f));
    writeFileSync(join(to, "package.json"), "{}");
}

function prepareSettings(enable) {
    const settingsFile = join(dataDir(), "settings", "settings.json");
    if (!existsSync(settingsFile) && existsSync(join(vencordDir(), "settings"))) {
        for (const dir of ["settings", "themes"])
            if (existsSync(join(vencordDir(), dir))) cpSync(join(vencordDir(), dir), join(dataDir(), dir), { recursive: true });
        console.log(`  Copied your Vencord settings and themes from ${vencordDir()}`);
    }
    if (!enable.length) return;

    mkdirSync(join(dataDir(), "settings"), { recursive: true });
    const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
    settings.plugins ??= {};
    for (const name of enable) settings.plugins[name] = { ...settings.plugins[name], enabled: true };
    writeFileSync(settingsFile, JSON.stringify(settings, null, 4));
    console.log(`  Enabled: ${enable.join(", ")}`);
}

function selectedFlavors() {
    const wanted = flag("flavor") ?? "all";
    const list = wanted === "all" || wanted === true ? Object.keys(FLAVORS) : String(wanted).split(",");
    for (const f of list) if (!FLAVORS[f]) throw new Error(`Unknown flavor "${f}". Use ${Object.keys(FLAVORS).join(", ")} or all`);
    return list.filter(f => resourceDirs(f).length);
}

function status() {
    console.log(`Renuxcord data folder: ${dataDir()}${existsSync(join(dataDir(), "dist", "patcher.js")) ? "" : " (no files installed yet)"}`);
    let any = false;
    for (const flavor of Object.keys(FLAVORS)) {
        for (const dir of resourceDirs(flavor)) {
            any = true;
            console.log(`  ${flavor.padEnd(11)} ${dir}\n              ${describe(dir)}`);
        }
    }
    if (!any) console.log("  No Discord installs found.");
    warnAboutRedirection();
}

function install() {
    const flavors = selectedFlavors();
    if (!flavors.length) throw new Error("No Discord install found");

    const pkg = warnAboutRedirection();
    if (pkg && !flag("force"))
        throw new Error(`Not installing: the files would only exist inside ${pkg}. Run this from a normal PowerShell window (or pass --force).`);

    const dist = join(dataDir(), "dist");
    const source = resolve(flag("dist") ?? "dist");
    console.log(`Copying ${source} -> ${dist}`);
    copyDist(source, dist);

    const enable = typeof flag("enable") === "string" ? flag("enable").split(",").map(s => s.trim()).filter(Boolean) : [];
    prepareSettings(enable);

    const stub = makeStubAsar(join(dist, "patcher.js"));
    for (const flavor of flavors) {
        console.log(`Patching Discord ${flavor}`);
        killDiscord(flavor);
        for (const dir of resourceDirs(flavor)) {
            const app = join(dir, "app.asar");
            const backup = join(dir, "_app.asar");
            if (!existsSync(backup)) {
                if (!existsSync(app)) {
                    console.log(`  skip ${dir}: no app.asar`);
                    continue;
                }
                renameSync(app, backup);
            }
            writeFileSync(app, stub);
            if (existsSync(join(dir, "app"))) console.log(`  warning: ${join(dir, "app")} exists and loads before app.asar. Remove it if Renuxcord doesn't show up`);
            console.log(`  ${dir}: ${describe(dir)}`);
        }
        if (!flag("no-restart")) startDiscord(flavor);
    }
    console.log("Done. Renuxcord is installed.");
}

function uninstall() {
    for (const flavor of selectedFlavors()) {
        console.log(`Restoring Discord ${flavor}`);
        killDiscord(flavor);
        for (const dir of resourceDirs(flavor)) {
            const backup = join(dir, "_app.asar");
            if (!existsSync(backup)) continue;
            rmSync(join(dir, "app.asar"), { force: true });
            renameSync(backup, join(dir, "app.asar"));
            console.log(`  ${dir}: ${describe(dir)}`);
        }
        if (!flag("no-restart")) startDiscord(flavor);
    }
    console.log(`Done. Your Renuxcord settings are still in ${dataDir()}`);
}

const commands = { status, install, uninstall };

try {
    if (!Object.hasOwn(commands, command)) throw new Error(`Unknown command "${command}". Use status, install or uninstall`);
    commands[command]();
} catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
}
