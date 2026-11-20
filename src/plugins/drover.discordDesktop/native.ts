/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sets up hdrover's Discord Drover (https://github.com/hdrover/discord-drover): a version.dll that Discord.exe loads at
// startup, which sends Discord through a proxy and nudges its voice traffic past networks that block Discord voice.
// Drover has no licence, so Renuxcord never ships it. This downloads the official release when it's needed and only
// installs it if every file matches the hashes below.

import { RendererSettings } from "@main/settings";
import { DATA_DIR } from "@main/utils/constants";
import { fetchBuffer } from "@main/utils/http";
import { createHash } from "crypto";
import { app, IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

import { readZipEntry } from "./zip";

const RELEASE = "v0.9";
const ZIP_URL = `https://github.com/hdrover/discord-drover/releases/download/${RELEASE}/drover-${RELEASE}.zip`;
const ZIP_SHA256 = "9bd4f5e27ccd0e195ea0ffc5822d3057d8aad700b44b97067ab91fdb67c861a1";
const FILES = {
    "version.dll": "4ec839f1ecb25e7befb3a52d6ce521b0ec946da860002efeb527def045bd31c8",
    "drover-packet.bin": "f4589c57749f956bb30538197a521d7005f8b0a8723b4707e72405e51ddac50a"
};
type DroverFile = keyof typeof FILES;

const INI = "drover.ini";
const MARK = "; Written by Renuxcord";
const CACHE_DIR = join(DATA_DIR, "drover", RELEASE);

export type DroverMode = "direct" | "http" | "socks5";

export interface DroverConfig {
    mode: DroverMode;
    host: string;
    port: number;
    user: string;
    password: string;
    extraPacket: boolean;
}

export interface ApplyResult {
    changed: boolean;
    /** Something this running Discord loads at startup changed */
    restartNeeded: boolean;
    folders: string[];
    skipped: string[];
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const hashOf = (file: string) => existsSync(file) ? sha256(readFileSync(file)) : null;

const currentDir = () => dirname(process.execPath);

/** Every installed Discord version: app-x.y.z folders next to Update.exe, each with its own Discord.exe */
function appDirs() {
    const root = join(currentDir(), "..");
    const exe = basename(process.execPath);
    try {
        return readdirSync(root)
            .filter(d => /^app-\d/.test(d))
            .map(d => join(root, d))
            .filter(d => existsSync(join(d, exe)));
    } catch {
        return [currentDir()];
    }
}

function proxyUrl(config: DroverConfig, withLogin = true) {
    if (config.mode === "direct") return "";
    if (config.mode !== "http" && config.mode !== "socks5") throw new Error(`Unknown mode ${config.mode}`);

    const host = String(config.host ?? "").trim();
    const port = Number(config.port);
    if (!host) throw new Error("Enter the proxy's address");
    if (!/^[\w.:[\]-]+$/.test(host)) throw new Error("The proxy address can only have letters, numbers, dots, dashes and colons");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The proxy port has to be a number from 1 to 65535");

    // Drover only does logins for HTTP proxies
    const user = String(config.user ?? "").trim();
    const login = withLogin && config.mode === "http" && user && config.password ? `${user}:${config.password}@` : "";
    return `${config.mode}://${login}${host}:${port}`;
}

const iniFor = (config: DroverConfig) =>
    `[drover]\r\n${MARK}. Change it in Renuxcord's settings: Plugins > Drover\r\nproxy = ${proxyUrl(config)}\r\n`;

/** Drover's files, verified, from the cache or freshly downloaded */
async function droverFiles(): Promise<Record<DroverFile, Buffer>> {
    const files = {} as Record<DroverFile, Buffer>;
    const names = Object.keys(FILES) as DroverFile[];

    for (const name of names) {
        const file = join(CACHE_DIR, name);
        if (hashOf(file) === FILES[name]) files[name] = readFileSync(file);
    }
    if (names.every(n => files[n])) return files;

    const zip = await fetchBuffer(ZIP_URL);
    if (sha256(zip) !== ZIP_SHA256) throw new Error("The Drover download isn't the release Renuxcord expects, so nothing was installed");

    mkdirSync(CACHE_DIR, { recursive: true });
    for (const name of names) {
        const data = readZipEntry(zip, `drover/${name}`);
        if (!data || sha256(data) !== FILES[name]) throw new Error(`drover/${name} in the download isn't the expected file, so nothing was installed`);
        writeFileSync(join(CACHE_DIR, name), data);
        files[name] = data;
    }
    return files;
}

// What the running Discord loaded when it started
const loadedAtStart = process.platform === "win32" && hashOf(join(currentDir(), "version.dll")) === FILES["version.dll"];
const iniAtStart = (() => {
    try {
        return readFileSync(join(currentDir(), INI), "utf8");
    } catch {
        return null;
    }
})();

export async function apply(_: IpcMainInvokeEvent, config: DroverConfig): Promise<ApplyResult> {
    // On macOS and Linux the proxy is set when Discord starts (see the end of this file)
    if (process.platform !== "win32") return { changed: false, restartNeeded: false, folders: [], skipped: [] };

    const ini = iniFor(config);
    const files = await droverFiles();
    const result: ApplyResult = { changed: false, restartNeeded: false, folders: [], skipped: [] };

    for (const dir of appDirs()) {
        const isCurrent = dir === currentDir();
        const dll = join(dir, "version.dll");
        const dllHash = hashOf(dll);

        // Some other program uses the same version.dll trick, so leave this Discord alone
        if (dllHash && dllHash !== FILES["version.dll"]) {
            result.skipped.push(`${basename(dir)} already has a version.dll that isn't Drover's`);
            continue;
        }
        if (!dllHash) {
            writeFileSync(dll, files["version.dll"]);
            result.changed = true;
        }

        const iniPath = join(dir, INI);
        const oldIni = existsSync(iniPath) ? readFileSync(iniPath, "utf8") : null;
        if (oldIni !== ini) {
            writeFileSync(iniPath, ini);
            result.changed = true;
        }

        // Drover reads this before every voice connection, so it never needs a restart
        const packet = join(dir, "drover-packet.bin");
        const packetHash = hashOf(packet);
        if (config.extraPacket && !packetHash) {
            writeFileSync(packet, files["drover-packet.bin"]);
            result.changed = true;
        } else if (!config.extraPacket && packetHash === FILES["drover-packet.bin"]) {
            rmSync(packet, { force: true });
            result.changed = true;
        }

        if (isCurrent) result.restartNeeded = !loadedAtStart || iniAtStart !== ini;
        result.folders.push(basename(dir));
    }

    return result;
}

export function remove(): ApplyResult {
    const result: ApplyResult = { changed: false, restartNeeded: false, folders: [], skipped: [] };
    if (process.platform !== "win32") {
        result.restartNeeded = proxyFromSettings() != null;
        return result;
    }

    for (const dir of appDirs()) {
        for (const name of Object.keys(FILES) as DroverFile[]) {
            const file = join(dir, name);
            if (hashOf(file) !== FILES[name]) continue;
            try {
                rmSync(file);
            } catch {
                // Windows won't delete a DLL the running Discord has loaded, but it lets it be renamed
                renameSync(file, `${file}.${Date.now()}.old`);
            }
            result.changed = true;
        }

        const ini = join(dir, INI);
        if (existsSync(ini) && readFileSync(ini, "utf8").includes(MARK)) {
            rmSync(ini, { force: true });
            result.changed = true;
        }
        result.folders.push(basename(dir));
    }

    result.restartNeeded = loadedAtStart;
    return result;
}

export function status() {
    const base = { platform: process.platform, release: RELEASE, loaded: loadedAtStart };
    if (process.platform !== "win32") return { ...base, proxy: proxyFromSettings(), folders: [] };

    return {
        ...base,
        proxy: iniAtStart?.match(/^proxy\s*=\s*(.*)$/m)?.[1]?.replace(/\/\/[^@/]*@/, "//***@").trim() ?? null,
        folders: appDirs().map(dir => ({
            name: basename(dir),
            current: dir === currentDir(),
            dll: hashOf(join(dir, "version.dll")) === FILES["version.dll"] ? "drover" : existsSync(join(dir, "version.dll")) ? "other" : "none",
            ini: existsSync(join(dir, INI))
        }))
    };
}

// ---- startup ----

function proxyFromSettings(): DroverConfig | null {
    const s = RendererSettings.store.plugins?.Drover;
    if (!s?.enabled || (s.mode !== "http" && s.mode !== "socks5")) return null;
    return { mode: s.mode, host: s.proxyHost, port: s.proxyPort, user: s.proxyUser ?? "", password: s.proxyPassword ?? "", extraPacket: false };
}

try {
    if (process.platform === "win32") {
        // Leftovers from turning Drover off while Discord had it loaded
        for (const f of readdirSync(currentDir()))
            if (/^(version\.dll|drover-packet\.bin)\.\d+\.old$/.test(f)) rmSync(join(currentDir(), f), { force: true });
    } else {
        // No Drover outside Windows, but Chromium can still send Discord's own connections through the proxy
        const config = proxyFromSettings();
        if (config) {
            app.commandLine.appendSwitch("proxy-server", proxyUrl(config, false));
            if (config.mode === "http") process.env.http_proxy = process.env.https_proxy = proxyUrl(config);
            if (config.mode === "http" && config.user) {
                app.on("login", (event, _webContents, _details, authInfo, callback) => {
                    if (!authInfo.isProxy) return;
                    event.preventDefault();
                    callback(config.user, config.password);
                });
            }
        }
    }
} catch (err) {
    console.error("[Renuxcord] Drover setup at startup failed", err);
}
