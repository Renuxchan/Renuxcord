/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, GuildMemberStore, GuildStore, NavigationRouter, SelectedChannelStore } from "@webpack/common";

/** A message as it arrives in MESSAGE_CREATE / MESSAGE_UPDATE flux events (raw gateway JSON) */
export interface RawMessage {
    id: string;
    channel_id: string;
    guild_id?: string;
    content?: string;
    timestamp?: string;
    author?: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean; };
    mentions?: Array<{ id: string; } | string>;
    mention_roles?: string[];
    mention_everyone?: boolean;
    attachments?: unknown[];
}

export interface MentionOptions {
    everyone?: boolean;
    roles?: boolean;
}

/** Whether a raw message pings the user, directly or (optionally) through @everyone or a role */
export function mentionsUser(msg: RawMessage, userId: string, { everyone = false, roles = true }: MentionOptions = {}) {
    if (msg.mentions?.some(m => (typeof m === "string" ? m : m?.id) === userId)) return true;
    if (everyone && msg.mention_everyone) return true;

    if (roles && msg.mention_roles?.length) {
        const guildId = msg.guild_id ?? ChannelStore.getChannel(msg.channel_id)?.guild_id;
        const myRoles = guildId ? GuildMemberStore.getSelfMember(guildId)?.roles ?? [] : [];
        if (msg.mention_roles.some(r => myRoles.includes(r))) return true;
    }
    return false;
}

export const authorName = (author?: RawMessage["author"]) => author?.global_name || author?.username || "Someone";

export function avatarOf(author?: RawMessage["author"]) {
    if (!author) return undefined;
    if (author.avatar) return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=128`;
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(author.id) >> 22n) % 6n)}.png`;
}

/** "#general · My Server", "your DMs" or a group DM name */
export function whereLabel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "a channel";
    if (!channel.guild_id) return channel.name ? `the group ${channel.name}` : "your DMs";
    return `#${channel.name} · ${GuildStore.getGuild(channel.guild_id)?.name ?? "a server"}`;
}

export function jumpTo(channelId: string, messageId?: string) {
    const guildId = ChannelStore.getChannel(channelId)?.guild_id ?? "@me";
    NavigationRouter.transitionTo(`/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ""}`);
}

/** True while the user is actually looking at that channel */
export const isViewing = (channelId: string) => document.hasFocus() && SelectedChannelStore.getChannelId() === channelId;

export const truncate = (text: string, max = 180) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
