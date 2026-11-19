/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildRoleStore, GuildStore, SnowflakeUtils } from "@webpack/common";

import {
    CHANNEL_TYPES, channelType, ChannelTypeName, channelTypeName, describeOverwriteTarget, forgetChannel, fromBits,
    guildChannels, guildRoles, isSnowflake, parseColor, rememberChannel, rememberRole, resolveChannel, resolveMember,
    resolveRole, rest, toBits, toHex
} from "./discord";

export interface LayoutOverwrite {
    /** Role name, "@everyone", role ID or user ID */
    target: string;
    type?: "role" | "member";
    allow?: string[];
    deny?: string[];
}

export interface LayoutChannel {
    name: string;
    type?: ChannelTypeName;
    topic?: string;
    nsfw?: boolean;
    slowmode?: number;
    user_limit?: number;
    bitrate?: number;
    /** Merged on top of the category's permissions */
    permissions?: LayoutOverwrite[];
    /** Messages to post once the channel exists */
    messages?: string[];
}

export interface LayoutCategory {
    name: string;
    permissions?: LayoutOverwrite[];
    channels?: LayoutChannel[];
}

export interface LayoutRole {
    name: string;
    color?: string | number;
    hoist?: boolean;
    mentionable?: boolean;
    permissions?: string[];
}

export interface ServerLayout {
    name?: string;
    description?: string;
    verification_level?: string | number;
    default_notifications?: string | number;
    explicit_content_filter?: string | number;
    afk_timeout?: number;
    everyone?: { permissions?: string[]; };
    /** Highest role first */
    roles?: LayoutRole[];
    categories?: LayoutCategory[];
    /** Channels that sit outside any category */
    channels?: LayoutChannel[];
    system_channel?: string;
    rules_channel?: string;
    afk_channel?: string;
}

export interface ApplyOptions {
    wipe?: boolean;
    allowDeletes: boolean;
    allowMessages: boolean;
    onProgress?(text: string): void;
}

const VERIFICATION: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, highest: 4, very_high: 4 };
const NOTIFICATIONS: Record<string, number> = { all: 0, all_messages: 0, mentions: 1, only_mentions: 1 };
const CONTENT_FILTER: Record<string, number> = { disabled: 0, off: 0, members_without_roles: 1, no_roles: 1, all: 2, all_members: 2 };

function enumValue(table: Record<string, number>, value: unknown, what: string) {
    if (value == null || value === "") return undefined;
    if (typeof value === "number") return value;
    const v = table[String(value).trim().toLowerCase().replace(/[\s-]+/g, "_")];
    if (v == null) throw new Error(`Unknown ${what} "${value}". Use one of: ${Object.keys(table).join(", ")}`);
    return v;
}

const enumName = (table: Record<string, number>, value: number) => Object.entries(table).find(([, v]) => v === value)?.[0];

export function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Turns friendly guild settings into a PATCH /guilds body */
export function guildSettingsBody(input: Record<string, any>) {
    return stripUndefined({
        name: input.name,
        description: input.description,
        icon: input.icon,
        verification_level: enumValue(VERIFICATION, input.verification_level, "verification level"),
        default_message_notifications: enumValue(NOTIFICATIONS, input.default_notifications, "notification setting"),
        explicit_content_filter: enumValue(CONTENT_FILTER, input.explicit_content_filter, "content filter"),
        afk_timeout: input.afk_timeout
    });
}

const lowerName = (s: string) => String(s).trim().toLowerCase().replace(/^@/, "");
const normaliseChannelName = (name: string, type: number) =>
    type === CHANNEL_TYPES.voice || type === CHANNEL_TYPES.stage || type === CHANNEL_TYPES.category
        ? name.trim().toLowerCase()
        : name.trim().toLowerCase().replace(/\s+/g, "-");

export function overwriteTarget(guildId: string, spec: Omit<LayoutOverwrite, "allow" | "deny">, roleIds?: Map<string, string>) {
    const target = String(spec.target ?? "").trim();
    if (!target) throw new Error("A permission overwrite is missing its target");

    if (spec.type === "member") return { id: resolveMember(guildId, target), type: 1 };

    const fromLayout = roleIds?.get(lowerName(target));
    if (fromLayout) return { id: fromLayout, type: 0 };

    try {
        return { id: resolveRole(guildId, target).id, type: 0 };
    } catch (err) {
        if (spec.type !== "role" && isSnowflake(target)) return { id: target, type: 1 };
        throw err;
    }
}

/** Resolves layout overwrites into API permission_overwrites, dropping empty ones */
export function buildOverwrites(guildId: string, specs: LayoutOverwrite[] | undefined, roleIds?: Map<string, string>) {
    return (specs ?? []).flatMap(spec => {
        const { id, type } = overwriteTarget(guildId, spec, roleIds);
        const allow = toBits(spec.allow);
        const deny = toBits(spec.deny);
        if (!allow && !deny) return [];
        return [{ id, type, allow: allow.toString(), deny: deny.toString() }];
    });
}

export function mergeOverwriteSpecs(base?: LayoutOverwrite[], extra?: LayoutOverwrite[]) {
    if (!extra?.length) return base ?? [];
    if (!base?.length) return extra;
    const key = (o: LayoutOverwrite) => `${o.type === "member" ? "m" : "r"}:${lowerName(o.target)}`;
    const merged = new Map(base.map(o => [key(o), o]));
    for (const o of extra) merged.set(key(o), o);
    return [...merged.values()];
}

/** Splits long text into Discord-sized chunks, preferring line breaks */
export function chunkMessage(content: string, size = 2000) {
    const chunks: string[] = [];
    let rest_ = content;
    while (rest_.length > size) {
        let cut = rest_.lastIndexOf("\n", size);
        if (cut < size / 2) cut = size;
        chunks.push(rest_.slice(0, cut));
        rest_ = rest_.slice(cut).replace(/^\n/, "");
    }
    if (rest_.trim()) chunks.push(rest_);
    return chunks;
}

export async function postMessage(channelId: string, content: string) {
    const sent: any[] = [];
    for (const chunk of chunkMessage(content)) {
        sent.push(await rest("post", `/channels/${channelId}/messages`, {
            content: chunk,
            nonce: SnowflakeUtils.fromTimestamp(Date.now()),
            tts: false,
            flags: 0
        }));
    }
    return sent;
}

/** Reorders roles so the given IDs come out in that order (highest first). Bot roles stay above them */
export async function reorderRoles(guildId: string, topToBottom: string[], ignore = new Set<string>()) {
    const current = guildRoles(guildId)
        .filter(r => r.id !== guildId && !ignore.has(r.id))
        .sort((a, b) => b.position - a.position);

    const listed = new Set(topToBottom);
    const managed = current.filter(r => r.managed && !listed.has(r.id)).map(r => r.id);
    const others = current.filter(r => !r.managed && !listed.has(r.id)).map(r => r.id);
    const order = [...managed, ...topToBottom, ...others];

    await rest("patch", `/guilds/${guildId}/roles`, order.map((id, i) => ({ id, position: order.length - i })));
}

function validateLayout(layout: ServerLayout) {
    if (!layout || typeof layout !== "object" || Array.isArray(layout)) throw new Error("layout must be an object");

    const checkChannels = (list: unknown, where: string) => {
        if (list == null) return;
        if (!Array.isArray(list)) throw new Error(`${where} must be an array`);
        list.forEach((c: any, i) => {
            if (!c?.name || typeof c.name !== "string") throw new Error(`${where}[${i}] needs a name`);
            channelType(c.type);
            if (c.messages != null && !Array.isArray(c.messages)) throw new Error(`${where}[${i}].messages must be an array of strings`);
        });
    };

    if (layout.roles != null) {
        if (!Array.isArray(layout.roles)) throw new Error("roles must be an array");
        layout.roles.forEach((r, i) => {
            if (!r?.name) throw new Error(`roles[${i}] needs a name`);
            parseColor(r.color);
            toBits(r.permissions);
        });
    }
    if (layout.categories != null) {
        if (!Array.isArray(layout.categories)) throw new Error("categories must be an array");
        layout.categories.forEach((c, i) => {
            if (!c?.name) throw new Error(`categories[${i}] needs a name`);
            checkChannels(c.channels, `categories[${i}].channels`);
        });
    }
    checkChannels(layout.channels, "channels");
    toBits(layout.everyone?.permissions);
    guildSettingsBody(layout);
}

export async function applyLayout(guildId: string, layout: ServerLayout, opts: ApplyOptions) {
    validateLayout(layout);

    const guild = GuildStore.getGuild(guildId);
    if (!guild) throw new Error("Unknown server");

    const progress = (text: string) => opts.onProgress?.(text);
    const summary = {
        created: { roles: [] as string[], categories: [] as string[], channels: [] as string[] },
        updated: [] as string[],
        deleted: [] as string[],
        messagesPosted: 0,
        warnings: [] as string[],
        roleIds: {} as Record<string, string>,
        channelIds: {} as Record<string, string>
    };
    const warn = (text: string) => summary.warnings.push(text);

    const deletedRoles = new Set<string>();
    const deletedChannels = new Set<string>();

    if (opts.wipe) {
        if (!opts.allowDeletes) throw new Error('wipe needs "Allow deleting" switched on in the RenuxBridge settings');
        progress("Clearing old channels");

        const keep = new Set([guild.rulesChannelId, guild.publicUpdatesChannelId].filter(Boolean));
        const existing = guildChannels(guildId);
        for (const c of [...existing.filter(c => c.type !== CHANNEL_TYPES.category), ...existing.filter(c => c.type === CHANNEL_TYPES.category)]) {
            if (keep.has(c.id)) {
                warn(`Kept #${c.name}: community servers need their rules and updates channels`);
                continue;
            }
            try {
                await rest("del", `/channels/${c.id}`);
                deletedChannels.add(c.id);
                forgetChannel(guildId, c.id);
                summary.deleted.push(`#${c.name}`);
            } catch (err: any) {
                warn(`Couldn't delete #${c.name}: ${err.message}`);
            }
        }

        if (layout.roles) {
            progress("Clearing old roles");
            for (const r of guildRoles(guildId)) {
                if (r.id === guildId || r.managed) continue;
                try {
                    await rest("del", `/guilds/${guildId}/roles/${r.id}`);
                    deletedRoles.add(r.id);
                    summary.deleted.push(`@${r.name}`);
                } catch (err: any) {
                    warn(`Couldn't delete @${r.name}: ${err.message}`);
                }
            }
        }
    }

    const settingsBody = guildSettingsBody(layout);
    if (Object.keys(settingsBody).length) {
        progress("Updating server settings");
        await rest("patch", `/guilds/${guildId}`, settingsBody);
        summary.updated.push("server settings");
    }

    if (layout.everyone?.permissions) {
        await rest("patch", `/guilds/${guildId}/roles/${guildId}`, { permissions: toBits(layout.everyone.permissions).toString() });
        summary.updated.push("@everyone permissions");
    }

    // Roles
    const roleIds = new Map<string, string>();
    for (const role of layout.roles ?? []) {
        progress(`Role @${role.name}`);
        const body = stripUndefined({
            name: role.name,
            color: parseColor(role.color),
            hoist: role.hoist,
            mentionable: role.mentionable,
            permissions: role.permissions ? toBits(role.permissions).toString() : undefined
        });

        const existing = opts.wipe ? undefined : guildRoles(guildId)
            .find(r => r.id !== guildId && !deletedRoles.has(r.id) && r.name.toLowerCase() === role.name.toLowerCase());

        try {
            if (existing?.managed) {
                warn(`@${role.name} is managed by an integration, left it alone`);
                roleIds.set(lowerName(role.name), existing.id);
            } else if (existing) {
                await rest("patch", `/guilds/${guildId}/roles/${existing.id}`, body);
                roleIds.set(lowerName(role.name), existing.id);
                summary.updated.push(`@${role.name}`);
            } else {
                const created = await rest("post", `/guilds/${guildId}/roles`, body);
                rememberRole(guildId, created);
                roleIds.set(lowerName(role.name), created.id);
                summary.created.roles.push(role.name);
            }
        } catch (err: any) {
            warn(`Role @${role.name}: ${err.message}`);
        }
    }

    if ((layout.roles?.length ?? 0) > 1) {
        const order = layout.roles!.map(r => roleIds.get(lowerName(r.name))).filter((id): id is string => !!id);
        try {
            await reorderRoles(guildId, order, deletedRoles);
        } catch (err: any) {
            warn(`Couldn't reorder roles: ${err.message}`);
        }
    }

    // Channels
    const channelIds = new Map<string, string>();
    const positions: { id: string; position: number; parent_id?: string | null; }[] = [];

    const findExisting = (name: string, type: number, parentId: string | null) => {
        if (opts.wipe) return undefined;
        const wanted = normaliseChannelName(name, type);
        const candidates = guildChannels(guildId)
            .filter(c => !deletedChannels.has(c.id) && c.type === type && normaliseChannelName(c.name, type) === wanted);
        return candidates.find(c => (c.parent_id ?? null) === parentId) ?? candidates[0];
    };

    const upsertChannel = async (ch: LayoutChannel, parentId: string | null, parentPerms?: LayoutOverwrite[]) => {
        const type = channelType(ch.type);
        progress(`${type === CHANNEL_TYPES.voice ? "Voice" : "Channel"} ${ch.name}`);

        const hasPerms = !!(ch.permissions?.length || parentPerms?.length);
        const body = stripUndefined({
            name: ch.name,
            type,
            topic: ch.topic,
            nsfw: ch.nsfw,
            rate_limit_per_user: ch.slowmode,
            user_limit: ch.user_limit,
            bitrate: ch.bitrate,
            parent_id: parentId ?? undefined,
            permission_overwrites: hasPerms ? buildOverwrites(guildId, mergeOverwriteSpecs(parentPerms, ch.permissions), roleIds) : undefined
        });

        const existing = findExisting(ch.name, type, parentId);
        let channel: any;
        if (existing) {
            const { type: _, ...patch } = body;
            channel = await rest("patch", `/channels/${existing.id}`, { ...patch, parent_id: parentId });
            summary.updated.push(`#${channel.name}`);
        } else {
            channel = await rest("post", `/guilds/${guildId}/channels`, body);
            rememberChannel(guildId, channel);
            summary.created.channels.push(channel.name);
        }

        channelIds.set(normaliseChannelName(ch.name, type), channel.id);
        channelIds.set(channel.name.toLowerCase(), channel.id);

        for (const msg of ch.messages ?? []) {
            if (!opts.allowMessages) {
                warn(`Skipped messages for #${channel.name}: "Allow messages" is off in the RenuxBridge settings`);
                break;
            }
            await postMessage(channel.id, String(msg));
            summary.messagesPosted++;
        }

        return channel.id as string;
    };

    let topPos = 0;
    for (const ch of layout.channels ?? []) {
        try {
            positions.push({ id: await upsertChannel(ch, null), position: topPos++, parent_id: null });
        } catch (err: any) {
            warn(`Channel ${ch.name}: ${err.message}`);
        }
    }

    let catPos = 0;
    for (const cat of layout.categories ?? []) {
        progress(`Category ${cat.name}`);
        let catId: string;
        try {
            const overwrites = cat.permissions ? buildOverwrites(guildId, cat.permissions, roleIds) : undefined;
            const existing = findExisting(cat.name, CHANNEL_TYPES.category, null);
            if (existing) {
                if (overwrites) await rest("patch", `/channels/${existing.id}`, { permission_overwrites: overwrites });
                catId = existing.id;
                summary.updated.push(`category ${cat.name}`);
            } else {
                const created = await rest("post", `/guilds/${guildId}/channels`, stripUndefined({ name: cat.name, type: CHANNEL_TYPES.category, permission_overwrites: overwrites }));
                rememberChannel(guildId, created);
                catId = created.id;
                summary.created.categories.push(cat.name);
            }
            channelIds.set(normaliseChannelName(cat.name, CHANNEL_TYPES.category), catId);
            positions.push({ id: catId, position: catPos++ });
        } catch (err: any) {
            warn(`Category ${cat.name}: ${err.message}`);
            continue;
        }

        let pos = 0;
        for (const ch of cat.channels ?? []) {
            try {
                positions.push({ id: await upsertChannel(ch, catId, cat.permissions), position: pos++, parent_id: catId });
            } catch (err: any) {
                warn(`Channel ${ch.name}: ${err.message}`);
            }
        }
    }

    if (positions.length > 1) {
        progress("Ordering channels");
        try {
            await rest("patch", `/guilds/${guildId}/channels`, positions);
        } catch (err: any) {
            warn(`Couldn't reorder channels: ${err.message}`);
        }
    }

    // Channel references in the guild settings, now that the channels exist
    const refBody: Record<string, string> = {};
    const refs = { system_channel_id: layout.system_channel, rules_channel_id: layout.rules_channel, afk_channel_id: layout.afk_channel };
    for (const [field, ref] of Object.entries(refs)) {
        if (!ref) continue;
        const id = channelIds.get(String(ref).trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
            ?? channelIds.get(String(ref).trim().toLowerCase().replace(/^#/, ""));
        try {
            refBody[field] = id ?? resolveChannel(guildId, ref).id;
        } catch (err: any) {
            warn(`${field.replace(/_id$/, "")}: ${err.message}`);
        }
    }
    if (Object.keys(refBody).length) {
        try {
            await rest("patch", `/guilds/${guildId}`, refBody);
            summary.updated.push("system/rules/afk channels");
        } catch (err: any) {
            warn(`Couldn't set system/rules/afk channels: ${err.message}`);
        }
    }

    summary.roleIds = Object.fromEntries(roleIds);
    summary.channelIds = Object.fromEntries(channelIds);
    return summary;
}

function overwriteSpecs(guildId: string, overwrites: Record<string, any> | undefined): LayoutOverwrite[] {
    return Object.values(overwrites ?? {}).map(o => stripUndefined({
        target: describeOverwriteTarget(guildId, o.id, o.type),
        type: o.type === 1 ? "member" as const : undefined,
        allow: fromBits(o.allow).length ? fromBits(o.allow) : undefined,
        deny: fromBits(o.deny).length ? fromBits(o.deny) : undefined
    }) as LayoutOverwrite);
}

// Only what differs from the category, so applying it (which merges) gives the same result
function channelOnlyOverwrites(guildId: string, channel: any, parent: any): LayoutOverwrite[] | undefined {
    const own: Record<string, any> = channel.permissionOverwrites ?? {};
    const inherited: Record<string, any> = parent?.permissionOverwrites ?? {};

    const ids = new Set([...Object.keys(own), ...Object.keys(inherited)]);
    const diff: Record<string, any> = {};
    for (const id of ids) {
        const a = own[id];
        const b = inherited[id];
        if (a && b && a.allow === b.allow && a.deny === b.deny) continue;
        diff[id] = a ?? { id, type: b.type, allow: 0n, deny: 0n };
    }

    const specs = Object.values(diff).map(o => ({
        target: describeOverwriteTarget(guildId, o.id, o.type),
        ...(o.type === 1 ? { type: "member" as const } : {}),
        allow: fromBits(o.allow),
        deny: fromBits(o.deny)
    }));
    return specs.length ? specs : undefined;
}

export function exportLayout(guildId: string): ServerLayout {
    const guild = GuildStore.getGuild(guildId);
    if (!guild) throw new Error("Unknown server");

    const sortChannels = (a: any, b: any) => (a.position - b.position) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
    // Raw REST objects (snake_case) are only kept for name lookups; export reads the client's channel records
    const all = guildChannels(guildId).filter(c => !Array.isArray(c.permission_overwrites));
    const byId = new Map(all.map(c => [c.id, c]));
    const ownOverwrites = (c: any) => {
        const specs = overwriteSpecs(guildId, c.permissionOverwrites);
        return specs.length ? specs : undefined;
    };

    const toChannel = (c: any): LayoutChannel => {
        const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
        return stripUndefined({
            name: c.name,
            type: channelTypeName(c.type) as ChannelTypeName,
            topic: c.topic || undefined,
            nsfw: c.nsfw || undefined,
            slowmode: c.rateLimitPerUser || undefined,
            user_limit: c.userLimit || undefined,
            bitrate: c.type === CHANNEL_TYPES.voice && c.bitrate && c.bitrate !== 64000 ? c.bitrate : undefined,
            permissions: parent ? channelOnlyOverwrites(guildId, c, parent) : ownOverwrites(c)
        }) as LayoutChannel;
    };

    const categories = all.filter(c => c.type === CHANNEL_TYPES.category).sort(sortChannels);
    const children = (parentId: string | null) => all
        .filter(c => c.type !== CHANNEL_TYPES.category && (c.parent_id ?? null) === parentId)
        .sort((a, b) => {
            const voiceA = a.type === CHANNEL_TYPES.voice || a.type === CHANNEL_TYPES.stage ? 1 : 0;
            const voiceB = b.type === CHANNEL_TYPES.voice || b.type === CHANNEL_TYPES.stage ? 1 : 0;
            return (voiceA - voiceB) || sortChannels(a, b);
        });

    const roles = guildRoles(guildId)
        .filter(r => r.id !== guildId && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map(r => stripUndefined({
            name: r.name,
            color: toHex(r.color),
            hoist: r.hoist || undefined,
            mentionable: r.mentionable || undefined,
            permissions: fromBits(r.permissions)
        }) as LayoutRole);

    const everyone = GuildRoleStore.getRole(guildId, guildId);
    const channelName = (id?: string) => id ? byId.get(id)?.name : undefined;
    const uncategorised = children(null);

    return stripUndefined({
        name: guild.name,
        description: guild.description || undefined,
        verification_level: enumName(VERIFICATION, guild.verificationLevel),
        default_notifications: enumName(NOTIFICATIONS, guild.defaultMessageNotifications),
        explicit_content_filter: enumName(CONTENT_FILTER, guild.explicitContentFilter),
        afk_timeout: guild.afkChannelId ? guild.afkTimeout : undefined,
        everyone: everyone ? { permissions: fromBits(everyone.permissions) } : undefined,
        roles,
        categories: categories.map(cat => stripUndefined({
            name: cat.name,
            permissions: ownOverwrites(cat),
            channels: children(cat.id).map(toChannel)
        }) as LayoutCategory),
        channels: uncategorised.length ? uncategorised.map(toChannel) : undefined,
        system_channel: channelName(guild.systemChannelId),
        rules_channel: channelName(guild.rulesChannelId),
        afk_channel: channelName(guild.afkChannelId)
    }) as ServerLayout;
}
