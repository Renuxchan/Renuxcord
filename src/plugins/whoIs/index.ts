/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { prettyBirthday } from "@plugins/birthdayReminders";
import { getZone, timeIn } from "@plugins/friendTimes";
import { lastSeenText } from "@plugins/lastSeen";
import { RenuxDevs } from "@utils/renuxcord";
import { snowflakeDate } from "@utils/renuxcordTime";
import definePlugin from "@utils/types";
import { GuildMemberStore, GuildRoleStore, PresenceStore, RelationshipStore, UserProfileStore, UserStore } from "@webpack/common";

const ACTIVITY_VERBS: Record<number, string> = { 0: "🎮 Playing", 1: "📺 Streaming", 2: "🎵 Listening to", 3: "👀 Watching", 5: "🏆 Competing in" };
const STATUS: Record<string, string> = { online: "🟢 Online", idle: "🌙 Idle", dnd: "⛔ Do Not Disturb", offline: "⚫ Offline", invisible: "⚫ Offline", streaming: "🟣 Streaming" };
const ts = (date: Date | number, style = "R") => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;

function describe(userId: string, guildId?: string) {
    const user = UserStore.getUser(userId);
    if (!user) return "🔎 I don't have that user loaded. Open their profile once and try again.";

    const lines = [`🔎 **${user.globalName || user.username}** · @${user.username}${user.bot ? " · 🤖 bot" : ""}`];
    lines.push(`**ID** \`${user.id}\` · **Account created** ${ts(snowflakeDate(user.id), "D")} (${ts(snowflakeDate(user.id))})`);

    const status = PresenceStore.getStatus(user.id) ?? "offline";
    const activities = (PresenceStore.getActivities(user.id) ?? []).filter(a => a.type !== 4 && ACTIVITY_VERBS[a.type]);
    const custom = PresenceStore.getActivities(user.id)?.find(a => a.type === 4);
    lines.push(`**Status** ${STATUS[status] ?? status}${custom?.state ? ` · “${custom.state}”` : ""}`);
    for (const a of activities) lines.push(`${ACTIVITY_VERBS[a.type]} **${a.name}**${a.details ? ` · ${a.details}` : ""}${a.state ? ` · ${a.state}` : ""}`);

    if (guildId) {
        const member = GuildMemberStore.getMember(guildId, user.id);
        if (member) {
            const roles = (member.roles ?? [])
                .map(id => GuildRoleStore.getRole(guildId, id))
                .filter(Boolean)
                .sort((a, b) => b!.position - a!.position)
                .map(r => r!.name);
            if (member.nick) lines.push(`**Nickname here** ${member.nick}`);
            if (member.joinedAt) lines.push(`**Joined this server** ${ts(new Date(member.joinedAt), "D")} (${ts(new Date(member.joinedAt))})`);
            if (member.premiumSince) lines.push(`**Boosting since** ${ts(new Date(member.premiumSince), "D")}`);
            if (roles.length) lines.push(`**Roles (${roles.length})** ${roles.slice(0, 15).join(", ")}${roles.length > 15 ? "…" : ""}`);
        }
    }

    const relationship = RelationshipStore.isFriend(user.id) ? "👥 Friend" : RelationshipStore.isBlocked?.(user.id) ? "🚫 Blocked" : null;
    const mutualGuilds = UserProfileStore.getMutualGuilds(user.id)?.length;
    const mutualFriends = UserProfileStore.getMutualFriendsCount(user.id);
    const social = [
        relationship,
        mutualGuilds != null ? `${mutualGuilds} mutual server${mutualGuilds === 1 ? "" : "s"}` : null,
        mutualFriends != null ? `${mutualFriends} mutual friend${mutualFriends === 1 ? "" : "s"}` : null
    ].filter(Boolean);
    if (social.length) lines.push(social.join(" · "));

    // Extras from other Renuxcord plugins, when they're on
    const zone = getZone(user.id);
    if (zone) lines.push(`🕐 **Their time** ${timeIn(zone)} (${zone.replace(/_/g, " ")})`);
    const seen = lastSeenText(user.id);
    if (seen && seen !== "online now") lines.push(`🕓 **Last seen** ${seen}`);
    try {
        const birthday = isPluginEnabled("BirthdayReminders") ? Settings.plugins.BirthdayReminders?.birthdays?.[user.id] : undefined;
        if (birthday) lines.push(`🎂 **Birthday** ${prettyBirthday(birthday)}`);
    } catch { }

    return lines.join("\n");
}

export default definePlugin({
    name: "WhoIs",
    description: "/whois @someone: account age, when they joined the server, roles, status and games, mutual servers and friends, plus their local time, last seen and birthday from other Renuxcord plugins",
    tags: ["Renuxcord", "Commands", "Utility"],
    authors: [RenuxDevs.Larpbase],

    commands: [{
        name: "whois",
        description: "Everything about someone in one place (only you see it)",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{ name: "user", description: "Who", type: ApplicationCommandOptionType.USER, required: true }],
        execute(args, ctx) {
            sendBotMessage(ctx.channel.id, { content: describe(findOption<string>(args, "user", ""), ctx.guild?.id ?? ctx.channel.guild_id) });
        }
    }]
});
