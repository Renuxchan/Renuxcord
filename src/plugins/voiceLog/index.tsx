/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildMemberStore, Modal, openModal, SelectedChannelStore, showToast, UserStore } from "@webpack/common";

interface VoiceStateChange {
    userId: string;
    channelId?: string | null;
    oldChannelId?: string | null;
    guildId?: string;
}

interface Entry {
    at: number;
    text: string;
}

const settings = definePluginSettings({
    toasts: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when someone joins or leaves your voice channel",
        default: true
    }
});

const log: Entry[] = [];

function displayName(userId: string, guildId?: string | null) {
    const user = UserStore.getUser(userId);
    return (guildId && GuildMemberStore.getNick(guildId, userId)) || user?.globalName || user?.username || "Someone";
}

const channelName = (id?: string | null) => (id && ChannelStore.getChannel(id)?.name) || "a voice channel";

function record(text: string, toast: boolean) {
    log.unshift({ at: Date.now(), text });
    if (log.length > 200) log.length = 200;
    if (toast && settings.store.toasts) showToast({ text });
}

function openLog() {
    openModal(props => (
        <Modal {...props} title="Voice log" subtitle="Who came and went in your voice channels this session" actions={[{ text: "Close", variant: "secondary", onClick: props.onClose }]}>
            {log.length
                ? <div style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--text-default, var(--text-normal))" }}>
                    {log.map((e, i) => (
                        <div key={i}><span style={{ color: "var(--text-muted)", fontFamily: "var(--font-code)" }}>{new Date(e.at).toLocaleTimeString()}</span> {e.text}</div>
                    ))}
                </div>
                : <div style={{ color: "var(--text-muted)" }}>Nothing yet. Join a voice channel.</div>}
        </Modal>
    ));
}

export default definePlugin({
    name: "VoiceLog",
    description: "Keeps a timestamped log of who joins and leaves your voice channel, with optional toasts (/voicelog)",
    tags: ["Renuxcord", "Voice", "Notifications"],
    authors: [RenuxDevs.Larpbase],
    settings,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceStateChange[]; }) {
            const me = UserStore.getCurrentUser()?.id;
            const mine = SelectedChannelStore.getVoiceChannelId();

            for (const { userId, channelId, oldChannelId, guildId } of voiceStates ?? []) {
                if (channelId === oldChannelId) continue;

                if (userId === me) {
                    if (channelId) record(`🎧 You joined ${channelName(channelId)}`, false);
                    else if (oldChannelId) record(`👋 You left ${channelName(oldChannelId)}`, false);
                    continue;
                }

                if (!mine) continue;
                const name = displayName(userId, guildId);
                if (channelId === mine) record(`🔊 ${name} joined`, true);
                else if (oldChannelId === mine) record(`🔈 ${name} left${channelId ? ` for ${channelName(channelId)}` : ""}`, true);
            }
        }
    },

    commands: [{
        name: "voicelog",
        description: "Show who joined and left your voice channel recently",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            sendBotMessage(ctx.channel.id, {
                content: log.length
                    ? log.slice(0, 20).map(e => `<t:${Math.floor(e.at / 1000)}:T> ${e.text}`).join("\n")
                    : "Nothing logged yet this session."
            });
        }
    }],

    toolboxActions: {
        "Open voice log": openLog
    }
});
