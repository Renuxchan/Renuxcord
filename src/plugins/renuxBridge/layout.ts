/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildRoleStore, GuildStore, SnowflakeUtils } from "@webpack/common";

import {
    CHANNEL_TYPES, channelKind, channelType, ChannelTypeName, channelTypeName, describeOverwriteTarget, forgetChannel,
    fromBits, guildChannels, guildRoles, isCreatableType, isSnowflake, parseColor, rememberChannel, rememberRole,
    resolveChannel, resolveMember, resolveRole, rest, toBits, toHex
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
    /** What an export had to leave out. Only for reading: applying shows these as warnings */
    skipped?: string[];
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

export function enumValue(table: Record<string, number>, value: unknown, what: string) {
    if (value == null || value === "") return undefined;
    if (typeof value === "number") return value;
    const v = table[String(value).trim().toLowerCase().replace(/[\s-]+/g, "_")];
    if (v == null) throw new Error(`Unknown ${what} "${value}". Use one of: ${Object.keys(table).join(", ")}`);
    return v;
}

export const enumName = (table: Record<string, number>, value: number) => Object.entries(table).find(([, v]) => v === value)?.[0];

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
    // @everyone's ID is the server's, so it works before the role store knows a new server
    if (/^@everyone$/i.test(target)) return { id: guildId, type: 0 };

    const fromLayout = roleIds?.get(lowerName(target));
    if (fromLayout) return { id: fromLayout, type: 0 };

    try {
        return { id: resolveRole(guildId, target).id, type: 0 };
    } catch (err) {
        if (spec.type !== "role" && isSnowflake(target)) return { id: target, type: 1 };
        throw err;
    }
}

/**
 * Resolves layout overwrites into API permission_overwrites, dropping empty ones.
 * With warn, a target that doesn't exist here (a bot's role, someone who isn't a member) is left out instead of failing
 */
export function buildOverwrites(guildId: string, specs: LayoutOverwrite[] | undefined, roleIds?: Map<string, string>, warn?: (text: string) => void) {
    return (specs ?? []).flatMap(spec => {
        let target: { id: string; type: number; };
        try {
            target = overwriteTarget(guildId, spec, roleIds);
        } catch (err: any) {
            if (!warn) throw err;
            warn(`Left out the permissions for ${spec.target}: ${err.message}`);
            return [];
        }
        const { id, type } = target;
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

// Kinds Discord only makes in some servers (announcement and stage need Community), so a copy falls back to the nearest one
const FALLBACK_TYPES: Partial<Record<number, number>> = {
    [CHANNEL_TYPES.announcement]: CHANNEL_TYPES.text,
    [CHANNEL_TYPES.stage]: CHANNEL_TYPES.voice,
    [CHANNEL_TYPES.media]: CHANNEL_TYPES.forum,
    [CHANNEL_TYPES.forum]: CHANNEL_TYPES.text
};

// Highest voice bitrate for each boost level
const MAX_BITRATE = [96000, 128000, 256000, 384000];

const isVoiceType = (type: number) => type === CHANNEL_TYPES.voice || type === CHANNEL_TYPES.stage;

const aKind = (type: number) => {
    const kind = channelKind(type);
    return `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;
};

/** Only the fields Discord takes for that kind of channel, within its limits */
function channelBody(ch: LayoutChannel, type: number, maxBitrate: number) {
    const voice = isVoiceType(type);
    const threadsOnly = type === CHANNEL_TYPES.forum || type === CHANNEL_TYPES.media;
    return stripUndefined({
        name: ch.name,
        type,
        topic: voice ? undefined : ch.topic?.slice(0, threadsOnly ? 4096 : 1024),
        nsfw: ch.nsfw,
        rate_limit_per_user: ch.slowmode,
        user_limit: voice && ch.user_limit != null ? Math.min(ch.user_limit, type === CHANNEL_TYPES.stage ? 10000 : 99) : undefined,
        bitrate: voice && ch.bitrate != null ? Math.min(Math.max(ch.bitrate, 8000), maxBitrate) : undefined
    });
}

/** For building a server that was just made: its own name stays, and nobody else is a member yet */
export function layoutForNewServer(layout: ServerLayout) {
    let removed = 0;
    const roleOnly = (perms?: LayoutOverwrite[]) => {
        if (!perms) return perms;
        const kept = perms.filter(o => o.type !== "member");
        removed += perms.length - kept.length;
        return kept.length ? kept : undefined;
    };
    const channels = (list?: LayoutChannel[]) => list?.map(c => stripUndefined({ ...c, permissions: roleOnly(c.permissions) }) as LayoutChannel);

    const result = stripUndefined({
        ...layout,
        name: undefined,
        categories: layout.categories?.map(cat => stripUndefined({ ...cat, permissions: roleOnly(cat.permissions), channels: channels(cat.channels) }) as LayoutCategory),
        channels: channels(layout.channels)
    }) as ServerLayout;

    if (removed) result.skipped = [...result.skipped ?? [], `Left out ${removed} permission ${removed === 1 ? "overwrite" : "overwrites"} for single members, since members aren't copied`];
    return result;
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
    // Each problem once, however many channels run into it
    const warn = (text: string) => {
        if (!summary.warnings.includes(text)) summary.warnings.push(text);
    };
    if (Array.isArray(layout.skipped)) layout.skipped.forEach(note => warn(String(note)));

    const features = new Set<string>(guild.features ?? []);
    const isCommunity = features.has("COMMUNITY");
    const maxBitrate = features.has("VIP_REGIONS") ? 384000 : MAX_BITRATE[guild.premiumTier ?? 0] ?? MAX_BITRATE[0];

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
    if (settingsBody.description && !isCommunity) {
        delete settingsBody.description;
        warn("Left out the server description: only Community servers have one");
    }
    if (Object.keys(settingsBody).length) {
        progress("Updating server settings");
        try {
            await rest("patch", `/guilds/${guildId}`, settingsBody);
            summary.updated.push("server settings");
        } catch (err: any) {
            warn(`Couldn't update the server settings: ${err.message}`);
        }
    }

    if (layout.everyone?.permissions) {
        try {
            await rest("patch", `/guilds/${guildId}/roles/${guildId}`, { permissions: toBits(layout.everyone.permissions).toString() });
            summary.updated.push("@everyone permissions");
        } catch (err: any) {
            warn(`Couldn't set the @everyone permissions: ${err.message}`);
        }
    }

    // Roles
    const roleIds = new Map<string, string>();
    const roleOrder: string[] = [];
    for (const role of layout.roles ?? []) {
        progress(`Role @${role.name}`);
        const body = stripUndefined({
            name: role.name,
            color: parseColor(role.color),
            hoist: role.hoist,
            mentionable: role.mentionable,
            permissions: role.permissions ? toBits(role.permissions).toString() : undefined
        });

        // Two roles can share a name, so each existing role is only matched once
        const existing = opts.wipe ? undefined : guildRoles(guildId)
            .find(r => r.id !== guildId && !deletedRoles.has(r.id) && !roleOrder.includes(r.id) && r.name.toLowerCase() === role.name.toLowerCase());

        try {
            let id: string;
            if (existing?.managed) {
                warn(`@${role.name} is managed by an integration, left it alone`);
                id = existing.id;
            } else if (existing) {
                await rest("patch", `/guilds/${guildId}/roles/${existing.id}`, body);
                id = existing.id;
                summary.updated.push(`@${role.name}`);
            } else {
                const created = await rest("post", `/guilds/${guildId}/roles`, body);
                rememberRole(guildId, created);
                id = created.id;
                summary.created.roles.push(role.name);
            }
            roleOrder.push(id);
            // Overwrites naming a shared name go to the highest of those roles
            if (!roleIds.has(lowerName(role.name))) roleIds.set(lowerName(role.name), id);
        } catch (err: any) {
            warn(`Role @${role.name}: ${err.message}`);
        }
    }

    if (roleOrder.length > 1) {
        try {
            await reorderRoles(guildId, roleOrder, deletedRoles);
        } catch (err: any) {
            warn(`Couldn't reorder roles: ${err.message}`);
        }
    }

    // Channels
    const channelIds = new Map<string, string>();
    const positions: { id: string; position: number; }[] = [];
    // Each existing channel is matched once, so two layout channels with the same name don't both grab it
    const placed = new Set<string>();

    const findExisting = (name: string, type: number, parentId: string | null) => {
        if (opts.wipe) return undefined;
        const wanted = normaliseChannelName(name, type);
        const candidates = guildChannels(guildId)
            .filter(c => !deletedChannels.has(c.id) && !placed.has(c.id) && c.type === type && normaliseChannelName(c.name, type) === wanted);
        return candidates.find(c => (c.parent_id ?? null) === parentId) ?? candidates[0];
    };

    const upsertChannel = async (ch: LayoutChannel, parentId: string | null, parentPerms?: LayoutOverwrite[]) => {
        const type = channelType(ch.type);
        progress(`${type === CHANNEL_TYPES.voice ? "Voice" : "Channel"} ${ch.name}`);
        if (!isCreatableType(type)) throw new Error(`${channelKind(type)} channels can't be copied, so it was skipped`);

        if (isVoiceType(type) && ch.bitrate && ch.bitrate > maxBitrate)
            warn(`${ch.name}: bitrate lowered to ${maxBitrate / 1000}kbps, the most this server's boost level allows`);

        const hasPerms = !!(ch.permissions?.length || parentPerms?.length);
        const extra = stripUndefined({
            parent_id: parentId ?? undefined,
            permission_overwrites: hasPerms ? buildOverwrites(guildId, mergeOverwriteSpecs(parentPerms, ch.permissions), roleIds, warn) : undefined
        });
        const bodyFor = (t: number) => ({ ...channelBody(ch, t, maxBitrate), ...extra });

        const existing = findExisting(ch.name, type, parentId);
        let channel: any;
        if (existing) {
            const { type: _, ...patch } = bodyFor(type);
            channel = await rest("patch", `/channels/${existing.id}`, { ...patch, parent_id: parentId });
            summary.updated.push(`#${channel.name}`);
        } else {
            let firstError: any;
            for (let t: number | undefined = type; t != null && !channel; t = FALLBACK_TYPES[t]) {
                try {
                    channel = await rest("post", `/guilds/${guildId}/channels`, bodyFor(t));
                } catch (err) {
                    firstError ??= err;
                }
            }
            if (!channel) throw firstError;
            if (firstError) {
                const why = !isCommunity && (type === CHANNEL_TYPES.announcement || type === CHANNEL_TYPES.stage)
                    ? `${channelKind(type)} channels need a Community server`
                    : `Discord wouldn't make ${aKind(type)} channel here (${firstError.message})`;
                warn(`${channel.name} became ${aKind(channel.type)} channel: ${why}`);
            }
            rememberChannel(guildId, channel);
            summary.created.channels.push(channel.name);
        }

        placed.add(channel.id);
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
            positions.push({ id: await upsertChannel(ch, null), position: topPos++ });
        } catch (err: any) {
            warn(`Channel ${ch.name}: ${err.message}`);
        }
    }

    let catPos = 0;
    for (const cat of layout.categories ?? []) {
        progress(`Category ${cat.name}`);
        let catId: string;
        try {
            const overwrites = cat.permissions ? buildOverwrites(guildId, cat.permissions, roleIds, warn) : undefined;
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
            placed.add(catId);
            channelIds.set(normaliseChannelName(cat.name, CHANNEL_TYPES.category), catId);
            positions.push({ id: catId, position: catPos++ });
        } catch (err: any) {
            warn(`Category ${cat.name}: ${err.message}`);
            continue;
        }

        let pos = 0;
        for (const ch of cat.channels ?? []) {
            try {
                positions.push({ id: await upsertChannel(ch, catId, cat.permissions), position: pos++ });
            } catch (err: any) {
                warn(`Channel ${ch.name}: ${err.message}`);
            }
        }
    }

    // upsertChannel already put every channel in its category (it throws if Discord refused), and Discord rejects a
    // reorder that sets parent_id on more than one channel (code 40009), so this only sends positions
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
        if (field === "rules_channel_id" && !isCommunity) {
            warn(`#${String(ref).replace(/^#/, "")} isn't set as the rules channel: only Community servers have one`);
            continue;
        }
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

// A role this client can't name is written as its bare ID, marked as a role so applying never mistakes it for a member
function specTarget(guildId: string, o: { id: string; type: number; }) {
    const target = describeOverwriteTarget(guildId, o.id, o.type);
    const type = o.type === 1 ? "member" as const : target === o.id ? "role" as const : undefined;
    return type ? { target, type } : { target };
}

function overwriteSpecs(guildId: string, overwrites: Record<string, any> | undefined): LayoutOverwrite[] {
    return Object.values(overwrites ?? {}).map(o => stripUndefined({
        ...specTarget(guildId, o),
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
        ...specTarget(guildId, o),
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
    const records = guildChannels(guildId).filter(c => !Array.isArray(c.permission_overwrites));
    // Kinds no layout can make (Spaces, directories...) are left out, and listed so nobody wonders where they went
    const all = records.filter(c => isCreatableType(c.type));
    const skipped = records
        .filter(c => !isCreatableType(c.type))
        .sort(sortChannels)
        .map(c => `#${c.name} is left out: ${channelKind(c.type)} channels can't be made from a blueprint`);
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
        afk_channel: channelName(guild.afkChannelId),
        skipped: skipped.length ? skipped : undefined
    }) as ServerLayout;
}
