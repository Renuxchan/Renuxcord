/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel, Role } from "@vencord/discord-types";
import { GuildMemberCountStore, GuildMemberStore, GuildStore, NavigationRouter, PermissionsBits, PermissionStore, UserStore } from "@webpack/common";

import {
    CHANNEL_TYPES, channelType, channelTypeName, describeOverwriteTarget, forgetChannel, fromBits, guildChannels, guildRoles,
    isSnowflake, parseColor, permissionNames, rememberChannel, rememberRole, resolveChannel, resolveGuild, resolveMember,
    resolveRole, rest, sleep, toBits, toHex
} from "./discord";
import { applyLayout, buildOverwrites, exportLayout, guildSettingsBody, overwriteTarget, postMessage, reorderRoles, stripUndefined } from "./layout";

export interface ActionContext {
    allowWrite: boolean;
    allowDestructive: boolean;
    allowMessages: boolean;
    /** Something changed: toast + activity log */
    log(text: string): void;
    /** Step of a longer job: activity log only */
    progress(text: string): void;
}

type Action = (params: any, ctx: ActionContext) => unknown;

// Discord's own "Create My Own" template, which the client uses for a blank server
const CREATE_MY_OWN_TEMPLATE = "2TffvPucqHkN";

// Servers made through the bridge this session. Wiping their default channels is always fine
const createdThisSession = new Set<string>();

function needWrite(ctx: ActionContext) {
    if (!ctx.allowWrite) throw new Error('Changes are switched off. Turn on "Allow changes" in the RenuxBridge plugin settings.');
}

function needDestructive(ctx: ActionContext) {
    if (!ctx.allowDestructive) throw new Error('Deleting is switched off. Turn on "Allow deleting" in the RenuxBridge plugin settings first.');
}

function needMessages(ctx: ActionContext) {
    if (!ctx.allowMessages) throw new Error('Messages are switched off. Turn on "Allow messages" in the RenuxBridge plugin settings.');
}

const me = () => UserStore.getCurrentUser();
const clamp = (n: unknown, min: number, max: number, fallback: number) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), min), max) : fallback;
};

function roleInfo(r: Role | any, guildId: string) {
    return {
        id: r.id,
        name: r.id === guildId ? "@everyone" : r.name,
        color: toHex(r.color) ?? null,
        hoist: !!r.hoist,
        mentionable: !!r.mentionable,
        managed: !!r.managed,
        position: r.position,
        permissions: fromBits(r.permissions)
    };
}

function channelInfo(c: Channel | any, guildId: string) {
    return stripUndefined({
        id: c.id,
        name: c.name,
        type: channelTypeName(c.type),
        topic: c.topic || undefined,
        nsfw: c.nsfw || undefined,
        slowmode: c.rateLimitPerUser || undefined,
        userLimit: c.userLimit || undefined,
        position: c.position,
        overwrites: Object.values(c.permissionOverwrites ?? {}).map((o: any) => ({
            target: describeOverwriteTarget(guildId, o.id, o.type),
            id: o.id,
            type: o.type === 1 ? "member" : "role",
            allow: fromBits(o.allow),
            deny: fromBits(o.deny)
        }))
    });
}

/** Resolves params.channel (+ optional params.server) to a server channel or category */
function channelFrom(p: any) {
    const guildId = p.server ? resolveGuild(p.server).id : undefined;

    let channel: Channel;
    try {
        channel = resolveChannel(guildId, p.channel);
    } catch (err) {
        if (!guildId || isSnowflake(String(p.channel ?? ""))) throw err;
        try {
            channel = resolveChannel(guildId, p.channel, CHANNEL_TYPES.category);
        } catch {
            throw err;
        }
    }

    const gid = channel.guild_id ?? guildId;
    if (!gid) throw new Error("That is not a server channel. RenuxBridge only works with server channels, never DMs.");
    return { guildId: gid, channel };
}

const overwritesOf = (c: any): Record<string, any> => c?.permissionOverwrites ?? {};

function apiOverwrites(overwrites: Record<string, any>) {
    return Object.values(overwrites).map((o: any) => ({ id: o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) }));
}

async function waitForGuild(id: string, timeout = 15_000) {
    const start = Date.now();
    while (!GuildStore.getGuild(id)) {
        if (Date.now() - start > timeout) throw new Error("The server was created but never showed up in the client");
        await sleep(150);
    }
}

export const actions: Record<string, Action> = {
    status(_, ctx) {
        const user = me();
        return {
            user: user ? { id: user.id, username: user.username, displayName: user.globalName ?? null } : null,
            servers: GuildStore.getGuildCount(),
            allowed: { changes: ctx.allowWrite, deleting: ctx.allowDestructive, messages: ctx.allowMessages }
        };
    },

    listServers({ query }) {
        let guilds = GuildStore.getGuildsArray();
        if (query) guilds = guilds.filter(g => g.name.toLowerCase().includes(String(query).toLowerCase()));

        return guilds
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(g => ({
                id: g.id,
                name: g.name,
                youOwnIt: g.ownerId === me()?.id,
                members: GuildMemberCountStore.getMemberCount(g.id) ?? null,
                canManage: PermissionStore.can(PermissionsBits.MANAGE_GUILD, g)
            }));
    },

    getServer({ server }) {
        const g = resolveGuild(server);
        const can = (bit: bigint) => PermissionStore.can(bit, g);
        const channels = guildChannels(g.id).filter(c => !Array.isArray(c.permission_overwrites));
        const byPos = (a: any, b: any) => a.position - b.position;

        return {
            id: g.id,
            name: g.name,
            description: g.description ?? null,
            youOwnIt: g.ownerId === me()?.id,
            members: GuildMemberCountStore.getMemberCount(g.id) ?? null,
            features: [...(g.features ?? [])],
            verificationLevel: g.verificationLevel,
            systemChannelId: g.systemChannelId ?? null,
            rulesChannelId: g.rulesChannelId ?? null,
            yourPermissions: {
                administrator: can(PermissionsBits.ADMINISTRATOR),
                manageServer: can(PermissionsBits.MANAGE_GUILD),
                manageChannels: can(PermissionsBits.MANAGE_CHANNELS),
                manageRoles: can(PermissionsBits.MANAGE_ROLES)
            },
            roles: guildRoles(g.id).sort((a, b) => b.position - a.position).map(r => roleInfo(r, g.id)),
            categories: channels
                .filter(c => c.type === CHANNEL_TYPES.category)
                .sort(byPos)
                .map(cat => ({
                    ...channelInfo(cat, g.id),
                    channels: channels.filter(c => c.parent_id === cat.id).sort(byPos).map(c => channelInfo(c, g.id))
                })),
            channels: channels
                .filter(c => c.type !== CHANNEL_TYPES.category && !c.parent_id)
                .sort(byPos)
                .map(c => channelInfo(c, g.id))
        };
    },

    async createServer({ name, icon, layout, open = true }, ctx) {
        needWrite(ctx);
        if (!name || typeof name !== "string") throw new Error("Missing server name");

        let guild: any;
        try {
            guild = await rest("post", "/guilds", stripUndefined({
                name,
                icon,
                channels: [],
                system_channel_id: null,
                guild_template_code: CREATE_MY_OWN_TEMPLATE
            }));
        } catch (err: any) {
            if (!/template/i.test(err.message)) throw err;
            guild = await rest("post", "/guilds", stripUndefined({ name, icon }));
        }

        createdThisSession.add(guild.id);
        ctx.log(`Created server ${guild.name}`);

        let layoutResult: unknown;
        if (layout) {
            await waitForGuild(guild.id);
            layoutResult = await applyLayout(guild.id, layout, {
                wipe: true,
                allowDeletes: true,
                allowMessages: ctx.allowMessages,
                onProgress: ctx.progress
            });
            ctx.log(`Built the layout for ${guild.name}`);
        }

        if (open) {
            await waitForGuild(guild.id).catch(() => { });
            NavigationRouter.transitionToGuild(guild.id);
        }

        return { id: guild.id, name: guild.name, layout: layoutResult };
    },

    async editServer(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);
        const body: Record<string, any> = guildSettingsBody(p);

        const refs = [
            ["system_channel_id", "system_channel"],
            ["rules_channel_id", "rules_channel"],
            ["public_updates_channel_id", "updates_channel"],
            ["afk_channel_id", "afk_channel"]
        ] as const;
        for (const [field, key] of refs) {
            if (p[key] === null || p[key] === "none") body[field] = null;
            else if (p[key]) body[field] = resolveChannel(g.id, p[key], key === "afk_channel" ? CHANNEL_TYPES.voice : undefined).id;
        }

        if (p.community != null) {
            const features = new Set<string>(g.features ?? []);
            if (p.community) {
                body.rules_channel_id ??= g.rulesChannelId;
                body.public_updates_channel_id ??= g.publicUpdatesChannelId;
                if (!body.rules_channel_id || !body.public_updates_channel_id)
                    throw new Error("Community servers need a rules_channel and an updates_channel. Pass both (create them first if needed).");
                body.verification_level ??= Math.max(g.verificationLevel ?? 0, 1);
                body.explicit_content_filter = 2;
                features.add("COMMUNITY");
            } else {
                features.delete("COMMUNITY");
            }
            body.features = [...features];
        }

        if (!Object.keys(body).length) throw new Error("Nothing to change");

        const res = await rest("patch", `/guilds/${g.id}`, body);
        ctx.log(`Updated server ${res?.name ?? g.name}`);
        return { id: g.id, name: res?.name ?? g.name, changed: Object.keys(body) };
    },

    async deleteServer({ server, confirm_name }, ctx) {
        needDestructive(ctx);
        const g = resolveGuild(server);
        if (g.ownerId !== me()?.id) throw new Error("You can only delete servers you own");
        if (confirm_name !== g.name) throw new Error(`confirm_name must be exactly "${g.name}"`);

        await rest("post", `/guilds/${g.id}/delete`, {});
        ctx.log(`Deleted server ${g.name}`);
        return { deleted: g.name };
    },

    async createChannel(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);
        const type = channelType(p.type);
        const parent: any = p.category && type !== CHANNEL_TYPES.category
            ? resolveChannel(g.id, p.category, CHANNEL_TYPES.category)
            : undefined;

        let overwrites: unknown;
        if (p.permissions?.length) {
            const own = buildOverwrites(g.id, p.permissions);
            const merged = new Map(apiOverwrites(overwritesOf(parent)).map(o => [o.id, o]));
            for (const o of own) merged.set(o.id, o);
            overwrites = [...merged.values()];
        } else if (parent) {
            overwrites = apiOverwrites(overwritesOf(parent));
        }

        const c = await rest("post", `/guilds/${g.id}/channels`, stripUndefined({
            name: p.name,
            type,
            topic: p.topic,
            nsfw: p.nsfw,
            rate_limit_per_user: p.slowmode,
            user_limit: p.user_limit,
            bitrate: p.bitrate,
            position: p.position,
            parent_id: parent?.id,
            permission_overwrites: overwrites
        }));
        rememberChannel(g.id, c);

        ctx.log(type === CHANNEL_TYPES.category ? `Created category ${c.name}` : `Created #${c.name}`);
        return { id: c.id, name: c.name, type: channelTypeName(c.type), category: parent?.name ?? null };
    },

    async editChannel(p, ctx) {
        needWrite(ctx);
        const { guildId, channel } = channelFrom(p);

        const body: Record<string, any> = stripUndefined({
            name: p.name,
            topic: p.topic,
            nsfw: p.nsfw,
            rate_limit_per_user: p.slowmode,
            user_limit: p.user_limit,
            bitrate: p.bitrate,
            position: p.position
        });

        let parentId: string | null | undefined = channel.parent_id;
        if (p.category === null || p.category === "none") body.parent_id = parentId = null;
        else if (p.category) body.parent_id = parentId = resolveChannel(guildId, p.category, CHANNEL_TYPES.category).id;

        if (p.sync_permissions) {
            if (!parentId) throw new Error("sync_permissions needs the channel to be in a category");
            body.permission_overwrites = apiOverwrites(overwritesOf(resolveChannel(guildId, parentId)));
        }

        if (!Object.keys(body).length) throw new Error("Nothing to change");

        const res = await rest("patch", `/channels/${channel.id}`, body);
        ctx.log(`Updated #${res?.name ?? channel.name}`);
        return { id: channel.id, name: res?.name ?? channel.name, changed: Object.keys(body) };
    },

    async deleteChannel(p, ctx) {
        needDestructive(ctx);
        const { guildId, channel } = channelFrom(p);

        await rest("del", `/channels/${channel.id}`);
        forgetChannel(guildId, channel.id);
        ctx.log(`Deleted #${channel.name}`);
        return { deleted: channel.name };
    },

    async createRole(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);

        const r = await rest("post", `/guilds/${g.id}/roles`, stripUndefined({
            name: p.name,
            color: parseColor(p.color),
            hoist: p.hoist,
            mentionable: p.mentionable,
            permissions: p.permissions != null ? toBits(p.permissions).toString() : undefined
        }));
        rememberRole(g.id, r);

        ctx.log(`Created role @${r.name}`);
        return roleInfo(r, g.id);
    },

    async editRole(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);
        const role = resolveRole(g.id, p.role);

        let perms: bigint | undefined;
        if (p.permissions != null) perms = toBits(p.permissions);
        if (p.add_permissions || p.remove_permissions)
            perms = ((perms ?? BigInt(role.permissions ?? 0)) | toBits(p.add_permissions)) & ~toBits(p.remove_permissions);

        const body = stripUndefined({
            name: role.id === g.id ? undefined : p.name,
            color: role.id === g.id ? undefined : parseColor(p.color),
            hoist: role.id === g.id ? undefined : p.hoist,
            mentionable: role.id === g.id ? undefined : p.mentionable,
            permissions: perms?.toString()
        });
        if (!Object.keys(body).length) throw new Error("Nothing to change");

        const r = await rest("patch", `/guilds/${g.id}/roles/${role.id}`, body);
        ctx.log(`Updated role ${role.id === g.id ? "@everyone" : "@" + (r?.name ?? role.name)}`);
        return roleInfo(r ?? role, g.id);
    },

    async deleteRole(p, ctx) {
        needDestructive(ctx);
        const g = resolveGuild(p.server);
        const role = resolveRole(g.id, p.role);
        if (role.id === g.id) throw new Error("@everyone can't be deleted");

        await rest("del", `/guilds/${g.id}/roles/${role.id}`);
        ctx.log(`Deleted role @${role.name}`);
        return { deleted: role.name };
    },

    async reorderRoles(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);
        if (!Array.isArray(p.roles) || !p.roles.length) throw new Error("roles must be a list, highest first");

        const ids = p.roles.map((r: unknown) => resolveRole(g.id, r).id);
        await reorderRoles(g.id, ids);

        ctx.log(`Reordered roles in ${g.name}`);
        const names = new Map(guildRoles(g.id).map(r => [r.id, r.name]));
        return { order: ids.map((id: string) => names.get(id) ?? id) };
    },

    async setPermissions(p, ctx) {
        needWrite(ctx);
        const { guildId, channel } = channelFrom(p);
        const { id, type } = overwriteTarget(guildId, { target: p.target, type: p.target_type });

        const existing = overwritesOf(channel)[id];
        const allow = toBits(p.allow);
        const deny = toBits(p.deny);
        const neutral = toBits(p.neutral);

        let newAllow = allow;
        let newDeny = deny;
        if (existing && p.mode !== "replace") {
            newAllow = (BigInt(existing.allow) & ~deny & ~neutral) | allow;
            newDeny = (BigInt(existing.deny) & ~allow & ~neutral) | deny;
        }

        const target = describeOverwriteTarget(guildId, id, type);
        if (!newAllow && !newDeny) {
            if (existing) await rest("del", `/channels/${channel.id}/permissions/${id}`);
            ctx.log(`Cleared ${target}'s overrides in #${channel.name}`);
            return { channel: channel.name, target, cleared: true };
        }

        await rest("put", `/channels/${channel.id}/permissions/${id}`, { type, allow: newAllow.toString(), deny: newDeny.toString() });
        ctx.log(`Set ${target}'s permissions in #${channel.name}`);
        return { channel: channel.name, target, allow: fromBits(newAllow), deny: fromBits(newDeny) };
    },

    async clearPermissions(p, ctx) {
        needWrite(ctx);
        const { guildId, channel } = channelFrom(p);
        const { id, type } = overwriteTarget(guildId, { target: p.target, type: p.target_type });

        await rest("del", `/channels/${channel.id}/permissions/${id}`);
        const target = describeOverwriteTarget(guildId, id, type);
        ctx.log(`Cleared ${target}'s overrides in #${channel.name}`);
        return { channel: channel.name, target, cleared: true };
    },

    async addRole(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);
        const userId = resolveMember(g.id, p.user);
        const role = resolveRole(g.id, p.role);

        await rest("put", `/guilds/${g.id}/members/${userId}/roles/${role.id}`);
        const name = UserStore.getUser(userId)?.username ?? userId;
        ctx.log(`Gave @${role.name} to ${name}`);
        return { user: name, role: role.name };
    },

    async removeRole(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);
        const userId = resolveMember(g.id, p.user);
        const role = resolveRole(g.id, p.role);

        await rest("del", `/guilds/${g.id}/members/${userId}/roles/${role.id}`);
        const name = UserStore.getUser(userId)?.username ?? userId;
        ctx.log(`Took @${role.name} from ${name}`);
        return { user: name, role: role.name };
    },

    listMembers({ server, query, limit }) {
        const g = resolveGuild(server);
        const roleNames = new Map(guildRoles(g.id).map(r => [r.id, r.name]));

        let members = GuildMemberStore.getMemberIds(g.id).map(id => {
            const user = UserStore.getUser(id);
            const member = GuildMemberStore.getMember(g.id, id);
            return {
                id,
                username: user?.username ?? null,
                displayName: user?.globalName ?? null,
                nick: member?.nick ?? null,
                bot: !!user?.bot,
                roles: (member?.roles ?? []).map(r => roleNames.get(r) ?? r)
            };
        });

        if (query) {
            const q = String(query).toLowerCase();
            members = members.filter(m => [m.username, m.displayName, m.nick].some(n => n?.toLowerCase().includes(q)));
        }

        return {
            note: "Only members the client has cached are listed",
            cached: members.length,
            total: GuildMemberCountStore.getMemberCount(g.id) ?? null,
            members: members.slice(0, clamp(limit, 1, 500, 50))
        };
    },

    async createInvite(p, ctx) {
        needWrite(ctx);
        const { channel } = channelFrom(p);

        const inv = await rest("post", `/channels/${channel.id}/invites`, {
            max_age: clamp(p.max_age, 0, 604_800, 604_800),
            max_uses: clamp(p.max_uses, 0, 100, 0),
            temporary: !!p.temporary,
            unique: true
        });

        ctx.log(`Created invite discord.gg/${inv.code}`);
        return { code: inv.code, url: `https://discord.gg/${inv.code}`, expiresInSeconds: inv.max_age || null, maxUses: inv.max_uses || null };
    },

    async sendMessage(p, ctx) {
        needMessages(ctx);
        const { channel } = channelFrom(p);
        if (!p.content || !String(p.content).trim()) throw new Error("content is empty");

        const sent = await postMessage(channel.id, String(p.content));
        ctx.log(`Sent a message in #${channel.name}`);
        return { channel: channel.name, messageIds: sent.map(m => m?.id) };
    },

    async readMessages(p, ctx) {
        needMessages(ctx);
        const { channel } = channelFrom(p);

        const msgs: any[] = await rest("get", `/channels/${channel.id}/messages`, undefined, { limit: clamp(p.limit, 1, 100, 25) });
        return (msgs ?? []).reverse().map(m => stripUndefined({
            id: m.id,
            author: m.author?.global_name ?? m.author?.username,
            authorId: m.author?.id,
            bot: m.author?.bot || undefined,
            content: m.content,
            timestamp: m.timestamp,
            attachments: m.attachments?.length ? m.attachments.map((a: any) => a.url) : undefined,
            embeds: m.embeds?.length || undefined,
            replyTo: m.message_reference?.message_id
        }));
    },

    async createWebhook(p, ctx) {
        needWrite(ctx);
        const { channel } = channelFrom(p);

        const w = await rest("post", `/channels/${channel.id}/webhooks`, { name: p.name || "Renuxcord" });
        ctx.log(`Created webhook ${w.name} in #${channel.name}`);
        return { id: w.id, name: w.name, url: `https://discord.com/api/webhooks/${w.id}/${w.token}` };
    },

    async createEmoji(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);
        if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(p.image ?? "")) throw new Error("image must be a base64 data URI (png, jpeg, gif or webp)");

        const e = await rest("post", `/guilds/${g.id}/emojis`, { name: p.name, image: p.image, roles: [] });
        ctx.log(`Added emoji :${e.name}:`);
        return { id: e.id, name: e.name, animated: !!e.animated };
    },

    async applyLayout(p, ctx) {
        needWrite(ctx);
        const g = resolveGuild(p.server);
        const fresh = createdThisSession.has(g.id);
        if (p.wipe && !ctx.allowDestructive && !fresh)
            throw new Error('wipe deletes the existing channels and roles, so it needs "Allow deleting" on in the RenuxBridge settings');

        const result = await applyLayout(g.id, p.layout, {
            wipe: !!p.wipe,
            allowDeletes: ctx.allowDestructive || fresh,
            allowMessages: ctx.allowMessages,
            onProgress: ctx.progress
        });
        ctx.log(`Applied a layout to ${g.name}`);
        return result;
    },

    exportLayout({ server }) {
        return exportLayout(resolveGuild(server).id);
    },

    listPermissions() {
        return permissionNames();
    },

    open(p) {
        if (p.channel) {
            const { guildId, channel } = channelFrom(p);
            NavigationRouter.transitionTo(`/channels/${guildId}/${channel.id}`);
            return { opened: `#${channel.name}` };
        }
        const g = resolveGuild(p.server);
        NavigationRouter.transitionToGuild(g.id);
        return { opened: g.name };
    }
};
