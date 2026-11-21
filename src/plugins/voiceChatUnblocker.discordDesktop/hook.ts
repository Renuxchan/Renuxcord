/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's voice WebSocket (RTCControlSocket) tells the voice engine which server to send UDP to: READY (op 2) has
// d.ip and d.port, and sfu_update (op 33) can move it to d.primary.ip and d.primary.port. This points those at a
// relay on 127.0.0.1 before Discord reads them. Every other message goes through untouched and in order.

export interface VoiceHookOptions {
    isVoiceUrl(url: string): boolean;
    openRelay(owner: string, ip: string, port: number): Promise<{ port: number; }>;
    closeOwner(owner: string): void;
    log(text: string, err?: unknown): void;
}

interface WindowLike {
    WebSocket: typeof WebSocket;
    MessageEvent: typeof MessageEvent;
}

export function isVoiceGateway(url: unknown) {
    try {
        return new URL(String(url)).hostname.endsWith(".discord.media");
    } catch {
        return false;
    }
}

/** Returns the message Discord should see: the same text, or READY/sfu_update pointing at a relay */
export async function rewriteVoiceMessage(raw: string, owner: string, opts: VoiceHookOptions): Promise<string> {
    if (raw.length > 200_000 || !raw.includes("\"ip\"")) return raw;

    let msg: any;
    try {
        msg = JSON.parse(raw);
    } catch {
        return raw;
    }

    const target = msg?.op === 2 ? msg.d : msg?.op === 33 ? msg.d?.primary : null;
    if (!target || typeof target.ip !== "string" || typeof target.port !== "number") return raw;

    try {
        const relay = await opts.openRelay(owner, target.ip, target.port);
        opts.log(`Voice server ${target.ip}:${target.port} goes through the relay on 127.0.0.1:${relay.port}`);
        target.ip = "127.0.0.1";
        target.port = relay.port;
        return JSON.stringify(msg);
    } catch (err) {
        opts.log("Couldn't open a voice relay, this voice connection goes direct", err);
        return raw;
    }
}

/** Hooks voice WebSockets made from now on. Returns the function that takes the hook out again */
export function installVoiceHook(win: WindowLike, opts: VoiceHookOptions): () => void {
    const Native = win.WebSocket;
    const proto = Native.prototype;
    const onmessage = Object.getOwnPropertyDescriptor(proto, "onmessage");
    if (!onmessage?.get || !onmessage.set) throw new Error("WebSocket.onmessage can't be hooked here");

    interface Voice {
        owner: string;
        handler: ((this: WebSocket, ev: MessageEvent) => unknown) | null;
        queue: Promise<void>;
    }
    const voices = new WeakMap<WebSocket, Voice>();
    let nextOwner = 1;

    // Discord assigns ws.onmessage. For voice sockets the handler is kept here and called with the rewritten message
    Object.defineProperty(proto, "onmessage", {
        configurable: true,
        enumerable: onmessage.enumerable,
        get(this: WebSocket) {
            const voice = voices.get(this);
            return voice ? voice.handler : onmessage.get!.call(this);
        },
        set(this: WebSocket, fn: Voice["handler"]) {
            const voice = voices.get(this);
            if (voice) voice.handler = fn;
            else onmessage.set!.call(this, fn);
        }
    });

    const deliver = (ws: WebSocket, voice: Voice, event: MessageEvent) => {
        // One at a time, so a message never overtakes READY while its relay opens
        voice.queue = voice.queue.then(async () => {
            let ev = event;
            if (typeof event.data === "string") {
                const data = await rewriteVoiceMessage(event.data, voice.owner, opts);
                if (data !== event.data) ev = new win.MessageEvent("message", { data, origin: event.origin });
            }
            voice.handler?.call(ws, ev);
        }).catch(err => opts.log("A voice gateway message failed", err));
    };

    const Hooked = new Proxy(Native, {
        construct(target, args, newTarget) {
            const ws: WebSocket = Reflect.construct(target, args, newTarget);
            if (opts.isVoiceUrl(String(args[0]))) {
                const voice: Voice = { owner: `voice-${nextOwner++}`, handler: null, queue: Promise.resolve() };
                voices.set(ws, voice);
                onmessage.set!.call(ws, (e: MessageEvent) => deliver(ws, voice, e));
                ws.addEventListener("close", () => opts.closeOwner(voice.owner));
            }
            return ws;
        }
    });
    win.WebSocket = Hooked;

    return () => {
        if (win.WebSocket === Hooked) win.WebSocket = Native;
        Object.defineProperty(proto, "onmessage", onmessage);
    };
}
