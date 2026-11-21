/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A UDP relay between Discord's voice engine and one voice server. Networks that block Discord voice (like in the
// UAE) recognise it from how a flow starts: the 74-byte IP discovery packet. The relay starts each flow with decoy
// packets first, so the flow doesn't look like Discord voice. If the server doesn't answer, it moves to a fresh source
// port (a new flow as far as the network can tell) and tries the next trick.

import { randomBytes, randomInt } from "crypto";
import { createSocket, RemoteInfo, Socket } from "dgram";
import { isIPv6 } from "net";

import type { Trick } from "./tricks";

export type { Trick };

export interface RelayOptions {
    /** Tried in this order until the server answers */
    tricks: Trick[];
    /** Hops the low-TTL fakes live for: enough to reach the network's filter, too few to reach Discord */
    lowTtl: number;
    /** How long to wait for the server before trying the next trick */
    answerTimeout: number;
    onAnswered?(relay: VoiceRelay): void;
    onFailed?(relay: VoiceRelay): void;
}

export interface RelayInfo {
    id: number;
    owner: string;
    server: string;
    port: number;
    trick: Trick | null;
    attempts: number;
    answered: boolean;
    failed: boolean;
    up: number;
    down: number;
    decoys: number;
    since: number;
}

let nextId = 1;

const sameAddress = (a: string, b: string) => a.replace(/^::ffff:/, "") === b.replace(/^::ffff:/, "");

/** Discord's IP discovery request: type 1, length 70, 74 bytes in all */
const isDiscovery = (msg: Buffer) => msg.length === 74 && msg.readUInt16BE(0) === 1 && msg.readUInt16BE(2) === 70;

export class VoiceRelay {
    readonly id = nextId++;
    port = 0;
    answered = false;
    failed = false;
    closed = false;
    up = 0;
    down = 0;
    decoys = 0;
    lastActivity = Date.now();
    readonly since = Date.now();

    private local: Socket | null = null;
    private remote: Socket | null = null;
    private client: RemoteInfo | null = null;
    private first: Buffer | null = null;
    private early: Buffer | null = null;
    private earlyTimer: ReturnType<typeof setTimeout> | null = null;
    private attempt = -1;
    /** False while a try opens its socket and sends its decoys */
    private flowing = false;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(readonly owner: string, readonly serverIp: string, readonly serverPort: number, private readonly opts: RelayOptions) { }

    get trick(): Trick | null {
        return this.attempt >= 0 ? this.opts.tricks[Math.min(this.attempt, this.opts.tricks.length - 1)] : null;
    }

    /** Opens the loopback side Discord's voice engine talks to. Returns its port */
    async start() {
        const local = this.local = createSocket("udp4");
        local.on("message", (msg, rinfo) => this.fromClient(msg, rinfo));
        local.on("error", () => this.close());
        await new Promise<void>((resolve, reject) => {
            local.once("error", reject);
            local.bind(0, "127.0.0.1", () => {
                local.off("error", reject);
                resolve();
            });
        });
        this.port = local.address().port;
        return this.port;
    }

    private fromClient(msg: Buffer, rinfo: RemoteInfo) {
        if (this.closed) return;
        // The first sender is Discord's voice engine. Nothing else on this computer gets to use the relay
        if (this.client && (rinfo.port !== this.client.port || rinfo.address !== this.client.address)) return;
        this.client = rinfo;
        this.lastActivity = Date.now();
        this.up++;

        const discovery = isDiscovery(msg);
        // Kept for every new try, newest first: Discord repeats the request when it hears nothing back
        if (discovery) this.first = Buffer.from(msg);

        if (this.attempt < 0) {
            // The flow has to start with decoys, then the IP discovery request, so hold it. Whatever comes before it is
            // dropped: with Drover on too, its own junk packets reach the relay first, and the decoys take their place
            if (discovery) {
                this.clearEarly();
                void this.nextAttempt();
            } else {
                // In case a future Discord changes the request: start with the newest packet after a few seconds
                this.early = Buffer.from(msg);
                this.earlyTimer ??= setTimeout(() => {
                    this.earlyTimer = null;
                    if (this.attempt >= 0 || this.closed || !this.early) return;
                    this.first = this.early;
                    void this.nextAttempt();
                }, 3000);
            }
            return;
        }
        // Mid-way through a try's decoys: the request goes out after them (it was kept above)
        if (!this.flowing) return;
        this.toServer(msg);
    }

    private clearEarly() {
        if (this.earlyTimer) clearTimeout(this.earlyTimer);
        this.earlyTimer = null;
        this.early = null;
    }

    private fromServer(socket: Socket, msg: Buffer, rinfo: RemoteInfo) {
        if (this.closed || socket !== this.remote) return;
        if (rinfo.port !== this.serverPort || !sameAddress(rinfo.address, this.serverIp)) return;
        this.lastActivity = Date.now();
        this.down++;
        if (!this.answered) {
            this.answered = true;
            this.failed = false;
            if (this.timer) clearTimeout(this.timer);
            this.opts.onAnswered?.(this);
        }
        if (this.client) this.local?.send(msg, this.client.port, this.client.address);
    }

    private toServer(msg: Buffer) {
        try {
            this.remote?.send(msg, this.serverPort, this.serverIp);
        } catch {
            // The socket is being swapped for a new one; Discord resends what matters
        }
    }

    private async openRemote() {
        const old = this.remote;
        this.remote = null;
        try {
            old?.close();
        } catch { }

        const socket = createSocket(isIPv6(this.serverIp) ? "udp6" : "udp4");
        socket.on("message", (msg, rinfo) => this.fromServer(socket, msg, rinfo));
        socket.on("error", () => { });
        await new Promise<void>(resolve => socket.bind(0, () => resolve()));
        if (this.closed) {
            socket.close();
            return;
        }
        this.remote = socket;
    }

    private async nextAttempt() {
        if (this.closed) return;
        this.attempt++;
        this.flowing = false;
        await this.openRemote();
        if (!this.remote) return;

        await this.sendDecoys(this.trick!);
        if (this.first) this.toServer(this.first);
        this.flowing = true;

        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (this.answered || this.closed) return;
            if (this.attempt + 1 < this.opts.tricks.length) {
                void this.nextAttempt();
            } else {
                this.failed = true;
                this.opts.onFailed?.(this);
            }
        }, this.opts.answerTimeout);
    }

    private send(payload: Buffer) {
        return new Promise<void>(resolve => {
            const socket = this.remote;
            if (!socket) return resolve();
            try {
                socket.send(payload, this.serverPort, this.serverIp, () => resolve());
                this.decoys++;
            } catch {
                resolve();
            }
        });
    }

    private async junk(count: number, min: number, max: number) {
        for (let i = 0; i < count; i++) await this.send(randomBytes(randomInt(min, max + 1)));
    }

    // Same size as a real IP discovery packet, so a filter that sees one has seen "the start" of the flow, but they run
    // out of hops before reaching Discord, which never sees them
    private async lowTtlFakes() {
        const socket = this.remote;
        if (!socket) return;
        try {
            socket.setTTL(Math.max(1, Math.min(64, this.opts.lowTtl)));
            for (let i = 0; i < 3; i++) await this.send(randomBytes(74));
        } catch {
            // Some systems refuse a low TTL; the other tricks still run
        } finally {
            try {
                socket.setTTL(64);
            } catch { }
        }
    }

    private async sendDecoys(trick: Trick) {
        switch (trick) {
            case "junk":
                await this.junk(2, 1, 3);
                break;
            case "junk-lowttl":
                await this.lowTtlFakes();
                await this.junk(2, 1, 3);
                break;
            case "bigjunk":
                await this.junk(3, 200, 600);
                break;
            case "lowttl":
                await this.lowTtlFakes();
                break;
            case "none":
                break;
        }
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.clearEarly();
        for (const socket of [this.local, this.remote]) {
            try {
                socket?.close();
            } catch { }
        }
        this.local = this.remote = null;
    }

    info(): RelayInfo {
        return {
            id: this.id,
            owner: this.owner,
            server: `${this.serverIp}:${this.serverPort}`,
            port: this.port,
            trick: this.trick,
            attempts: this.attempt + 1,
            answered: this.answered,
            failed: this.failed,
            up: this.up,
            down: this.down,
            decoys: this.decoys,
            since: this.since
        };
    }
}
