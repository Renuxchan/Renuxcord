/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel, Guild, Role } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, PermissionsBits, RestAPI, UserStore } from "@webpack/common";

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const SNOWFLAKE = /^\d{17,20}$/;
export const isSnowflake = (s: unknown): boolean => typeof s === "string" && SNOWFLAKE.test(s);

type Method = "get" | "post" | "patch" | "put" | "del";

const WRITE_GAP = 400;
let lastWrite = 0;
let writeChain: Promise<unknown> = Promise.resolve();

function flattenFieldErrors(errors: any, path = ""): string[] {
    if (!errors || typeof errors !== "object") return [];
    if (Array.isArray(errors._errors))
        return errors._errors.map((e: any) => `${path || "body"}: ${e.message ?? e.code}`);

    return Object.entries(errors).flatMap(([key, val]) =>
        flattenFieldErrors(val, path ? `${path}.${key}` : key));
}

export function describeError(err: any): string {
    if (err instanceof Error) return err.message;

    const status = err?.status ?? err?.res?.status;
    const body = err?.body ?? err?.res?.body ?? err;

    if (body?.captcha_key)
        return "Discord asked for a captcha for this action. Do this one step by hand in Discord, then carry on.";

    const parts = [body?.message ?? (status ? `HTTP ${status}` : "Request failed")];
    const fields = flattenFieldErrors(body?.errors);
    if (fields.length) parts.push(fields.join("; "));
    if (body?.code) parts.push(`(code ${body.code})`);

    return parts.join(" ");
}

/** Discord REST through the client's own HTTP layer. Writes are serialised and spaced out, 429s are retried */
export function rest<T = any>(method: Method, url: string, body?: any, query?: Record<string, any>): Promise<T> {
    const run = async () => {
        for (let attempt = 0; ; attempt++) {
            try {
                const res = await RestAPI[method]({ url, body, query });
                return res?.body as T;
            } catch (err: any) {
                const status = err?.status ?? err?.res?.status;
                if (status === 429 && attempt < 5) {
                    const retryAfter = Number(err?.body?.retry_after ?? 1);
                    await sleep(Math.min(retryAfter, 60) * 1000 + 250);
                    continue;
                }
                throw new Error(describeError(err));
            }
        }
    };

    if (method === "get") return run();

    const p = writeChain.then(async () => {
        const wait = lastWrite + WRITE_GAP - Date.now();
        if (wait > 0) await sleep(wait);
        try {
            return await run();
        } finally {
            lastWrite = Date.now();
        }
    });
    writeChain = p.catch(() => { });
    return p;
}

// ---- permissions ----

const PERMISSION_ALIASES: Record<string, string> = {
    VIEW_CHANNELS: "VIEW_CHANNEL",
    READ_MESSAGES: "VIEW_CHANNEL",
    VIEW: "VIEW_CHANNEL",
    SEND: "SEND_MESSAGES",
    READ_HISTORY: "READ_MESSAGE_HISTORY",
    ADMIN: "ADMINISTRATOR",
    MANAGE_SERVER: "MANAGE_GUILD",
    MANAGE_EMOJIS: "MANAGE_GUILD_EXPRESSIONS",
    MANAGE_EMOJIS_AND_STICKERS: "MANAGE_GUILD_EXPRESSIONS",
    MANAGE_EXPRESSIONS: "MANAGE_GUILD_EXPRESSIONS",
    TIMEOUT_MEMBERS: "MODERATE_MEMBERS",
    USE_SLASH_COMMANDS: "USE_APPLICATION_COMMANDS",
    USE_VOICE_ACTIVITY: "USE_VAD",
    VIDEO: "STREAM",
};

function permissionTable(): [string, bigint][] {
    return Object.entries(PermissionsBits as Record<string, unknown>)
        .filter((e): e is [string, bigint] => typeof e[1] === "bigint" && e[1] !== 0n);
}

/** Every permission name the running client knows, one name per bit */
export function permissionNames() {
    const seen = new Set<bigint>();
    return permissionTable()
        .sort((a, b) => (a[1] < b[1] ? -1 : 1))
        .filter(([, bit]) => !seen.has(bit) && seen.add(bit))
        .map(([name]) => name);
}

export function toBits(perms: unknown): bigint {
    if (perms == null || perms === "") return 0n;
    if (typeof perms === "bigint") return perms;
    if (typeof perms === "number") return BigInt(perms);
    if (typeof perms === "string" && /^\d+$/.test(perms)) return BigInt(perms);

    const list = Array.isArray(perms) ? perms : String(perms).split(/[,|]/);
    const table = Object.fromEntries(permissionTable());

    let bits = 0n;
    for (const raw of list) {
        const key = String(raw).trim().toUpperCase().replace(/[\s-]+/g, "_");
        if (!key) continue;
        const bit = table[key] ?? table[PERMISSION_ALIASES[key]];
        if (bit == null) throw new Error(`Unknown permission "${raw}". Call list_permissions for the valid names.`);
        bits |= bit;
    }
    return bits;
}

export function fromBits(bits: bigint | string | number | undefined): string[] {
    const value = BigInt(bits ?? 0);
    if (!value) return [];
    return permissionNames().filter(name => {
        const bit = (PermissionsBits as Record<string, bigint>)[name];
        return (value & bit) === bit;
    });
}

// ---- colours & types ----

export function parseColor(color: unknown): number | undefined {
    if (color == null || color === "") return undefined;
    if (typeof color === "number") return color;
    const hex = String(color).trim().replace(/^#/, "");
    if (!/^[\da-f]{6}$/i.test(hex)) throw new Error(`Invalid colour "${color}", use hex like #ff5733`);
    return parseInt(hex, 16);
}

export const toHex = (color: number) => color ? "#" + color.toString(16).padStart(6, "0") : undefined;

export const CHANNEL_TYPES = {
    text: 0,
    voice: 2,
    category: 4,
    announcement: 5,
    stage: 13,
    forum: 15,
    media: 16
} as const;

export type ChannelTypeName = keyof typeof CHANNEL_TYPES;

const CHANNEL_TYPE_ALIASES: Record<string, ChannelTypeName> = { news: "announcement", vc: "voice" };

// Server channel kinds that can't be made through the API, so layouts can't hold them
const OTHER_CHANNEL_KINDS: Record<number, string> = { 6: "store", 14: "directory", 20: "Space", 21: "app" };

export function channelType(type: unknown): number {
    if (type == null || type === "") return CHANNEL_TYPES.text;
    if (typeof type === "number") return type;
    const key = String(type).toLowerCase().trim();
    // Older exports wrote kinds they didn't know as "type 20"
    const numbered = /^type (\d+)$/.exec(key);
    if (numbered) return Number(numbered[1]);
    const t = CHANNEL_TYPES[key as ChannelTypeName] ?? CHANNEL_TYPES[CHANNEL_TYPE_ALIASES[key]];
    if (t == null) throw new Error(`Unknown channel type "${type}". Use one of: ${Object.keys(CHANNEL_TYPES).join(", ")}`);
    return t;
}

export function channelTypeName(type: number): string {
    return Object.entries(CHANNEL_TYPES).find(([, v]) => v === type)?.[0] ?? `type ${type}`;
}

export const isCreatableType = (type: number) => (Object.values(CHANNEL_TYPES) as number[]).includes(type);

/** "Space", "announcement"... for messages */
export const channelKind = (type: number) => isCreatableType(type) ? channelTypeName(type) : OTHER_CHANNEL_KINDS[type] ?? `type ${type}`;

const THREAD_TYPES = new Set([10, 11, 12, 19]);

// ---- lookups ----

// Things created through REST can reach the stores a moment later, so remember them here
const recent = new Map<string, { roles: Map<string, string>; channels: Map<string, Channel | any>; }>();

function recentFor(guildId: string) {
    let r = recent.get(guildId);
    if (!r) recent.set(guildId, r = { roles: new Map(), channels: new Map() });
    return r;
}

export function rememberRole(guildId: string, role: { id: string; name: string; }) {
    recentFor(guildId).roles.set(role.id, role.name);
}

export function rememberChannel(guildId: string, channel: any) {
    recentFor(guildId).channels.set(channel.id, channel);
}

export function forgetChannel(guildId: string, channelId: string) {
    recent.get(guildId)?.channels.delete(channelId);
}

function pickByName<T>(items: T[], name: string, getName: (t: T) => string, what: string): T {
    const wanted = name.toLowerCase();
    const exact = items.filter(i => getName(i).toLowerCase() === wanted);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(`More than one ${what} is called "${name}", use its ID instead`);

    const partial = items.filter(i => getName(i).toLowerCase().includes(wanted));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1)
        throw new Error(`"${name}" matches several ${what}s: ${partial.slice(0, 10).map(getName).join(", ")}. Be more specific or use the ID`);

    throw new Error(`No ${what} called "${name}"`);
}

export function resolveGuild(ref: unknown): Guild {
    if (ref == null || ref === "") throw new Error("Missing server (name or ID)");
    const s = String(ref).trim();
    if (isSnowflake(s)) {
        const g = GuildStore.getGuild(s);
        if (g) return g;
        throw new Error(`You are not in a server with ID ${s}`);
    }
    return pickByName(GuildStore.getGuildsArray(), s, g => g.name, "server");
}

export function guildChannels(guildId: string): any[] {
    const map = new Map<string, any>();
    for (const c of Object.values(ChannelStore.getMutableGuildChannelsForGuild(guildId) ?? {}))
        if (!THREAD_TYPES.has(c.type)) map.set(c.id, c);
    for (const [id, c] of recent.get(guildId)?.channels ?? [])
        if (!map.has(id)) map.set(id, c);
    return [...map.values()];
}

export function resolveChannel(guildId: string | undefined, ref: unknown, type?: number): Channel {
    if (ref == null || ref === "") throw new Error("Missing channel (name or ID)");
    const s = String(ref).trim().replace(/^#/, "");

    if (isSnowflake(s)) {
        const c = ChannelStore.getChannel(s) ?? (guildId && recent.get(guildId)?.channels.get(s));
        if (c) return c;
        throw new Error(`Can't see a channel with ID ${s}`);
    }
    if (!guildId) throw new Error(`Give the server too when naming a channel ("${s}")`);

    let pool = guildChannels(guildId);
    if (type != null) pool = pool.filter(c => c.type === type);
    else pool = pool.filter(c => c.type !== CHANNEL_TYPES.category);

    return pickByName(pool, s, c => c.name, type === CHANNEL_TYPES.category ? "category" : "channel");
}

export function guildRoles(guildId: string): Role[] {
    const roles = Object.values(GuildRoleStore.getRolesSnapshot(guildId) ?? {});
    const known = new Set(roles.map(r => r.id));
    for (const [id, name] of recent.get(guildId)?.roles ?? [])
        if (!known.has(id)) roles.push({ id, name, position: 0, permissions: 0n, color: 0, hoist: false, mentionable: false, managed: false } as Role);
    return roles;
}

export function resolveRole(guildId: string, ref: unknown): Role {
    if (ref == null || ref === "") throw new Error("Missing role (name or ID)");
    const s = String(ref).trim().replace(/^@(?!everyone)/, "");

    if (/^@?everyone$/i.test(s)) return GuildRoleStore.getRole(guildId, guildId);

    const roles = guildRoles(guildId);
    if (isSnowflake(s)) {
        const r = roles.find(r => r.id === s);
        if (r) return r;
        throw new Error(`No role with ID ${s} in this server`);
    }
    return pickByName(roles.filter(r => r.id !== guildId), s, r => r.name, "role");
}

export function resolveMember(guildId: string, ref: unknown): string {
    if (ref == null || ref === "") throw new Error("Missing user (name or ID)");
    const s = String(ref).trim().replace(/^@/, "");
    if (isSnowflake(s)) return s;

    const wanted = s.toLowerCase();
    const members = GuildMemberStore.getMemberIds(guildId).map(id => {
        const user = UserStore.getUser(id);
        const names = [user?.username, user?.globalName, GuildMemberStore.getNick(guildId, id)]
            .filter((n): n is string => !!n)
            .map(n => n.toLowerCase());
        return { id, names, label: user?.username ?? id };
    });

    const exact = members.filter(m => m.names.includes(wanted));
    if (exact.length === 1) return exact[0].id;

    const candidates = exact.length ? exact : members.filter(m => m.names.some(n => n.includes(wanted)));
    if (candidates.length === 1) return candidates[0].id;
    if (candidates.length > 1)
        throw new Error(`"${s}" matches several members: ${candidates.slice(0, 10).map(m => m.label).join(", ")}. Use their user ID`);

    throw new Error(`No cached member called "${s}". Use their user ID (Discord only caches members you have seen)`);
}

export function describeOverwriteTarget(guildId: string, id: string, type: number) {
    if (type === 0) {
        if (id === guildId) return "@everyone";
        return guildRoles(guildId).find(r => r.id === id)?.name ?? id;
    }
    return UserStore.getUser(id)?.username ?? id;
}
