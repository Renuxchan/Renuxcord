/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EmojiStore, GuildRoleStore, GuildStore, PermissionsBits, SnowflakeUtils } from "@webpack/common";

import { FieldError, guildChannels, guildRoles, isSnowflake, pickByName, resolveChannel, resolveRole, rest, RestError } from "./discord";
import { enumName, enumValue, stripUndefined } from "./layout";

interface ApiOption {
    id: string;
    title: string;
    description?: string | null;
    emoji?: { id?: string | null; name?: string | null; animated?: boolean; } | null;
    emoji_id?: string | null;
    emoji_name?: string | null;
    emoji_animated?: boolean;
    role_ids: string[];
    channel_ids: string[];
}

interface ApiPrompt<O = ApiOption> {
    id: string;
    type: number;
    title: string;
    single_select: boolean;
    required: boolean;
    in_onboarding: boolean;
    options: O[];
}

interface Onboarding<P = ApiPrompt> {
    enabled: boolean;
    mode: number;
    default_channel_ids: string[];
    prompts: P[];
}

// What PUT /onboarding takes: emoji_* fields instead of the emoji object, and new options have no ID
type OptionBody = Omit<ApiOption, "id" | "emoji"> & { id?: string; };
type OnboardingBody = Onboarding<ApiPrompt<OptionBody>>;

const PROMPT_TYPES: Record<string, number> = { multiple_choice: 0, dropdown: 1 };
const MODES: Record<string, number> = { default: 0, advanced: 1 };

const MIN_DEFAULT_CHANNELS = 7;
const MIN_CHATTABLE = 5;

function normalise(ob: Partial<Onboarding> | undefined): Onboarding {
    return {
        enabled: !!ob?.enabled,
        mode: ob?.mode ?? MODES.default,
        default_channel_ids: ob?.default_channel_ids ?? [],
        prompts: (ob?.prompts ?? []).map(p => ({
            ...p,
            options: (p.options ?? []).map(o => ({ ...o, role_ids: o.role_ids ?? [], channel_ids: o.channel_ids ?? [] }))
        }))
    };
}

const fetchOnboarding = async (guildId: string) => normalise(await rest("get", `/guilds/${guildId}/onboarding`));

// @everyone on its own: its server permissions with the channel's @everyone overwrite on top
function everyoneCanSend(guildId: string, channel: any, base: bigint) {
    if (!channel) return false;
    if (base & PermissionsBits.ADMINISTRATOR) return true;

    const overwrite = channel.permissionOverwrites?.[guildId] ?? channel.permission_overwrites?.find?.((o: any) => o.id === guildId);
    const perms = overwrite ? (base & ~BigInt(overwrite.deny)) | BigInt(overwrite.allow) : base;
    const needed = PermissionsBits.VIEW_CHANNEL | PermissionsBits.SEND_MESSAGES;
    return (perms & needed) === needed;
}

// Discord's bar for switching onboarding on
function requirements(guildId: string, ob: { default_channel_ids: string[]; mode: number; }) {
    const channels = new Map(guildChannels(guildId).map(c => [c.id, c]));
    const base = BigInt(GuildRoleStore.getRole(guildId, guildId)?.permissions ?? 0);
    const community = new Set<string>(GuildStore.getGuild(guildId)?.features ?? []).has("COMMUNITY");

    const count = ob.default_channel_ids.length;
    const cannotSend = ob.default_channel_ids
        .filter(id => !everyoneCanSend(guildId, channels.get(id), base))
        .map(id => `#${channels.get(id)?.name ?? id}`);
    const canSend = count - cannotSend.length;
    const advanced = ob.mode === MODES.advanced;

    return {
        community,
        default_channels: count,
        everyone_can_send_in: canSend,
        everyone_cannot_send_in: cannotSend,
        // Advanced mode also counts channels from questions, which only Discord adds up
        met: advanced ? null : community && count >= MIN_DEFAULT_CHANNELS && canSend >= MIN_CHATTABLE,
        ...(advanced ? { note: "Advanced mode also counts channels from questions, which these numbers leave out" } : {})
    };
}

function shortfall(r: ReturnType<typeof requirements>) {
    const notIn = r.everyone_cannot_send_in.length ? ` (not in ${r.everyone_cannot_send_in.join(", ")})` : "";
    return `It needs at least ${MIN_DEFAULT_CHANNELS} default channels, and @everyone must be able to send messages in at least ${MIN_CHATTABLE} of them`
        + `${r.met === null ? " (advanced mode counts channels from questions too)" : ""}. `
        + `This has ${r.default_channels} default ${r.default_channels === 1 ? "channel" : "channels"}, and @everyone can send messages in ${r.everyone_can_send_in}${notIn}.`;
}

function storedEmoji(o: ApiOption) {
    const e = o.emoji ?? { id: o.emoji_id, name: o.emoji_name, animated: o.emoji_animated };
    if (e.id) return { emoji_id: e.id, emoji_name: e.name ?? undefined, emoji_animated: !!e.animated };
    return e.name ? { emoji_name: e.name } : {};
}

function emojiText(o: ApiOption) {
    const e = storedEmoji(o);
    return e.emoji_id ? `<${e.emoji_animated ? "a" : ""}:${e.emoji_name ?? "emoji"}:${e.emoji_id}>` : e.emoji_name;
}

// "🌀", "<:name:id>", "<a:name:id>", or a server emoji's name or ID
function emojiFields(guildId: string, emoji: unknown) {
    if (emoji == null || emoji === "") return {};
    const text = String(emoji).trim();

    const custom = /^<(a?):(\w+):(\d+)>$/.exec(text);
    if (custom) return { emoji_id: custom[3], emoji_name: custom[2], emoji_animated: custom[1] === "a" };
    // A Unicode emoji is never just letters, digits and _, so those name a server emoji
    if (!/^:?\w+:?$/.test(text)) return { emoji_name: text };

    if (isSnowflake(text)) {
        const found = EmojiStore.getCustomEmojiById(text);
        return found ? { emoji_id: found.id, emoji_name: found.name, emoji_animated: !!found.animated } : { emoji_id: text };
    }
    try {
        const found = pickByName(EmojiStore.getGuildEmoji(guildId) ?? [], text.replace(/^:|:$/g, ""), x => x.name, "server emoji");
        return { emoji_id: found.id, emoji_name: found.name, emoji_animated: !!found.animated };
    } catch (err: any) {
        throw new Error(`${err.message}. Use the emoji itself (like 🌀), a server emoji's name, or <:name:id>`);
    }
}

const asList = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value];

function resolveAll(refs: unknown, resolve: (ref: unknown) => string, where: string) {
    return asList(refs).map(ref => {
        try {
            return resolve(ref);
        } catch (err: any) {
            throw new Error(`${where}: ${err.message}`);
        }
    });
}

// The existing question or option with the same ID, or else the same title, is updated in place, so members' answers stay attached
function takeMatch<T extends { id: string; title: string; }>(pool: T[], item: any) {
    const title = String(item?.title ?? "").trim().toLowerCase();
    const index = item?.id != null
        ? pool.findIndex(x => x.id === String(item.id))
        : pool.findIndex(x => x.title.trim().toLowerCase() === title);
    return index === -1 ? undefined : pool.splice(index, 1)[0];
}

function optionBody(guildId: string, input: any, existing: ApiOption | undefined, where: string): OptionBody {
    const title = String(input?.title ?? "").trim();
    if (!title) throw new Error(`${where} needs a title`);

    return stripUndefined({
        id: input.id != null ? String(input.id) : existing?.id,
        title,
        description: input.description !== undefined ? input.description || null : existing?.description ?? null,
        ...(input.emoji !== undefined ? emojiFields(guildId, input.emoji) : existing ? storedEmoji(existing) : {}),
        role_ids: input.role_ids != null ? resolveAll(input.role_ids, r => resolveRole(guildId, r).id, where) : existing?.role_ids ?? [],
        channel_ids: input.channel_ids != null ? resolveAll(input.channel_ids, c => resolveChannel(guildId, c).id, where) : existing?.channel_ids ?? []
    }) as OptionBody;
}

function promptBody(guildId: string, input: any, index: number, existing: ApiPrompt | undefined, newId: () => string): ApiPrompt<OptionBody> {
    const title = String(input?.title ?? "").trim();
    const where = `Question ${index + 1}${title ? ` "${title}"` : ""}`;
    if (!title) throw new Error(`${where} needs a title`);
    if (!Array.isArray(input.options) || !input.options.length) throw new Error(`${where} needs at least one option`);

    const pool = [...existing?.options ?? []];
    return {
        id: input.id != null ? String(input.id) : existing?.id ?? newId(),
        type: enumValue(PROMPT_TYPES, input.type, "question type") ?? existing?.type ?? PROMPT_TYPES.multiple_choice,
        title,
        single_select: input.single_select ?? existing?.single_select ?? false,
        required: input.required ?? existing?.required ?? false,
        in_onboarding: input.in_onboarding ?? existing?.in_onboarding ?? true,
        options: input.options.map((o: any, i: number) =>
            optionBody(guildId, o ?? {}, takeMatch(pool, o), `${where}, option ${i + 1}${o?.title ? ` "${String(o.title).trim()}"` : ""}`))
    };
}

// Anything left out keeps its current value; prompts, when given, replace every question
function onboardingBody(guildId: string, input: any, current: Onboarding): OnboardingBody {
    // Discord wants an ID on every question, even a new one (it gives new ones their own)
    const now = BigInt(SnowflakeUtils.fromTimestamp(Date.now()));
    let made = 0n;
    const newId = () => String(now + made++);

    const prompts: unknown[] = input.prompts != null
        ? asList(input.prompts)
        : current.prompts.map(p => ({ id: p.id, title: p.title, options: p.options.map(o => ({ id: o.id, title: o.title })) }));
    const pool = [...current.prompts];

    return {
        enabled: input.enabled ?? current.enabled,
        mode: enumValue(MODES, input.mode, "onboarding mode") ?? current.mode,
        default_channel_ids: input.default_channel_ids != null
            ? resolveAll(input.default_channel_ids, c => resolveChannel(guildId, c).id, "default_channel_ids")
            : current.default_channel_ids,
        prompts: prompts.map((p, i) => promptBody(guildId, p, i, takeMatch(pool, p), newId))
    };
}

// prompts.0.options.2.role_ids.0 -> question 1 "Who are you?", option 3 "Osaka", role @Osaka
function fieldLabel(guildId: string, { path }: FieldError, body: OnboardingBody) {
    const roleName = (id = "") => `@${guildRoles(guildId).find(r => r.id === id)?.name ?? id}`;
    const channelName = (id = "") => `#${guildChannels(guildId).find(c => c.id === id)?.name ?? id}`;

    const defaultChannel = /^default_channel_ids\.(\d+)$/.exec(path);
    if (defaultChannel) return `default channel ${channelName(body.default_channel_ids[+defaultChannel[1]])}`;

    const match = /^prompts\.(\d+)(?:\.options\.(\d+))?(?:\.(\w+)(?:\.(\d+))?)?$/.exec(path);
    if (!match) return path;

    const [, p, o, field, i] = match;
    const prompt = body.prompts[+p];
    const option = o != null ? prompt?.options[+o] : undefined;
    const parts = [`question ${+p + 1}${prompt ? ` "${prompt.title}"` : ""}`];
    if (o != null) parts.push(`option ${+o + 1}${option ? ` "${option.title}"` : ""}`);
    if (field === "role_ids" && i != null) parts.push(`role ${roleName(option?.role_ids[+i])}`);
    else if (field === "channel_ids" && i != null) parts.push(`channel ${channelName(option?.channel_ids[+i])}`);
    else if (field) parts.push(field);
    return parts.join(", ");
}

function explainError(guildId: string, err: RestError, body: OnboardingBody) {
    const req = requirements(guildId, body);
    let text: string | undefined;
    if (err.code === 350000) text = `Discord won't switch onboarding on yet. ${shortfall(req)}`;
    else if (err.code === 350001) text = `Onboarding is on, and Discord won't save a change that takes it below its minimum. ${shortfall(req)} To save it anyway, switch onboarding off in the same call (enabled: false).`;
    else if (err.code === 50013) text = "Discord says you're missing permissions: changing onboarding needs Manage Server and Manage Roles. Also check that the roles it hands out sit below your own highest role.";
    else if (err.fields?.length) text = `Discord rejected ${err.fields.map(f => `${fieldLabel(guildId, f, body)}: ${f.message}`).join("; ")}.`;

    if (text) return `${text} (Discord said: ${err.message})`;
    return body.enabled && req.met === false ? `${err.message}. ${shortfall(req)}` : err.message;
}

function describeOnboarding(guildId: string, ob: Onboarding) {
    const channels = new Map(guildChannels(guildId).map(c => [c.id, c.name as string]));
    const roles = new Map(guildRoles(guildId).map(r => [r.id, r.name]));
    const channelNames = (ids: string[]) => ids.map(id => channels.get(id) ?? null);

    return {
        enabled: ob.enabled,
        mode: enumName(MODES, ob.mode) ?? ob.mode,
        default_channel_ids: ob.default_channel_ids,
        default_channels: channelNames(ob.default_channel_ids),
        prompts: ob.prompts.map(p => ({
            id: p.id,
            type: enumName(PROMPT_TYPES, p.type) ?? p.type,
            title: p.title,
            single_select: p.single_select,
            required: p.required,
            in_onboarding: p.in_onboarding,
            options: p.options.map(o => stripUndefined({
                id: o.id,
                title: o.title,
                description: o.description || undefined,
                emoji: emojiText(o),
                role_ids: o.role_ids,
                roles: o.role_ids.map(id => roles.get(id) ?? null),
                channel_ids: o.channel_ids,
                channels: channelNames(o.channel_ids)
            }))
        })),
        requirements: requirements(guildId, ob)
    };
}

export async function getOnboarding(guildId: string) {
    return describeOnboarding(guildId, await fetchOnboarding(guildId));
}

export async function setOnboarding(guildId: string, input: any) {
    const community = new Set<string>(GuildStore.getGuild(guildId)?.features ?? []).has("COMMUNITY");
    if (input.enabled === true && !community)
        throw new Error("Onboarding needs a Community server. Turn Community on first: edit_server with community: true (that needs a rules channel and an updates channel)");

    const body = onboardingBody(guildId, input, await fetchOnboarding(guildId));

    let saved: Partial<Onboarding> | undefined;
    try {
        saved = await rest("put", `/guilds/${guildId}/onboarding`, body);
    } catch (err) {
        throw new Error(explainError(guildId, err as RestError, body));
    }
    return describeOnboarding(guildId, saved?.prompts ? normalise(saved) : await fetchOnboarding(guildId));
}
