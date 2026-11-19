/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { randomBytes, timingSafeEqual } from "crypto";
import { app, IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import type { AddressInfo } from "net";
import { join } from "path";

export interface BridgeRequest {
    id: number;
    method: string;
    params: any;
}

interface Pending extends BridgeRequest {
    finish(status: number, body: object): void;
}

const BRIDGE_FILE = join(DATA_DIR, "bridge.json");
// The MCP server ships next to patcher.js and is updated with it
const MCP_FILE = join(__dirname, "renuxcord-mcp.mjs");
const POLL_TIMEOUT = 25_000;
const MAX_BODY = 16 * 1024 * 1024;

let server: Server | null = null;
let port = 0;
let token = "";
let nextId = 1;
let lastPoll = 0;
let waiter: ((req: BridgeRequest | null) => void) | null = null;
const queue: Pending[] = [];
const inflight = new Map<number, Pending>();

function send(res: ServerResponse, status: number, body: object) {
    if (res.writableEnded) return;
    const data = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "Cache-Control": "no-store"
    });
    res.end(data);
}

function isAuthorized(req: IncomingMessage) {
    // Browsers always send Origin, so refusing it keeps web pages from driving the account
    if (req.headers.origin) return false;
    // Host check blocks DNS rebinding
    const { host } = req.headers;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;

    const expected = Buffer.from(`Bearer ${token}`);
    const given = Buffer.from(req.headers.authorization ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
}

function readBody(req: IncomingMessage) {
    return new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error("Request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}

function hand(p: Pending) {
    inflight.set(p.id, p);
    const w = waiter!;
    waiter = null;
    w({ id: p.id, method: p.method, params: p.params });
}

function enqueue(p: Pending) {
    if (waiter) hand(p);
    else queue.push(p);
}

function rendererConnected() {
    return waiter != null || Date.now() - lastPoll < POLL_TIMEOUT + 5_000;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!isAuthorized(req)) return send(res, 403, { ok: false, error: "Forbidden" });

    const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && pathname === "/status") {
        return send(res, 200, {
            ok: true,
            result: {
                client: "Renuxcord",
                pid: process.pid,
                rendererConnected: rendererConnected(),
                queued: queue.length,
                inflight: inflight.size
            }
        });
    }

    if (req.method !== "POST" || pathname !== "/rpc")
        return send(res, 404, { ok: false, error: "Not found" });

    let payload: any;
    try {
        payload = JSON.parse(await readBody(req));
    } catch (e) {
        return send(res, 400, { ok: false, error: "Invalid request body: " + String(e) });
    }

    const { method, params = {}, timeoutMs } = payload ?? {};
    if (typeof method !== "string") return send(res, 400, { ok: false, error: "Missing method" });

    const timeout = Math.min(Math.max(Number(timeoutMs) || 60_000, 1_000), 15 * 60_000);

    const p: Pending = {
        id: nextId++,
        method,
        params,
        finish(status, body) {
            clearTimeout(timer);
            const idx = queue.indexOf(p);
            if (idx !== -1) queue.splice(idx, 1);
            inflight.delete(p.id);
            send(res, status, body);
        }
    };

    const timer = setTimeout(() => p.finish(504, {
        ok: false,
        error: rendererConnected()
            ? `Discord did not finish "${method}" within ${timeout / 1000}s`
            : "Discord is not answering. Is Discord open and is the RenuxBridge plugin enabled?"
    }), timeout);

    // The caller hung up before Discord picked the request up, so drop it
    res.on("close", () => {
        if (!res.writableEnded) p.finish(499, { ok: false, error: "Client closed request" });
    });

    enqueue(p);
}

function listen(srv: Server, wanted: number) {
    return new Promise<number>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE" && wanted !== 0) {
                srv.off("error", onError);
                listen(srv, 0).then(resolve, reject);
            } else reject(err);
        };
        srv.once("error", onError);
        srv.listen(wanted, "127.0.0.1", () => {
            srv.off("error", onError);
            resolve((srv.address() as AddressInfo).port);
        });
    });
}

function removeBridgeFile() {
    try {
        rmSync(BRIDGE_FILE, { force: true });
    } catch { }
}

app.on("will-quit", () => {
    if (server) removeBridgeFile();
});

export async function start(_: IpcMainInvokeEvent, wantedPort: number) {
    if (server) return { port, file: BRIDGE_FILE };

    token = randomBytes(32).toString("hex");
    const srv = createServer((req, res) => {
        handle(req, res).catch(err => send(res, 500, { ok: false, error: String(err) }));
    });
    srv.keepAliveTimeout = 5_000;

    port = await listen(srv, wantedPort);
    server = srv;

    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(BRIDGE_FILE, JSON.stringify({
        client: "Renuxcord",
        url: `http://127.0.0.1:${port}`,
        port,
        token,
        pid: process.pid,
        startedAt: new Date().toISOString()
    }, null, 4), { mode: 0o600 });

    return { port, file: BRIDGE_FILE };
}

export function stop() {
    if (!server) return;

    server.close();
    server.closeAllConnections?.();
    server = null;
    removeBridgeFile();

    for (const p of [...queue, ...inflight.values()])
        p.finish(503, { ok: false, error: "The RenuxBridge plugin was stopped" });

    waiter?.(null);
    waiter = null;
}

export function poll(): Promise<BridgeRequest | null> {
    lastPoll = Date.now();

    const next = queue.shift();
    if (next) {
        inflight.set(next.id, next);
        return Promise.resolve({ id: next.id, method: next.method, params: next.params });
    }

    // A reloaded renderer leaves its old poll behind, so retire it
    waiter?.(null);

    return new Promise(resolve => {
        const self = (req: BridgeRequest | null) => {
            clearTimeout(timer);
            resolve(req);
        };
        const timer = setTimeout(() => {
            if (waiter === self) waiter = null;
            lastPoll = Date.now();
            resolve(null);
        }, POLL_TIMEOUT);
        waiter = self;
    });
}

export function reply(_: IpcMainInvokeEvent, id: number, ok: boolean, data: any) {
    const p = inflight.get(id);
    if (!p) return false;

    p.finish(200, ok ? { ok: true, result: data } : { ok: false, error: String(data) });
    return true;
}

export function info() {
    return {
        running: server != null,
        port,
        file: BRIDGE_FILE,
        rendererConnected: rendererConnected(),
        mcpFile: MCP_FILE,
        mcpInstalled: existsSync(MCP_FILE)
    };
}
