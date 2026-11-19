/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { RenuxDevs } from "@utils/renuxcord";
import { matchesHotkey } from "@utils/renuxcordHotkeys";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, MediaEngineStore, SelectedChannelStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

interface VoiceState { guildId?: string | null; channelId?: string | null; selfMute?: boolean; selfDeaf?: boolean; selfVideo?: boolean; [key: string]: unknown; }
interface GatewaySocket { voiceStateUpdate(state: VoiceState): void; }

const GatewayConnectionStore = findStoreLazy("GatewayConnectionStore") as { getSocket(): GatewaySocket | null; };
const logger = new Logger("FakeDeafen");

const settings = definePluginSettings({
    alsoMute: {
        type: OptionType.BOOLEAN,
        description: "Also show you as muted (like a real deafen does). Your mic still works, so mute it yourself if you want silence",
        default: true
    },
    offWhenLeaving: {
        type: OptionType.BOOLEAN,
        description: "Turn fake deafen off when you leave the voice channel",
        default: true
    },
    showIndicator: {
        type: OptionType.BOOLEAN,
        description: "Show a small badge while fake deafen is on",
        default: true
    },
    hotkey: {
        type: OptionType.STRING,
        description: "Shortcut to toggle fake deafen",
        default: "ctrl+alt+d"
    }
});

let active = false;
let lastState: VoiceState | null = null;
let hooked: { socket: GatewaySocket; original: GatewaySocket["voiceStateUpdate"]; replacement: GatewaySocket["voiceStateUpdate"]; } | null = null;
let badge: HTMLDivElement | null = null;

function hook() {
    const socket = GatewayConnectionStore.getSocket?.();
    if (!socket || hooked?.socket === socket) return !!socket;

    const original = socket.voiceStateUpdate;
    const replacement = function (this: GatewaySocket, state: VoiceState) {
        lastState = state;
        if (active && state?.channelId) {
            state = { ...state, selfDeaf: true, selfMute: settings.store.alsoMute ? true : state.selfMute };
        }
        return original.call(this, state);
    };
    socket.voiceStateUpdate = replacement;
    hooked = { socket, original, replacement };
    return true;
}

function unhook() {
    if (!hooked) return;
    if (hooked.socket.voiceStateUpdate === hooked.replacement) {
        // Fall back to the class method again
        delete (hooked.socket as Partial<GatewaySocket>).voiceStateUpdate;
        if (hooked.socket.voiceStateUpdate !== hooked.original) hooked.socket.voiceStateUpdate = hooked.original;
    }
    hooked = null;
}

/** Sends the current voice state again so the change shows up for everyone right away */
function resend() {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId || !hooked) return;
    const me = UserStore.getCurrentUser()?.id;
    const base: VoiceState = lastState?.channelId === channelId ? lastState : {
        guildId: ChannelStore.getChannel(channelId)?.guild_id ?? null,
        channelId,
        selfVideo: me ? VoiceStateStore.getVoiceStateForUser(me)?.selfVideo ?? false : false
    };
    try {
        hooked.socket.voiceStateUpdate({ ...base, selfMute: MediaEngineStore.isSelfMute(), selfDeaf: MediaEngineStore.isSelfDeaf() });
    } catch (err) {
        logger.error("Couldn't resend the voice state", err);
    }
}

function renderBadge() {
    if (!active || !settings.store.showIndicator) {
        badge?.remove();
        badge = null;
        return;
    }
    if (badge) return;
    badge = document.createElement("div");
    badge.textContent = "🎧 Fake deafened";
    badge.title = "Others see you as deafened, but you can still hear. Click to turn off";
    badge.style.cssText = "position:fixed;bottom:62px;left:12px;z-index:10000;padding:5px 10px;border-radius:999px;cursor:pointer;"
        + "background:#ed4245;color:#fff;font:600 12px var(--font-primary,sans-serif);box-shadow:0 4px 14px rgb(0 0 0 / 35%)";
    badge.onclick = () => setActive(false);
    document.body.appendChild(badge);
}

function setActive(on: boolean) {
    if (on && !hook()) {
        showToast({ text: "Couldn't hook Discord's voice connection, try again in a moment", variant: "critical" });
        return;
    }
    active = on;
    resend();
    renderBadge();
    showToast({
        text: on ? "🎧 Fake deafen on: everyone sees you deafened, you can still hear them" : "Fake deafen off",
        variant: on ? "success" : "default"
    });
}

function onKeyDown(e: KeyboardEvent) {
    if (!settings.store.hotkey || !matchesHotkey(settings.store.hotkey, e)) return;
    e.preventDefault();
    e.stopPropagation();
    setActive(!active);
}

export default definePlugin({
    name: "FakeDeafen",
    description: "Look deafened (and muted) to everyone in the call while you can still hear them. Toggle with Ctrl+Alt+D, the toolbox or /fakedeafen",
    tags: ["Renuxcord", "Voice", "Fun"],
    authors: [RenuxDevs.Larpbase],
    settings,

    toolboxActions: {
        "Toggle Fake Deafen": () => setActive(!active)
    },

    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (!channelId && active && settings.store.offWhenLeaving) {
                active = false;
                renderBadge();
            }
        }
    },

    commands: [{
        name: "fakedeafen",
        description: "Toggle fake deafen: look deafened while you can still hear",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            setActive(!active);
            if (active && !SelectedChannelStore.getVoiceChannelId())
                sendBotMessage(ctx.channel.id, { content: "🎧 Fake deafen is on and kicks in as soon as you join a voice channel." });
        }
    }],

    start() {
        hook();
        document.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        const wasActive = active;
        active = false;
        if (wasActive) resend();
        unhook();
        renderBadge();
    }
});
