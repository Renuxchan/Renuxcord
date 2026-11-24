/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs the real RenuxBridge actions against a fake Discord (stores + REST) that is strict where the real one is:
// a bulk channel reorder may set parent_id on one channel only (code 40009), and onboarding wants a Community server,
// 7 default channels with 5 where @everyone can send, an ID on every question, emoji_* fields instead of an emoji
// object, and roles and channels of that server. Nothing touches a real account.
// Run: node mcp/test/fake-discord.mjs
// RENUXBRIDGE_SRC=<folder> tests another copy of src/plugins/renuxBridge instead, such as an older commit's.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const src = resolve(process.env.RENUXBRIDGE_SRC ?? join(repo, "src/plugins/renuxBridge"));
const tmp = mkdtempSync(join(tmpdir(), "renuxbridge-fake-"));

const { build } = await import(pathToFileURL(join(repo, "node_modules/esbuild/lib/main.js")).href);

const from = file => JSON.stringify(join(src, file).replace(/\\/g, "/"));
writeFileSync(join(tmp, "entry.ts"), `export { actions } from ${from("actions")};\nexport { applyLayout } from ${from("layout")};\n`);

const mocks = {
    "@webpack/common": "export const { ChannelStore, EmojiStore, GuildMemberCountStore, GuildMemberStore, GuildRoleStore, GuildStore, NavigationRouter, PermissionsBits, PermissionStore, RestAPI, SnowflakeUtils, UserStore } = globalThis.__fakeDiscord;",
    "@api/PluginManager": "export const isPluginEnabled = () => true; export const plugins = {};",
    "@webpack/patcher": "export const patches = [];",
    "~git-hash": 'export default "test";',
    "@vencord/discord-types": "export {};"
};

await build({
    entryPoints: [join(tmp, "entry.ts")],
    outfile: join(tmp, "bridge.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    tsconfig: join(repo, "tsconfig.json"),
    logLevel: "error",
    plugins: [{
        name: "fake-discord",
        setup(b) {
            b.onResolve({ filter: /^(@webpack\/common|@api\/PluginManager|@webpack\/patcher|~git-hash|@vencord\/discord-types)$/ }, a => ({ path: a.path, namespace: "mock" }));
            b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path], loader: "js" }));
            // No 400ms gap between writes here
            b.onLoad({ filter: /[\\/]discord\.ts$/ }, a => ({ contents: readFileSync(a.path, "utf8").replace("const WRITE_GAP = 400;", "const WRITE_GAP = 0;"), loader: "ts" }));
        }
    }]
});

// ---------------- fake Discord ----------------

const PERMS = ["CREATE_INSTANT_INVITE", "KICK_MEMBERS", "BAN_MEMBERS", "ADMINISTRATOR", "MANAGE_CHANNELS", "MANAGE_GUILD", "ADD_REACTIONS", "VIEW_AUDIT_LOG", "PRIORITY_SPEAKER", "STREAM", "VIEW_CHANNEL", "SEND_MESSAGES", "SEND_TTS_MESSAGES", "MANAGE_MESSAGES", "EMBED_LINKS", "ATTACH_FILES", "READ_MESSAGE_HISTORY", "MENTION_EVERYONE", "USE_EXTERNAL_EMOJIS", "VIEW_GUILD_INSIGHTS", "CONNECT", "SPEAK", "MUTE_MEMBERS", "DEAFEN_MEMBERS", "MOVE_MEMBERS", "USE_VAD", "CHANGE_NICKNAME", "MANAGE_NICKNAMES", "MANAGE_ROLES", "MANAGE_WEBHOOKS", "MANAGE_GUILD_EXPRESSIONS"];
const PermissionsBits = Object.fromEntries(PERMS.map((n, i) => [n, 1n << BigInt(i)]));
const bits = (...names) => names.reduce((b, n) => b | PermissionsBits[n], 0n);

let nextId = 1500000000000000000n;
const snowflake = () => String(nextId++);
const ME = "1000000000000000001";

// Server state: guild and channel records shaped like the client's stores, roles and members per guild,
// custom emojis per guild, and onboarding as GET returns it
const guilds = new Map();
const channels = new Map();
const roles = new Map();
const members = new Map();
const emojis = new Map();
const onboarding = new Map();
const calls = [];

// The client's stores catch up with REST a moment later, like the gateway
const GATEWAY_DELAY = 25;
const client = { guilds: new Map(), channels: new Map(), roles: new Map() };
function syncNow() {
    client.guilds = new Map(guilds);
    client.channels = new Map(channels);
    client.roles = new Map([...roles].map(([gid, m]) => [gid, new Map(m)]));
}
const settle = () => new Promise(r => setTimeout(r, GATEWAY_DELAY * 4));

function addGuild(g) {
    const guild = { ownerId: ME, description: null, premiumTier: 0, verificationLevel: 0, defaultMessageNotifications: 0, explicitContentFilter: 0, afkTimeout: 300, afkChannelId: null, systemChannelId: null, rulesChannelId: null, publicUpdatesChannelId: null, features: new Set(), ...g };
    guilds.set(guild.id, guild);
    roles.set(guild.id, new Map([[guild.id, { id: guild.id, name: "@everyone", color: 0, hoist: false, mentionable: false, managed: false, position: 0, permissions: bits("VIEW_CHANNEL", "SEND_MESSAGES", "READ_MESSAGE_HISTORY", "CONNECT", "SPEAK") }]]));
    members.set(guild.id, new Set([ME]));
    return guild;
}
function addRole(guildId, r) {
    const map = roles.get(guildId);
    const role = { color: 0, hoist: false, mentionable: false, managed: false, permissions: 0n, position: map.size, ...r, id: r.id ?? snowflake() };
    map.set(role.id, role);
    return role;
}
function addChannel(guildId, c) {
    const ch = { id: c.id ?? snowflake(), guild_id: guildId, type: 0, parent_id: null, position: 0, nsfw: false, rateLimitPerUser: 0, userLimit: 0, bitrate: 64000, permissionOverwrites: {}, ...c };
    channels.set(ch.id, ch);
    return ch;
}
const toApiChannel = c => ({
    id: c.id, name: c.name, type: c.type, guild_id: c.guild_id, parent_id: c.parent_id, position: c.position,
    topic: c.topic ?? null, nsfw: c.nsfw, rate_limit_per_user: c.rateLimitPerUser, user_limit: c.userLimit, bitrate: c.bitrate,
    permission_overwrites: Object.values(c.permissionOverwrites).map(o => ({ id: o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) }))
});
const overwriteMap = list => Object.fromEntries((list ?? []).map(o => [o.id, { id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }]));
const everyoneOverwrite = (guildId, allow = [], deny = []) => ({ [guildId]: { id: guildId, type: 0, allow: bits(...allow), deny: bits(...deny) } });

const apiError = (status, body) => ({ ok: false, status, body });
function formError(path, message) {
    const errors = {};
    let node = errors;
    for (const key of path.split(".")) {
        node[key] = {};
        node = node[key];
    }
    node._errors = [{ code: "INVALID", message }];
    return apiError(400, { message: "Invalid Form Body", code: 50035, errors });
}
function onlyKeys(obj, allowed, at) {
    const extra = Object.keys(obj).find(k => !allowed.includes(k));
    if (extra) throw formError(`${at}${extra}`, "Unknown field");
}

// Discord's rule: @everyone alone, its server permissions with the channel's @everyone overwrite on top
function everyoneCanSend(guildId, c) {
    const base = roles.get(guildId).get(guildId).permissions;
    if (base & PermissionsBits.ADMINISTRATOR) return true;
    const o = c?.permissionOverwrites[guildId];
    const perms = o ? (base & ~o.deny) | o.allow : base;
    const needed = bits("VIEW_CHANNEL", "SEND_MESSAGES");
    return !!c && (perms & needed) === needed;
}
const emptyOnboarding = guildId => ({ guild_id: guildId, prompts: [], default_channel_ids: [], enabled: false, mode: 0 });

const routes = [
    ["post", /^\/guilds$/, (m, body) => {
        const g = { id: snowflake(), name: body.name };
        // Discord's "Create My Own" template, with its default channels
        addGuild(g);
        const text = addChannel(g.id, { name: "Text Channels", type: 4, position: 0 });
        const voice = addChannel(g.id, { name: "Voice Channels", type: 4, position: 1 });
        const general = addChannel(g.id, { name: "general", type: 0, parent_id: text.id });
        addChannel(g.id, { name: "General", type: 2, parent_id: voice.id });
        guilds.get(g.id).systemChannelId = general.id;
        return { id: g.id, name: g.name };
    }],
    ["del", /^\/channels\/(\d+)$/, ([, id]) => {
        const c = channels.get(id);
        if (!c) throw apiError(404, { message: "Unknown Channel", code: 10003 });
        channels.delete(id);
        for (const ch of channels.values()) if (ch.parent_id === id) ch.parent_id = null;
        const g = guilds.get(c.guild_id);
        if (g.systemChannelId === id) g.systemChannelId = null;
        return toApiChannel(c);
    }],
    ["del", /^\/guilds\/(\d+)\/roles\/(\d+)$/, ([, gid, rid]) => {
        roles.get(gid).delete(rid);
        return null;
    }],
    ["patch", /^\/guilds\/(\d+)$/, ([, gid], body) => {
        const g = guilds.get(gid);
        const fields = { name: "name", description: "description", verification_level: "verificationLevel", default_message_notifications: "defaultMessageNotifications", explicit_content_filter: "explicitContentFilter", afk_timeout: "afkTimeout", system_channel_id: "systemChannelId", rules_channel_id: "rulesChannelId", afk_channel_id: "afkChannelId" };
        for (const [k, v] of Object.entries(body)) {
            if (!(k in fields)) throw formError(k, "Unknown field");
            g[fields[k]] = v;
        }
        return { id: g.id, name: g.name };
    }],
    ["patch", /^\/guilds\/(\d+)\/roles$/, ([, gid], body) => {
        for (const { id, position } of body) {
            const r = roles.get(gid).get(id);
            if (!r) throw formError("id", `Unknown role ${id}`);
            r.position = position;
        }
        return [...roles.get(gid).values()];
    }],
    ["patch", /^\/guilds\/(\d+)\/roles\/(\d+)$/, ([, gid, rid], body) => {
        const r = roles.get(gid).get(rid);
        if (!r) throw apiError(404, { message: "Unknown Role", code: 10011 });
        if (body.permissions != null) r.permissions = BigInt(body.permissions);
        for (const k of ["name", "color", "hoist", "mentionable"]) if (k in body) r[k] = body[k];
        return { ...r, permissions: String(r.permissions) };
    }],
    ["post", /^\/guilds\/(\d+)\/roles$/, ([, gid], body) => {
        for (const other of roles.get(gid).values()) if (other.id !== gid) other.position++;
        const r = addRole(gid, { name: body.name, color: body.color ?? 0, hoist: !!body.hoist, mentionable: !!body.mentionable, position: 1, permissions: BigInt(body.permissions ?? "0") });
        return { ...r, permissions: String(r.permissions) };
    }],
    ["post", /^\/guilds\/(\d+)\/channels$/, ([, gid], body) => {
        const g = guilds.get(gid);
        const type = body.type ?? 0;
        if ([5, 13, 16].includes(type) && !g.features.has("COMMUNITY")) throw formError("type", "Value must be one of {0, 2, 4, 15}.");
        if (body.parent_id != null && channels.get(body.parent_id)?.type !== 4) throw formError("parent_id", "Not a category");
        const c = addChannel(gid, {
            name: [0, 5, 15, 16].includes(type) ? body.name.toLowerCase().replace(/\s+/g, "-") : body.name,
            type, parent_id: body.parent_id ?? null, position: 99, topic: body.topic, nsfw: !!body.nsfw,
            permissionOverwrites: overwriteMap(body.permission_overwrites)
        });
        return toApiChannel(c);
    }],
    ["patch", /^\/guilds\/(\d+)\/channels$/, ([, gid], body) => {
        // What Discord answered apply_layout with on 2026-11-24
        if (body.filter(p => "parent_id" in p).length > 1)
            throw apiError(400, { message: "Only one channel can have a parent_id modified at a time", code: 40009 });
        for (const p of body) {
            const c = channels.get(p.id);
            if (!c || c.guild_id !== gid) throw formError("id", `Unknown channel ${p.id}`);
            if (p.position != null) c.position = p.position;
            if ("parent_id" in p) c.parent_id = p.parent_id;
        }
        return null;
    }],
    ["patch", /^\/channels\/(\d+)$/, ([, id], body) => {
        const c = channels.get(id);
        if (!c) throw apiError(404, { message: "Unknown Channel", code: 10003 });
        if (body.parent_id != null && channels.get(body.parent_id)?.type !== 4) throw formError("parent_id", "Not a category");
        if (body.permission_overwrites) c.permissionOverwrites = overwriteMap(body.permission_overwrites);
        for (const [k, f] of [["name", "name"], ["topic", "topic"], ["nsfw", "nsfw"], ["rate_limit_per_user", "rateLimitPerUser"], ["user_limit", "userLimit"], ["bitrate", "bitrate"], ["parent_id", "parent_id"]])
            if (k in body) c[f] = body[k];
        return toApiChannel(c);
    }],
    ["get", /^\/guilds\/(\d+)\/onboarding$/, ([, gid]) => structuredClone(onboarding.get(gid) ?? emptyOnboarding(gid))],
    ["put", /^\/guilds\/(\d+)\/onboarding$/, ([, gid], body) => {
        if (!guilds.get(gid).features.has("COMMUNITY")) throw apiError(403, { message: "Missing Access", code: 50001 });
        onlyKeys(body, ["prompts", "default_channel_ids", "enabled", "mode"], "");

        const before = onboarding.get(gid) ?? emptyOnboarding(gid);
        const next = structuredClone(before);
        const channelOf = (id, at) => {
            const c = channels.get(id);
            if (!c || c.guild_id !== gid || c.type === 4) throw formError(at, "Unknown channel");
        };

        if (body.default_channel_ids) {
            body.default_channel_ids.forEach((id, i) => channelOf(id, `default_channel_ids.${i}`));
            next.default_channel_ids = [...body.default_channel_ids];
        }
        if (body.prompts) {
            const old = new Map(before.prompts.map(p => [p.id, p]));
            next.prompts = body.prompts.map((p, i) => {
                const at = `prompts.${i}.`;
                onlyKeys(p, ["id", "type", "title", "single_select", "required", "in_onboarding", "options"], at);
                if (!/^\d+$/.test(p.id ?? "")) throw formError(`${at}id`, "This field is required");
                if (!p.options?.length) throw formError(`${at}options`, "Must be between 1 and 50 in length.");
                const oldOptions = new Set((old.get(p.id)?.options ?? []).map(o => o.id));
                return {
                    // An ID that isn't one of the server's questions marks a new one, which gets its own ID
                    id: old.has(p.id) ? p.id : snowflake(),
                    type: p.type ?? 0,
                    title: p.title,
                    single_select: !!p.single_select,
                    required: !!p.required,
                    in_onboarding: p.in_onboarding ?? true,
                    options: p.options.map((o, j) => {
                        const oat = `${at}options.${j}.`;
                        onlyKeys(o, ["id", "title", "description", "emoji_id", "emoji_name", "emoji_animated", "role_ids", "channel_ids"], oat);
                        (o.role_ids ?? []).forEach((rid, k) => {
                            const r = roles.get(gid).get(rid);
                            if (!r || rid === gid) throw formError(`${oat}role_ids.${k}`, "Unknown role");
                            if (r.managed) throw formError(`${oat}role_ids.${k}`, "Integration roles can't be handed out");
                        });
                        (o.channel_ids ?? []).forEach((cid, k) => channelOf(cid, `${oat}channel_ids.${k}`));
                        if (o.emoji_id && !(emojis.get(gid) ?? []).some(e => e.id === o.emoji_id)) throw formError(`${oat}emoji_id`, "Unknown emoji");
                        return {
                            id: oldOptions.has(o.id) ? o.id : snowflake(),
                            title: o.title,
                            description: o.description ?? null,
                            emoji: o.emoji_id || o.emoji_name ? { id: o.emoji_id ?? null, name: o.emoji_name ?? null, animated: !!o.emoji_animated } : null,
                            role_ids: [...o.role_ids ?? []],
                            channel_ids: [...o.channel_ids ?? []]
                        };
                    })
                };
            });
        }
        if ("enabled" in body) next.enabled = !!body.enabled;
        if ("mode" in body) next.mode = body.mode;

        if (next.enabled && next.mode === 0) {
            const defaults = next.default_channel_ids.map(id => channels.get(id));
            if (defaults.length < 7 || defaults.filter(c => everyoneCanSend(gid, c)).length < 5)
                throw before.enabled
                    ? apiError(400, { message: "Cannot update onboarding while below requirements", code: 350001 })
                    : apiError(400, { message: "Cannot enable onboarding, requirements are not met", code: 350000 });
        }
        onboarding.set(gid, next);
        return structuredClone(next);
    }]
];

function request(method, { url, body }) {
    calls.push({ method, url, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
    for (const [m, re, fn] of routes) {
        const match = m === method && re.exec(url);
        if (!match) continue;
        try {
            const res = { ok: true, status: 200, body: fn(match, body) };
            setTimeout(syncNow, GATEWAY_DELAY);
            return Promise.resolve(res);
        } catch (err) {
            return Promise.reject(err);
        }
    }
    return Promise.reject(apiError(404, { message: `No fake route for ${method} ${url}` }));
}

globalThis.__fakeDiscord = {
    PermissionsBits,
    PermissionStore: { can: () => true },
    RestAPI: Object.fromEntries(["get", "post", "patch", "put", "del"].map(m => [m, opts => request(m, opts)])),
    SnowflakeUtils: { fromTimestamp: ts => String((BigInt(ts) - 1420070400000n) << 22n) },
    NavigationRouter: { transitionToGuild() { }, transitionTo() { } },
    GuildStore: {
        getGuild: id => client.guilds.get(id),
        getGuildsArray: () => [...client.guilds.values()],
        getGuildCount: () => client.guilds.size
    },
    ChannelStore: {
        getChannel: id => client.channels.get(id),
        getMutableGuildChannelsForGuild: gid => Object.fromEntries([...client.channels.values()].filter(c => c.guild_id === gid).map(c => [c.id, c]))
    },
    GuildRoleStore: {
        getRolesSnapshot: gid => Object.fromEntries(client.roles.get(gid) ?? []),
        getRole: (gid, rid) => client.roles.get(gid)?.get(rid)
    },
    GuildMemberStore: { getMemberIds: gid => [...members.get(gid) ?? []], getNick: () => null, getMember: () => null },
    GuildMemberCountStore: { getMemberCount: gid => members.get(gid)?.size },
    EmojiStore: {
        getGuildEmoji: gid => emojis.get(gid) ?? [],
        getCustomEmojiById: id => [...emojis.values()].flat().find(e => e.id === id)
    },
    UserStore: { getCurrentUser: () => ({ id: ME, username: "me" }), getUser: id => (id === ME ? { id: ME, username: "me" } : undefined) }
};

const lib = (await import(pathToFileURL(join(tmp, "bridge.cjs")).href)).default;
const logs = [];
const ctx = { allowWrite: true, allowDestructive: false, allowMessages: false, log: t => logs.push(t), progress() { } };

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
    if (ok) passed++;
    else failed++;
    console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${ok || !detail ? "" : `\n         ${detail}`}`);
}
async function attempt(fn) {
    try {
        return { value: await fn() };
    } catch (error) {
        return { error };
    }
}
// A section that throws counts as one failure instead of stopping the rest
async function section(title, fn) {
    console.log(`\n${title}`);
    const { error } = await attempt(fn);
    if (error) check(`${title} finished`, false, error?.stack ?? error?.message ?? JSON.stringify(error));
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What the Discord client shows: per parent, text-like channels before voice ones, then by position, then by ID
const rank = c => (c.type === 2 || c.type === 13 ? 1 : 0);
const byPosition = (a, b) => rank(a) - rank(b) || a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
const shown = (guildId, parentId) => [...channels.values()]
    .filter(c => c.guild_id === guildId && c.type !== 4 && (c.parent_id ?? null) === parentId)
    .sort(byPosition)
    .map(c => c.name);
const categoryOrder = guildId => [...channels.values()].filter(c => c.guild_id === guildId && c.type === 4).sort(byPosition).map(c => c.name);
const categoryId = (guildId, name) => [...channels.values()].find(c => c.guild_id === guildId && c.type === 4 && c.name === name)?.id;

function checkLayoutOrder(what, guildId, layout) {
    const wantCats = layout.categories.map(c => c.name);
    check(`${what}: categories in layout order`, same(categoryOrder(guildId), wantCats), JSON.stringify(categoryOrder(guildId)));
    const top = shown(guildId, null);
    check(`${what}: channels outside categories in order`, same(top, (layout.channels ?? []).map(c => c.name.toLowerCase())), JSON.stringify(top));
    for (const cat of layout.categories) {
        const got = shown(guildId, categoryId(guildId, cat.name));
        const want = cat.channels.map(c => (c.type === "voice" ? c.name : c.name.toLowerCase()));
        check(`${what}: ${cat.name} holds ${want.join(", ")} in that order`, same(got, want), JSON.stringify(got));
    }
}

const reordersSince = start => calls.slice(start).filter(c => c.method === "patch" && /^\/guilds\/\d+\/channels$/.test(c.url));
function checkReorders(what, start, result) {
    const bodies = reordersSince(start).map(c => c.body);
    check(`${what}: channels were reordered`, bodies.length > 0);
    check(`${what}: no reorder sets parent_id on more than one channel`, bodies.every(b => b.filter(p => "parent_id" in p).length <= 1), JSON.stringify(bodies));
    check(`${what}: no channel appears twice in a reorder`, bodies.every(b => new Set(b.map(p => p.id)).size === b.length));
    check(`${what}: no reorder warning`, !result.warnings.some(w => /reorder/i.test(w)), JSON.stringify(result.warnings.filter(w => /reorder/i.test(w))));
}

// The layout the restructure aims for: two loose channels, then four categories
const LAYOUT = {
    channels: [{ name: "rules" }, { name: "announcements", type: "announcement" }],
    categories: [
        { name: "Text Channels", channels: [{ name: "general" }, { name: "off-topic" }, { name: "memes" }, { name: "staff" }] },
        { name: "Characters", channels: [{ name: "osaka" }, { name: "chiyo" }, { name: "sakaki" }] },
        { name: "media", channels: [{ name: "art" }, { name: "music" }] },
        { name: "Voice Channels", channels: [{ name: "Lounge", type: "voice" }, { name: "gaming", type: "voice" }] }
    ]
};

const layoutSize = layout => (layout.channels?.length ?? 0) + layout.categories.reduce((n, c) => n + 1 + c.channels.length, 0);
const guildChannelNames = guildId => [...channels.values()].filter(c => c.guild_id === guildId).map(c => `${c.type}:${c.name}`);

// ---------------- the server most checks use: Community, its channels in the wrong places ----------------

const AZU = "1400000000000000000";
addGuild({ id: AZU, name: "Azumanga Test", features: new Set(["COMMUNITY"]), premiumTier: 1 });
const voiceCat = addChannel(AZU, { name: "Voice Channels", type: 4, position: 0 });
const textCat = addChannel(AZU, { name: "Text Channels", type: 4, position: 1 });
const charCat = addChannel(AZU, { name: "Characters", type: 4, position: 2 });
const mediaCat = addChannel(AZU, { name: "media", type: 4, position: 3 });
addChannel(AZU, { name: "rules", position: 3, permissionOverwrites: everyoneOverwrite(AZU, [], ["SEND_MESSAGES"]) });
addChannel(AZU, { name: "announcements", type: 5, position: 0, permissionOverwrites: everyoneOverwrite(AZU, [], ["SEND_MESSAGES"]) });
addChannel(AZU, { name: "off-topic", parent_id: textCat.id, position: 0 });
addChannel(AZU, { name: "general", parent_id: charCat.id, position: 4 });
addChannel(AZU, { name: "osaka", parent_id: textCat.id, position: 2 });
addChannel(AZU, { name: "chiyo", parent_id: charCat.id, position: 0 });
addChannel(AZU, { name: "sakaki", parent_id: charCat.id, position: 1 });
addChannel(AZU, { name: "art", parent_id: mediaCat.id, position: 1 });
addChannel(AZU, { name: "music", parent_id: mediaCat.id, position: 0 });
addChannel(AZU, { name: "gaming", type: 2, parent_id: textCat.id, position: 0 });
addChannel(AZU, { name: "Lounge", type: 2, parent_id: voiceCat.id, position: 1 });
addChannel(AZU, { name: "staff", parent_id: textCat.id, position: 5, permissionOverwrites: everyoneOverwrite(AZU, [], ["VIEW_CHANNEL"]) });
const osakaRole = addRole(AZU, { name: "Osaka", color: 0xffd966 });
const chiyoRole = addRole(AZU, { name: "Chiyo", color: 0xf4a6c8 });
const sakakiRole = addRole(AZU, { name: "Sakaki", color: 0x6d5a8c });
const memberRole = addRole(AZU, { name: "Member" });
addRole(AZU, { name: "Carl-bot", managed: true });
const OSAKA_WAVE = "1450000000000000001";
const SPIN = "1450000000000000002";
emojis.set(AZU, [{ id: OSAKA_WAVE, name: "osaka_wave", animated: false, guildId: AZU }, { id: SPIN, name: "spin", animated: true, guildId: AZU }]);
syncNow();

await section("fake Discord", async () => {
    const oldStyle = await attempt(() => globalThis.__fakeDiscord.RestAPI.patch({
        url: `/guilds/${AZU}/channels`,
        body: [...channels.values()].filter(c => c.parent_id === charCat.id).map((c, i) => ({ id: c.id, position: i, parent_id: charCat.id }))
    }));
    check("a reorder with parent_id on every channel gets 40009, as Discord answered apply_layout", oldStyle.error?.body?.code === 40009, JSON.stringify(oldStyle));
});

// ---------------- channel order ----------------

await section("restructure an existing server (apply_layout)", async () => {
    const before = guildChannelNames(AZU);
    const start = calls.length;
    const result = await lib.applyLayout(AZU, LAYOUT, { allowDeletes: false, allowMessages: false });
    await settle();

    checkReorders("restructure", start, result);
    checkLayoutOrder("restructure", AZU, LAYOUT);
    const after = guildChannelNames(AZU);
    check("restructure: existing channels were reused, only memes is new", after.length === before.length + 1 && new Set(after).size === after.length && result.created.channels.join() === "memes", JSON.stringify(result.created));
    check("restructure: the private staff channel stayed private", !everyoneCanSend(AZU, [...channels.values()].find(c => c.guild_id === AZU && c.name === "staff")));
});

await section("two layout channels with the same name", async () => {
    const DUP = "1400000000000000100";
    addGuild({ id: DUP, name: "Dupes" });
    const lobby = addChannel(DUP, { name: "Lobby", type: 4, position: 0 });
    addChannel(DUP, { name: "Games", type: 4, position: 1 });
    const chat = addChannel(DUP, { name: "chat", parent_id: lobby.id, position: 0 });
    syncNow();

    const layout = { categories: [{ name: "Lobby", channels: [{ name: "chat" }, { name: "rules" }] }, { name: "Games", channels: [{ name: "chat" }] }] };
    const start = calls.length;
    const result = await lib.applyLayout(DUP, layout, { allowDeletes: false, allowMessages: false });
    await settle();

    checkReorders("duplicate names", start, result);
    checkLayoutOrder("duplicate names", DUP, layout);
    check("duplicate names: the existing chat stays in Lobby and Games gets a new one", channels.get(chat.id).parent_id === lobby.id && result.created.channels.join() === "rules,chat", JSON.stringify(result.created));
});

await section("create_server with a layout (what a ServerBlueprints clone does)", async () => {
    const start = calls.length;
    const made = await lib.actions.createServer({ name: "Fresh Copy", layout: LAYOUT, open: false }, ctx);
    await settle();

    checkReorders("new server", start, made.layout);
    checkLayoutOrder("new server", made.id, LAYOUT);
    check("new server: only the layout's channels, Discord's defaults are gone", guildChannelNames(made.id).length === layoutSize(LAYOUT), JSON.stringify(guildChannelNames(made.id)));
    check("new server: nothing failed outright", !made.layout.warnings.some(w => /^(Channel|Category|Role) |Couldn't/.test(w)), JSON.stringify(made.layout.warnings));
});

await section("ServerBlueprints paste over an existing server (wipe)", async () => {
    const PASTE = "1400000000000000200";
    addGuild({ id: PASTE, name: "Paste Target" });
    const old = addChannel(PASTE, { name: "Old Stuff", type: 4, position: 0 });
    addChannel(PASTE, { name: "junk", parent_id: old.id });
    syncNow();

    const start = calls.length;
    const result = await lib.applyLayout(PASTE, LAYOUT, { wipe: true, allowDeletes: true, allowMessages: true });
    await settle();

    checkReorders("paste", start, result);
    checkLayoutOrder("paste", PASTE, LAYOUT);
    check("paste: only the layout's channels, the old ones are gone", guildChannelNames(PASTE).length === layoutSize(LAYOUT), JSON.stringify(guildChannelNames(PASTE)));
});

// ---------------- onboarding ----------------

const channelId = name => [...channels.values()].find(c => c.guild_id === AZU && c.name === name && c.type !== 4)?.id;
const putsSince = start => calls.slice(start).filter(c => c.method === "put" && /\/onboarding$/.test(c.url));
const DEFAULTS = ["general", "off-topic", "#memes", "art", "music", "rules", "announcements"];
const PICKER = {
    server: "Azumanga Test",
    enabled: true,
    mode: "default",
    default_channel_ids: DEFAULTS,
    prompts: [
        {
            title: "Who's your Azumanga girl?",
            single_select: true,
            required: true,
            options: [
                { title: "Osaka", description: "Spaced out", emoji: "osaka_wave", role_ids: ["Osaka"], channel_ids: ["osaka"] },
                { title: "Chiyo", emoji: "🎀", role_ids: ["chiyo"] },
                { title: "Sakaki", emoji: `<a:spin:${SPIN}>`, role_ids: [sakakiRole.id] }
            ]
        },
        { title: "Anything else?", type: "dropdown", in_onboarding: false, options: [{ title: "Gaming", role_ids: ["Member"], channel_ids: ["gaming"] }] }
    ]
};

await section("onboarding: permissions and a first look", async () => {
    const locked = { ...ctx, allowWrite: false };
    const get = await attempt(() => lib.actions.getOnboarding({ server: AZU }, locked));
    const set = await attempt(() => lib.actions.setOnboarding(PICKER, locked));
    check("both onboarding actions need \"Allow changes\"", /Allow changes/.test(get.error?.message) && /Allow changes/.test(set.error?.message), `${get.error?.message} | ${set.error?.message}`);

    const first = await lib.actions.getOnboarding({ server: "Azumanga Test" }, ctx);
    check("get_onboarding on a server without it", first.enabled === false && first.prompts.length === 0 && first.requirements.met === false && first.requirements.community === true, JSON.stringify(first));
});

await section("onboarding: the colour-role picker", async () => {
    const start = calls.length;
    const out = await lib.actions.setOnboarding(PICKER, ctx);
    const [{ body }] = putsSince(start);
    const [q1, q2] = body.prompts;
    const [osaka, chiyo, sakaki] = q1.options;

    check("payload: default channel names resolved to IDs", same(body.default_channel_ids, DEFAULTS.map(n => channelId(n.replace("#", "")))), JSON.stringify(body.default_channel_ids));
    check("payload: enabled and mode", body.enabled === true && body.mode === 0);
    check("payload: every question has its own ID", /^\d+$/.test(q1.id) && /^\d+$/.test(q2.id) && q1.id !== q2.id, `${q1.id} ${q2.id}`);
    check("payload: question settings, with defaults filled in", q1.type === 0 && q1.single_select && q1.required && q1.in_onboarding && q2.type === 1 && !q2.single_select && !q2.required && q2.in_onboarding === false, JSON.stringify([q1, q2].map(({ options, ...q }) => q)));
    check("payload: new answers carry no ID and no emoji object", body.prompts.every(p => p.options.every(o => !("id" in o) && !("emoji" in o))));
    check("payload: role and channel names resolved", same(osaka.role_ids, [osakaRole.id]) && same(osaka.channel_ids, [channelId("osaka")]) && same(chiyo.role_ids, [chiyoRole.id]) && same(sakaki.role_ids, [sakakiRole.id]) && same(q2.options[0].role_ids, [memberRole.id]) && same(q2.options[0].channel_ids, [channelId("gaming")]));
    check("payload: server emoji by name", osaka.emoji_id === OSAKA_WAVE && osaka.emoji_name === "osaka_wave" && osaka.emoji_animated === false, JSON.stringify(osaka));
    check("payload: Unicode emoji", chiyo.emoji_name === "🎀" && !("emoji_id" in chiyo), JSON.stringify(chiyo));
    check("payload: animated <a:name:id> emoji", sakaki.emoji_id === SPIN && sakaki.emoji_name === "spin" && sakaki.emoji_animated === true, JSON.stringify(sakaki));
    check("payload: descriptions", osaka.description === "Spaced out" && chiyo.description === null);

    const [o1, o2, o3] = out.prompts[0].options;
    check("result: onboarding is on and meets the bar", out.enabled === true && out.mode === "default" && out.requirements.met === true, JSON.stringify(out.requirements));
    check("result: names next to IDs", same(out.default_channels, DEFAULTS.map(n => n.replace("#", ""))) && same(o1.roles, ["Osaka"]) && same(o1.role_ids, [osakaRole.id]) && same(o1.channels, ["osaka"]), JSON.stringify(o1));
    check("result: emoji written so they can be passed back", o1.emoji === `<:osaka_wave:${OSAKA_WAVE}>` && o2.emoji === "🎀" && o3.emoji === `<a:spin:${SPIN}>`, JSON.stringify([o1.emoji, o2.emoji, o3.emoji]));
    check("result: Discord's own IDs, not the temporary ones", out.prompts[0].id !== q1.id && out.prompts.every(p => p.options.every(o => /^\d+$/.test(o.id))));
    check("result: logged as a change", logs.includes("Updated onboarding in Azumanga Test"), JSON.stringify(logs));
});

await section("onboarding: editing what's there", async () => {
    const stored = structuredClone(onboarding.get(AZU));
    let start = calls.length;
    await lib.actions.setOnboarding({
        server: AZU,
        prompts: [
            { title: "who's your azumanga girl?", options: [{ title: "Osaka" }, { title: "Chiyo", emoji: "🐧" }, { title: "Sakaki" }, { title: "Tomo", emoji: "⚡", role_ids: ["Member"] }] },
            { title: "Anything else?", options: [{ title: "Gaming" }] }
        ]
    }, ctx);
    const [{ body }] = putsSince(start);
    const [q1, q2] = body.prompts;

    check("same titles keep the question's and answers' IDs", q1.id === stored.prompts[0].id && same(q1.options.slice(0, 3).map(o => o.id), stored.prompts[0].options.map(o => o.id)) && !("id" in q1.options[3]), JSON.stringify(q1.options.map(o => o.id ?? "new")));
    check("left-out fields keep their values", q1.single_select && q1.required && same(q1.options[0].role_ids, [osakaRole.id]) && q1.options[0].emoji_id === OSAKA_WAVE && q1.options[0].description === "Spaced out" && q2.type === 1 && q2.in_onboarding === false && same(q2.options[0].role_ids, [memberRole.id]) && body.enabled === true && same(body.default_channel_ids, stored.default_channel_ids), JSON.stringify(body));
    check("a changed emoji and title are changed", q1.options[1].emoji_name === "🐧" && q1.title === "who's your azumanga girl?");
    check("Discord kept the question and added Tomo", onboarding.get(AZU).prompts[0].id === stored.prompts[0].id && onboarding.get(AZU).prompts[0].options.length === 4);

    const kept = structuredClone(onboarding.get(AZU));
    start = calls.length;
    await lib.actions.setOnboarding({ server: "Azumanga Test", enabled: false }, ctx);
    const [{ body: offBody }] = putsSince(start);
    check("switching off re-sends the questions unchanged", same(onboarding.get(AZU).prompts, kept.prompts) && onboarding.get(AZU).enabled === false && offBody.prompts.every(p => p.options.every(o => !("emoji" in o))), JSON.stringify(offBody.prompts[0].options[0]));
});

await section("onboarding: Discord's requirements in plain words", async () => {
    const tooFew = await attempt(() => lib.actions.setOnboarding({ server: AZU, enabled: true, default_channel_ids: ["general", "off-topic", "memes", "rules", "announcements", "art"] }, ctx));
    check("too few default channels", /won't switch onboarding on yet/.test(tooFew.error?.message) && /at least 7 default channels/.test(tooFew.error.message) && /This has 6 default channels, and @everyone can send messages in 4 \(not in #rules, #announcements\)/.test(tooFew.error.message) && /code 350000/.test(tooFew.error.message), tooFew.error?.message ?? "no error");

    const quiet = await attempt(() => lib.actions.setOnboarding({ server: AZU, enabled: true, default_channel_ids: ["general", "off-topic", "memes", "rules", "announcements", "staff", "art"] }, ctx));
    check("too few channels where @everyone can send: names them", /can send messages in 4 \(not in #rules, #announcements, #staff\)/.test(quiet.error?.message), quiet.error?.message ?? "no error");

    await lib.actions.setOnboarding({ server: AZU, enabled: true, default_channel_ids: DEFAULTS }, ctx);
    const drop = await attempt(() => lib.actions.setOnboarding({ server: AZU, default_channel_ids: ["general", "off-topic", "memes", "art", "music", "rules"] }, ctx));
    check("dropping below the bar while it's on: explained, with the way out", /takes it below its minimum/.test(drop.error?.message) && /enabled: false/.test(drop.error.message) && /code 350001/.test(drop.error.message), drop.error?.message ?? "no error");

    const PLAIN = "1400000000000000300";
    addGuild({ id: PLAIN, name: "Not Community" });
    syncNow();
    const start = calls.length;
    const plain = await attempt(() => lib.actions.setOnboarding({ server: PLAIN, enabled: true, default_channel_ids: [] }, ctx));
    check("switching it on without Community: plain error, nothing sent", /needs a Community server/.test(plain.error?.message) && calls.length === start, plain.error?.message ?? "no error");
});

await section("onboarding: mistakes", async () => {
    const start = calls.length;
    const badRole = await attempt(() => lib.actions.setOnboarding({ server: AZU, prompts: [{ title: "Pick", options: [{ title: "Osaka", role_ids: ["Osakaa"] }] }] }, ctx));
    check("an unknown role name fails before anything is sent", /Question 1 "Pick", option 1 "Osaka": No role called "Osakaa"/.test(badRole.error?.message) && putsSince(start).length === 0, badRole.error?.message ?? "no error");

    const badEmoji = await attempt(() => lib.actions.setOnboarding({ server: AZU, prompts: [{ title: "Pick", options: [{ title: "Osaka", emoji: "nope", role_ids: ["Osaka"] }] }] }, ctx));
    check("an unknown emoji name fails with a hint", /No server emoji called "nope"\. Use the emoji itself/.test(badEmoji.error?.message) && putsSince(start).length === 0, badEmoji.error?.message ?? "no error");

    const noOptions = await attempt(() => lib.actions.setOnboarding({ server: AZU, prompts: [{ title: "Pick", options: [] }] }, ctx));
    check("a question without answers fails before anything is sent", /Question 1 "Pick" needs at least one option/.test(noOptions.error?.message) && putsSince(start).length === 0, noOptions.error?.message ?? "no error");

    const botPick = await attempt(() => lib.actions.setOnboarding({ server: AZU, prompts: [{ title: "Pick", options: [{ title: "Osaka", role_ids: ["Osaka"] }, { title: "Bots", role_ids: ["Carl-bot"] }] }] }, ctx));
    check("Discord's field errors name the question, answer and role", /Discord rejected question 1 "Pick", option 2 "Bots", role @Carl-bot: Integration roles can't be handed out/.test(botPick.error?.message), botPick.error?.message ?? "no error");

    const catDefault = await attempt(() => lib.actions.setOnboarding({ server: AZU, default_channel_ids: [...DEFAULTS, charCat.id] }, ctx));
    check("a field error on a default channel names the channel", /Discord rejected default channel #Characters: Unknown channel/.test(catDefault.error?.message), catDefault.error?.message ?? "no error");

    const now = await lib.actions.getOnboarding({ server: AZU }, ctx);
    check("failed calls changed nothing", now.enabled === true && now.prompts[0].options.length === 4 && now.prompts[0].options[3].title === "Tomo" && same(now.default_channels, DEFAULTS.map(n => n.replace("#", ""))), JSON.stringify(now));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
