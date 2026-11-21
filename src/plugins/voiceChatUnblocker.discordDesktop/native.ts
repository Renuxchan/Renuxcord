/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

import { RelayInfo, VoiceRelay } from "./relay";
import { AUTO_TRICKS, Trick } from "./tricks";

export interface RelaySettings {
    trick: "auto" | Trick;
    lowTtl: number;
}

const relays = new Map<number, VoiceRelay>();
// The trick that got through last time goes first next time
let preferred: Trick | null = null;
let lastFailure: string | null = null;

const IDLE_LIMIT = 3 * 60_000;

function tricksFor(settings: RelaySettings): Trick[] {
    if (settings.trick !== "auto") return [settings.trick];
    return preferred ? [preferred, ...AUTO_TRICKS.filter(t => t !== preferred)] : [...AUTO_TRICKS];
}

/** A relay for one voice server, reused while the same voice connection asks for the same server */
export async function openRelay(_: IpcMainInvokeEvent, owner: string, ip: string, port: number, settings: RelaySettings) {
    if (typeof ip !== "string" || !/^[\d.:a-fA-F]+$/.test(ip) || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("Not a voice server address");

    for (const relay of relays.values())
        if (!relay.closed && relay.owner === owner && relay.serverIp === ip && relay.serverPort === port)
            return { port: relay.port, id: relay.id };

    const relay = new VoiceRelay(owner, ip, port, {
        tricks: tricksFor(settings),
        lowTtl: Number(settings.lowTtl) || 4,
        answerTimeout: 1500,
        onAnswered: r => {
            preferred = r.trick;
            lastFailure = null;
        },
        onFailed: r => {
            lastFailure = `${r.serverIp}:${r.serverPort} didn't answer after ${r.info().attempts} tricks`;
        }
    });
    await relay.start();
    relays.set(relay.id, relay);
    return { port: relay.port, id: relay.id };
}

/** The voice connection (its WebSocket) closed: its relays aren't needed anymore */
export function closeOwner(_: IpcMainInvokeEvent, owner: string) {
    for (const [id, relay] of relays) {
        if (relay.owner !== owner) continue;
        relay.close();
        relays.delete(id);
    }
}

export function closeAll() {
    for (const relay of relays.values()) relay.close();
    relays.clear();
}

export function status(): { relays: RelayInfo[]; preferred: Trick | null; lastFailure: string | null; } {
    return { relays: [...relays.values()].map(r => r.info()), preferred, lastFailure };
}

// A relay whose voice connection went quiet (the WebSocket's close never arrived) goes away by itself
setInterval(() => {
    const now = Date.now();
    for (const [id, relay] of relays) {
        if (relay.closed || now - relay.lastActivity > IDLE_LIMIT) {
            relay.close();
            relays.delete(id);
        }
    }
}, 30_000).unref?.();
