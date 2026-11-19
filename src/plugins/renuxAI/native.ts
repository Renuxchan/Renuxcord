/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { delimiter, join } from "path";

export interface AskOptions {
    apiKey?: string;
    model: string;
    effort: "low" | "medium" | "high";
    system: string;
    prompt: string;
    /** Optional image (Discord CDN URL) for Claude to look at */
    imageUrl?: string;
    maxTokens?: number;
}

export type AskResult = { ok: true; text: string; via: string; } | { ok: false; error: string; };

// Haiku has no server-side refusal fallback
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"]);
const WORK_DIR = join(tmpdir(), "renuxcord-ai");
const TIMEOUT_MS = 180_000;

let cached: { key: string; client: Anthropic; } | null = null;

function getClient(apiKey?: string) {
    const key = apiKey?.trim() ?? "";
    if (cached?.key === key) return cached.client;

    // Without a key the SDK uses ANTHROPIC_API_KEY or an `ant auth login` profile
    const client = new Anthropic({ ...(key ? { apiKey: key } : {}), timeout: 120_000, maxRetries: 2 });
    cached = { key, client };
    return client;
}

/** Claude through the Anthropic API (needs a key) */
export async function ask(_: IpcMainInvokeEvent, opts: AskOptions): Promise<AskResult> {
    try {
        const client = getClient(opts.apiKey);
        const content: Anthropic.ContentBlockParam[] = [
            ...(opts.imageUrl ? [{ type: "image" as const, source: { type: "url" as const, url: opts.imageUrl } }] : []),
            { type: "text", text: opts.prompt }
        ];
        const params = {
            model: opts.model,
            max_tokens: opts.maxTokens ?? 16000,
            system: opts.system,
            messages: [{ role: "user" as const, content }],
            output_config: { effort: opts.effort }
        };

        const res = FALLBACK_MODELS.has(opts.model)
            ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
            : await client.messages.create(params);

        if (res.stop_reason === "refusal") return { ok: false, error: "Claude declined to answer that one." };

        const blocks = res.content as Array<{ type: string; text?: string; }>;
        const text = blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("").trim();
        return { ok: true, text: text || "(empty answer)", via: res.model };
    } catch (err) {
        if (err instanceof Anthropic.AuthenticationError)
            return { ok: false, error: "That Anthropic API key isn't valid. Check it in RenuxAI's settings, or switch the provider to Claude Code." };
        if (err instanceof Anthropic.RateLimitError)
            return { ok: false, error: "The Claude API is rate limiting you, try again in a moment." };
        if (err instanceof Anthropic.APIError)
            return { ok: false, error: `Claude API error${err.status ? ` ${err.status}` : ""}: ${err.message}` };

        const message = err instanceof Error ? err.message : String(err);
        if (/api.?key|credential|auth/i.test(message))
            return { ok: false, error: "No Anthropic API key found. Add one in RenuxAI's settings, or install Claude Code and sign in so RenuxAI can use that instead." };
        return { ok: false, error: message };
    }
}

// ─── Claude Code provider: uses the person's own Claude login, no API key ───

interface ClaudeCodeExe { path: string; shell: boolean; }

function searchDirs() {
    const home = homedir();
    const extra = process.platform === "win32"
        ? [join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "npm")]
        // Apps opened from Finder get a minimal PATH, so add the usual install spots
        : ["/opt/homebrew/bin", "/usr/local/bin", join(home, ".npm-global", "bin"), join(home, ".bun", "bin")];

    return [...new Set([
        ...(process.env.PATH ?? "").split(delimiter),
        join(home, ".local", "bin"),
        join(home, ".claude", "local"),
        ...extra
    ].filter(Boolean))];
}

function findClaudeCode(): ClaudeCodeExe | null {
    const dirs = searchDirs();
    const win = process.platform === "win32";

    for (const dir of dirs) {
        const exe = join(dir, win ? "claude.exe" : "claude");
        if (existsSync(exe)) return { path: exe, shell: false };
    }
    // npm installs on Windows only have a .cmd shim, which has to go through cmd.exe
    if (win) for (const dir of dirs) {
        const cmd = join(dir, "claude.cmd");
        if (existsSync(cmd)) return { path: cmd, shell: true };
    }
    return null;
}

export function claudeCodeStatus() {
    const found = findClaudeCode();
    return { installed: !!found, path: found ? found.path.replace(homedir(), "~") : null };
}

const KEEP_ENV = new Set(["CLAUDE_CODE_GIT_BASH_PATH", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CONFIG_DIR"]);

function childEnv() {
    const env = { ...process.env };

    // If Discord was started from inside a Claude Code session it inherited that session's
    // variables, which would make our child think it's nested in it. Start clean instead.
    if (env.CLAUDECODE) {
        for (const key of Object.keys(env))
            if (/^CLAUDE/i.test(key) && !KEEP_ENV.has(key.toUpperCase())) delete env[key];
        delete env.ANTHROPIC_BASE_URL;
    }

    const pathKey = Object.keys(env).find(k => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = searchDirs().join(delimiter);
    return env;
}

function buildArgs(opts: AskOptions, systemFile: string | null, withImage: boolean, modern: boolean) {
    const args = ["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--model", opts.model];
    args.push(...systemFile ? ["--system-prompt-file", systemFile] : ["--system-prompt", opts.system]);

    // No MCP servers, hooks, CLAUDE.md, skills or plugins, and no tools except reading the one image
    if (modern) args.push("--safe-mode", "--disable-slash-commands", "--effort", opts.effort);
    args.push("--tools", withImage ? "Read" : "");
    if (withImage) args.push("--allowedTools", "Read");
    return args;
}

const quoteForCmd = (arg: string) => /^[\w\-.:\\/=]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;

interface RunResult { code: number | null; out: string; err: string; timedOut?: boolean; spawnError?: string; }

function runClaudeCode(exe: ClaudeCodeExe, args: string[], input: string) {
    return new Promise<RunResult>(resolve => {
        let out = "";
        let err = "";
        let settled = false;
        const finish = (r: RunResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(r);
        };

        const child = exe.shell
            ? spawn(`"${exe.path}"`, args.map(quoteForCmd), { cwd: WORK_DIR, env: childEnv(), windowsHide: true, shell: true })
            : spawn(exe.path, args, { cwd: WORK_DIR, env: childEnv(), windowsHide: true });

        const timer = setTimeout(() => {
            child.kill();
            finish({ code: null, out, err, timedOut: true });
        }, TIMEOUT_MS);

        child.stdout.on("data", d => out += d);
        child.stderr.on("data", d => err += d);
        child.on("error", e => finish({ code: null, out, err, spawnError: e.message }));
        child.on("close", code => finish({ code, out, err }));
        child.stdin.on("error", () => { });
        child.stdin.end(input);
    });
}

function friendlyClaudeCodeError(text: string) {
    if (/authenticat|log ?in|oauth|credentials|not logged|invalid api key/i.test(text))
        return "Claude Code isn't signed in. Open a terminal, run `claude`, type /login once, then try again.";
    if (/model/i.test(text) && /not|invalid|available|access|support/i.test(text))
        return `Claude Code can't use that model on your plan. Pick another model in RenuxAI's settings. (${text.slice(0, 160)})`;
    if (/rate.?limit|usage limit|limit reached|quota/i.test(text))
        return `Claude Code hit a usage limit: ${text.slice(0, 200)}`;
    return `Claude Code: ${text.slice(0, 300)}`;
}

function parseResult(r: RunResult): AskResult {
    if (r.spawnError) return { ok: false, error: `Couldn't start Claude Code: ${r.spawnError}` };
    if (r.timedOut) return { ok: false, error: "Claude Code took longer than 3 minutes, so I stopped it." };

    const trimmed = r.out.trim();
    const candidates = [trimmed, ...trimmed.split(/\r?\n/).reverse().filter(l => l.startsWith("{"))];
    for (const candidate of candidates) {
        try {
            const json = JSON.parse(candidate);
            if (json?.type !== "result") continue;
            if (json.is_error) return { ok: false, error: friendlyClaudeCodeError(String(json.result ?? json.terminal_reason ?? "error")) };
            return { ok: true, text: String(json.result ?? "").trim() || "(empty answer)", via: "Claude Code" };
        } catch { }
    }
    return { ok: false, error: friendlyClaudeCodeError((r.err || r.out || `exited with code ${r.code}`).trim()) };
}

async function downloadImage(url: string, stamp: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't download the image (HTTP ${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("png") ? "png" : type.includes("gif") ? "gif" : type.includes("webp") ? "webp" : "jpg";
    const file = join(WORK_DIR, `image-${stamp}.${ext}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
}

/** Claude through the person's own Claude Code login, so no API key is needed */
export async function askClaudeCode(_: IpcMainInvokeEvent, opts: AskOptions): Promise<AskResult> {
    const exe = findClaudeCode();
    if (!exe) return { ok: false, error: "Claude Code isn't installed. Get it from claude.com/claude-code and sign in once, or add an Anthropic API key in RenuxAI's settings." };

    mkdirSync(WORK_DIR, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempFiles: string[] = [];

    try {
        const image = opts.imageUrl ? await downloadImage(opts.imageUrl, stamp) : null;
        if (image) tempFiles.push(image);

        // cmd.exe mangles long quoted arguments, so the .cmd shim gets the system prompt from a file
        let systemFile: string | null = null;
        if (exe.shell) {
            systemFile = join(WORK_DIR, `system-${stamp}.txt`);
            writeFileSync(systemFile, opts.system);
            tempFiles.push(systemFile);
        }

        const input = image ? `The image is the file ${image}. Look at it with the Read tool first.\n\n${opts.prompt}` : opts.prompt;
        let result = await runClaudeCode(exe, buildArgs(opts, systemFile, !!image, true), input);
        // Older Claude Code versions don't know the newer flags
        if (/unknown option|unrecognized option/i.test(result.err + result.out))
            result = await runClaudeCode(exe, buildArgs(opts, systemFile, !!image, false), input);

        return parseResult(result);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
        for (const file of tempFiles) rmSync(file, { force: true });
    }
}
