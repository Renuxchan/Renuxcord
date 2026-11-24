/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { bridgeStatus, callBridge } from "./bridge.mjs";
import { toDataUri } from "./images.mjs";

const VERSION = "1.0.0";
const LONG = 10 * 60_000;

const server = new McpServer(
    { name: "renuxcord", title: "Renuxcord", version: VERSION },
    {
        instructions: [
            "These tools drive the user's own Discord account through the Renuxcord client mod (RenuxBridge plugin). Discord must be open.",
            "Servers, channels, categories and roles can be given by name or ID. Names are matched case-insensitively.",
            "To build or restructure a server, prefer one apply_layout call (or create_server with a layout) over many small calls: it is faster and keeps permissions consistent.",
            "Role lists in layouts are highest-first. Channel permissions in a category are merged on top of the category's permissions.",
            "Use list_permissions for exact permission names. Private categories: deny VIEW_CHANNEL to @everyone and allow it to the roles that should see them.",
            "Actions happen at a human pace. Never use these tools for spam, mass messaging or anything against Discord's rules.",
            "Deleting anything is permanent. Only delete when the user clearly asked for it."
        ].join("\n")
    }
);

function ok(result) {
    return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
}

function fail(err) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
}

/** Registers a tool that forwards its arguments to a RenuxBridge action */
function bridgeTool(name, config, method, { prepare, timeoutMs } = {}) {
    server.registerTool(name, config, async args => {
        try {
            const params = prepare ? await prepare(args ?? {}) : args ?? {};
            return ok(await callBridge(method, params, timeoutMs));
        } catch (err) {
            return fail(err);
        }
    });
}

// ---- shared schemas ----

const serverRef = z.string().describe("Server name or ID");
const channelRef = z.string().describe("Channel or category name (no #) or ID");
const optionalServer = z.string().optional().describe("Server name or ID. Needed when the channel is given by name");
const permissionList = z.array(z.string()).describe("Permission names such as VIEW_CHANNEL or SEND_MESSAGES (see list_permissions)");
const channelTypes = z.enum(["text", "voice", "category", "announcement", "stage", "forum", "media"]);

const overwrite = z.object({
    target: z.string().describe('Role name, "@everyone", role ID or user ID'),
    type: z.enum(["role", "member"]).optional().describe("Only needed when the target is a user"),
    allow: permissionList.optional(),
    deny: permissionList.optional()
});

const layoutChannel = z.object({
    name: z.string(),
    type: z.enum(["text", "voice", "announcement", "stage", "forum", "media"]).optional().describe("Defaults to text"),
    topic: z.string().optional(),
    nsfw: z.boolean().optional(),
    slowmode: z.number().int().min(0).max(21600).optional().describe("Seconds each user waits between messages"),
    user_limit: z.number().int().min(0).max(99).optional().describe("Voice only. 0 = unlimited"),
    bitrate: z.number().int().optional().describe("Voice only, bits per second (64000 is the default)"),
    permissions: z.array(overwrite).optional().describe("Merged on top of the category's permissions"),
    messages: z.array(z.string()).optional().describe("Posted in the channel after it is created, e.g. rules or a welcome")
});

const layoutRole = z.object({
    name: z.string(),
    color: z.string().optional().describe("Hex colour like #ff5733"),
    hoist: z.boolean().optional().describe("Show members with this role separately in the member list"),
    mentionable: z.boolean().optional(),
    permissions: permissionList.optional()
});

const layout = z.object({
    name: z.string().optional().describe("Renames the server"),
    description: z.string().optional(),
    verification_level: z.enum(["none", "low", "medium", "high", "highest"]).optional(),
    default_notifications: z.enum(["all", "mentions"]).optional(),
    explicit_content_filter: z.enum(["disabled", "members_without_roles", "all_members"]).optional(),
    afk_timeout: z.number().int().optional().describe("Seconds: 60, 300, 900, 1800 or 3600"),
    everyone: z.object({ permissions: permissionList.optional() }).optional().describe("Server-wide permissions for @everyone"),
    roles: z.array(layoutRole).optional().describe("Highest role first"),
    categories: z.array(z.object({
        name: z.string(),
        permissions: z.array(overwrite).optional(),
        channels: z.array(layoutChannel).optional()
    })).optional(),
    channels: z.array(layoutChannel).optional().describe("Channels outside any category (shown at the top)"),
    system_channel: z.string().optional().describe("Channel that gets join messages"),
    rules_channel: z.string().optional(),
    afk_channel: z.string().optional().describe("Voice channel idle members are moved to")
}).describe("Server layout. Existing roles and channels with the same name are updated instead of duplicated");

const imageInput = z.string().describe("Image file path on this PC, an http(s) URL, or a data URI");

// ---- read ----

server.registerTool("status", {
    title: "Bridge status",
    description: "Checks that Discord with Renuxcord is reachable and shows the logged-in user and what the bridge is allowed to do",
    annotations: { readOnlyHint: true }
}, async () => {
    try {
        const [bridge, discord] = await Promise.all([bridgeStatus(), callBridge("status", {}, 15_000)]);
        return ok({ bridge, ...discord });
    } catch (err) {
        return fail(err);
    }
});

bridgeTool("list_servers", {
    title: "List servers",
    description: "Lists the servers the account is in, with whether you own or can manage each",
    inputSchema: { query: z.string().optional().describe("Only servers whose name contains this") },
    annotations: { readOnlyHint: true }
}, "listServers");

bridgeTool("get_server", {
    title: "Get server",
    description: "Full picture of one server: roles (highest first) with permissions, categories, channels and permission overwrites",
    inputSchema: { server: serverRef },
    annotations: { readOnlyHint: true }
}, "getServer");

bridgeTool("export_layout", {
    title: "Export server layout",
    description: "Exports a server's roles, categories, channels and permissions in the same format apply_layout takes. Use it to back up or clone a server",
    inputSchema: { server: serverRef },
    annotations: { readOnlyHint: true }
}, "exportLayout");

bridgeTool("list_members", {
    title: "List members",
    description: "Lists members the client has cached (big servers only have part of their members cached), with their roles",
    inputSchema: {
        server: serverRef,
        query: z.string().optional().describe("Filter by username, display name or nickname"),
        limit: z.number().int().min(1).max(500).optional()
    },
    annotations: { readOnlyHint: true }
}, "listMembers");

bridgeTool("read_messages", {
    title: "Read messages",
    description: "Reads recent messages from a server text channel, oldest first. Never works on DMs",
    inputSchema: { channel: channelRef, server: optionalServer, limit: z.number().int().min(1).max(100).optional().describe("Default 25") },
    annotations: { readOnlyHint: true }
}, "readMessages");

bridgeTool("diagnostics", {
    title: "Renuxcord health check",
    description: "Which Renuxcord plugins are running, enabled plugins that failed to start, plugins whose patches didn't apply, and custom plugin load errors",
    annotations: { readOnlyHint: true }
}, "diagnostics");

bridgeTool("list_permissions", {
    title: "List permission names",
    description: "Every permission name the Discord client knows, for roles and channel overwrites",
    annotations: { readOnlyHint: true }
}, "listPermissions");

// ---- whole-server ----

bridgeTool("create_server", {
    title: "Create server",
    description: "Creates a new server owned by the account and opens it. With a layout, the default channels are replaced by the layout in one go. "
        + "Accounts can be in at most 100 servers (200 with Nitro)",
    inputSchema: {
        name: z.string().min(2).max(100),
        icon: imageInput.optional(),
        layout: layout.optional(),
        open: z.boolean().optional().describe("Switch Discord to the new server (default true)")
    }
}, "createServer", {
    timeoutMs: LONG,
    prepare: async args => ({ ...args, icon: await toDataUri(args.icon, 10 * 1024 * 1024) })
});

bridgeTool("apply_layout", {
    title: "Apply server layout",
    description: "Builds or restructures a server in one call: settings, @everyone permissions, roles (created or updated by name, then ordered), "
        + "categories, channels with permissions, starter messages and system/rules channels. Existing things with the same name are updated, "
        + "nothing is deleted unless wipe is true. Returns what changed plus the IDs of everything",
    inputSchema: {
        server: serverRef,
        layout,
        wipe: z.boolean().optional().describe("Delete ALL existing channels (and roles, if the layout has roles) first. Permanent")
    },
    annotations: { destructiveHint: true }
}, "applyLayout", { timeoutMs: LONG });

bridgeTool("edit_server", {
    title: "Edit server settings",
    description: "Changes server name, description, icon, safety levels, system/rules/updates/AFK channels, or turns Community on/off",
    inputSchema: {
        server: serverRef,
        name: z.string().optional(),
        description: z.string().optional(),
        icon: imageInput.optional(),
        verification_level: z.enum(["none", "low", "medium", "high", "highest"]).optional(),
        default_notifications: z.enum(["all", "mentions"]).optional(),
        explicit_content_filter: z.enum(["disabled", "members_without_roles", "all_members"]).optional(),
        system_channel: z.string().optional().describe('Channel for join messages, or "none"'),
        rules_channel: z.string().optional(),
        updates_channel: z.string().optional().describe("Community updates channel"),
        afk_channel: z.string().optional().describe('Voice channel, or "none"'),
        afk_timeout: z.number().int().optional(),
        community: z.boolean().optional().describe("Turn Community on (needs rules_channel and updates_channel) or off")
    }
}, "editServer", { prepare: async args => ({ ...args, icon: await toDataUri(args.icon, 10 * 1024 * 1024) }) });

bridgeTool("delete_server", {
    title: "Delete server",
    description: "Permanently deletes a server the account owns. Needs \"Allow deleting\" on in RenuxBridge and confirm_name equal to the exact server name",
    inputSchema: { server: serverRef, confirm_name: z.string().describe("The server's exact name") },
    annotations: { destructiveHint: true }
}, "deleteServer");

// ---- channels ----

bridgeTool("create_channel", {
    title: "Create channel",
    description: "Creates a text, voice, announcement, stage, forum or media channel, or a category. Inside a category it copies the category's permissions unless you pass your own",
    inputSchema: {
        server: serverRef,
        name: z.string(),
        type: channelTypes.optional().describe("Defaults to text"),
        category: z.string().optional().describe("Category name or ID to put it in"),
        topic: z.string().optional(),
        nsfw: z.boolean().optional(),
        slowmode: z.number().int().min(0).max(21600).optional(),
        user_limit: z.number().int().min(0).max(99).optional(),
        bitrate: z.number().int().optional(),
        position: z.number().int().optional(),
        permissions: z.array(overwrite).optional()
    }
}, "createChannel");

bridgeTool("edit_channel", {
    title: "Edit channel",
    description: "Renames, re-topics or moves a channel or category, changes slowmode/NSFW/voice settings, or re-syncs its permissions with its category",
    inputSchema: {
        channel: channelRef,
        server: optionalServer,
        name: z.string().optional(),
        topic: z.string().optional(),
        nsfw: z.boolean().optional(),
        slowmode: z.number().int().min(0).max(21600).optional(),
        user_limit: z.number().int().min(0).max(99).optional(),
        bitrate: z.number().int().optional(),
        position: z.number().int().optional(),
        category: z.string().nullable().optional().describe('Move into this category, or "none" to take it out'),
        sync_permissions: z.boolean().optional().describe("Copy the category's permissions onto the channel")
    }
}, "editChannel");

bridgeTool("delete_channel", {
    title: "Delete channel",
    description: "Permanently deletes a channel or category and its messages. Needs \"Allow deleting\" on in RenuxBridge",
    inputSchema: { channel: channelRef, server: optionalServer },
    annotations: { destructiveHint: true }
}, "deleteChannel");

bridgeTool("set_permissions", {
    title: "Set channel permissions",
    description: "Sets a role's or member's permission overwrite on a channel or category. By default it merges with what's there; mode replace overwrites it",
    inputSchema: {
        channel: channelRef,
        server: optionalServer,
        target: z.string().describe('Role name, "@everyone", role ID or user ID'),
        target_type: z.enum(["role", "member"]).optional(),
        allow: permissionList.optional(),
        deny: permissionList.optional(),
        neutral: permissionList.optional().describe("Permissions to reset back to inherit"),
        mode: z.enum(["merge", "replace"]).optional()
    }
}, "setPermissions");

bridgeTool("clear_permissions", {
    title: "Clear channel permissions",
    description: "Removes a role's or member's overwrite from a channel so it inherits again",
    inputSchema: { channel: channelRef, server: optionalServer, target: z.string(), target_type: z.enum(["role", "member"]).optional() }
}, "clearPermissions");

// ---- roles ----

bridgeTool("create_role", {
    title: "Create role",
    description: "Creates a role. New roles start just above @everyone; use reorder_roles to move them",
    inputSchema: {
        server: serverRef,
        name: z.string(),
        color: z.string().optional().describe("Hex colour like #ff5733"),
        hoist: z.boolean().optional(),
        mentionable: z.boolean().optional(),
        permissions: permissionList.optional().describe("If left out, Discord copies @everyone's permissions")
    }
}, "createRole");

bridgeTool("edit_role", {
    title: "Edit role",
    description: 'Edits a role (or "@everyone"): name, colour, hoist, mentionable and permissions (replace all, or add/remove some)',
    inputSchema: {
        server: serverRef,
        role: z.string().describe('Role name, "@everyone" or role ID'),
        name: z.string().optional(),
        color: z.string().optional(),
        hoist: z.boolean().optional(),
        mentionable: z.boolean().optional(),
        permissions: permissionList.optional().describe("Replaces every permission"),
        add_permissions: permissionList.optional(),
        remove_permissions: permissionList.optional()
    }
}, "editRole");

bridgeTool("delete_role", {
    title: "Delete role",
    description: "Permanently deletes a role. Needs \"Allow deleting\" on in RenuxBridge",
    inputSchema: { server: serverRef, role: z.string() },
    annotations: { destructiveHint: true }
}, "deleteRole");

bridgeTool("reorder_roles", {
    title: "Reorder roles",
    description: "Puts the given roles in this order, highest first. Unlisted roles keep their order below them; bot roles stay on top. "
        + "Unless the account owns the server, only roles below its highest role can move, and everything from that role up stays put",
    inputSchema: { server: serverRef, roles: z.array(z.string()).min(1) }
}, "reorderRoles");

bridgeTool("add_role_to_member", {
    title: "Give role",
    description: "Gives a member a role",
    inputSchema: { server: serverRef, user: z.string().describe("User ID, username or nickname"), role: z.string() }
}, "addRole");

bridgeTool("remove_role_from_member", {
    title: "Take role",
    description: "Removes a role from a member",
    inputSchema: { server: serverRef, user: z.string().describe("User ID, username or nickname"), role: z.string() }
}, "removeRole");

// ---- onboarding ----

const onboardingOption = z.object({
    id: z.string().optional().describe("Keep an existing answer (IDs come from get_onboarding). An answer with the same title as an existing one is kept too"),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    emoji: z.string().nullable().optional().describe('A Unicode emoji like "🌀", a server emoji\'s name, or <:name:id>. Empty or null removes it'),
    role_ids: z.array(z.string()).optional().describe("Role names or IDs members get when they pick this"),
    channel_ids: z.array(z.string()).optional().describe("Channel names or IDs members are added to when they pick this")
});

const onboardingPrompt = z.object({
    id: z.string().optional().describe("Keep an existing question. A question with the same title as an existing one is kept too"),
    type: z.enum(["multiple_choice", "dropdown"]).optional().describe("Default multiple_choice"),
    title: z.string().min(1),
    single_select: z.boolean().optional().describe("Members can pick only one answer. Default false"),
    required: z.boolean().optional().describe("Members must answer. Default false"),
    in_onboarding: z.boolean().optional().describe("Asked while joining; false only shows it in Channels & Roles. Default true"),
    options: z.array(onboardingOption).min(1).describe("The answers")
});

bridgeTool("get_onboarding", {
    title: "Get onboarding",
    description: "Shows a server's onboarding: whether it is on, its mode, default channels and the questions with their answers, "
        + "with role and channel names next to the IDs, plus how it stands against Discord's requirements",
    inputSchema: { server: serverRef },
    annotations: { readOnlyHint: true }
}, "getOnboarding");

bridgeTool("set_onboarding", {
    title: "Set onboarding",
    description: "Sets up a Community server's onboarding: the questions new members answer (each answer can give roles and channels), "
        + "the default channels and whether it is on. Anything left out stays as it is; prompts, when given, replace every question. "
        + "Turning it on needs a Community server and at least 7 default channels, with @everyone able to send messages in at least 5 of them",
    inputSchema: {
        server: serverRef,
        enabled: z.boolean().optional(),
        mode: z.enum(["default", "advanced"]).optional().describe("advanced also counts channels from questions toward the requirements"),
        default_channel_ids: z.array(z.string()).optional().describe("Channel names or IDs every new member is added to"),
        prompts: z.array(onboardingPrompt).optional().describe("Every question, in order")
    }
}, "setOnboarding");

// ---- extras ----

bridgeTool("create_invite", {
    title: "Create invite",
    description: "Creates an invite link to a channel",
    inputSchema: {
        channel: channelRef,
        server: optionalServer,
        max_age: z.number().int().min(0).max(604800).optional().describe("Seconds until it expires, 0 = never. Default 7 days"),
        max_uses: z.number().int().min(0).max(100).optional().describe("0 = unlimited"),
        temporary: z.boolean().optional().describe("Kick members who joined with it when they disconnect, unless they got a role")
    }
}, "createInvite");

bridgeTool("send_message", {
    title: "Send message",
    description: "Sends a message as the user in a server channel (never DMs). Long text is split at 2000 characters. Don't use this for spam",
    inputSchema: { channel: channelRef, server: optionalServer, content: z.string().min(1) }
}, "sendMessage");

bridgeTool("create_webhook", {
    title: "Create webhook",
    description: "Creates a webhook in a channel and returns its URL. Treat the URL like a password",
    inputSchema: { channel: channelRef, server: optionalServer, name: z.string().optional() }
}, "createWebhook");

bridgeTool("add_emoji", {
    title: "Add emoji",
    description: "Uploads a custom emoji (PNG, JPEG, GIF or WebP, max 256 KB) to a server",
    inputSchema: { server: serverRef, name: z.string().regex(/^\w{2,32}$/).describe("2-32 letters, numbers or underscores"), image: imageInput }
}, "createEmoji", { prepare: async args => ({ ...args, image: await toDataUri(args.image, 256 * 1024) }) });

bridgeTool("open_in_discord", {
    title: "Open in Discord",
    description: "Switches the Discord window to a server or channel so the user can see the result",
    inputSchema: { server: z.string().optional(), channel: z.string().optional() }
}, "open");

// ---- prompts ----

server.registerPrompt("build_server", {
    title: "Build a Discord server",
    description: "Designs and builds a complete Discord server from a short description",
    argsSchema: {
        idea: z.string().describe("What the server is for, e.g. 'chill gaming server for my friends with valorant and minecraft'"),
        name: z.string().optional().describe("Server name (leave empty to let the AI pick)")
    }
}, ({ idea, name }) => ({
    messages: [{
        role: "user",
        content: {
            type: "text",
            text: [
                `Build me a Discord server: ${idea}.`,
                name ? `Call it "${name}".` : "Pick a good name for it.",
                "Design a full layout first: roles highest-first with colours and sensible permissions (owner/admin, mods, members, bots if useful),",
                "categories with text and voice channels, private staff areas, a rules channel with real rules as a starter message, a welcome channel,",
                "and safe @everyone defaults (no admin, no mention everyone). Show me the plan briefly, then create it with create_server",
                "and the layout in a single call, then make a 7-day invite to the welcome channel and give me the link."
            ].join(" ")
        }
    }]
}));

server.registerPrompt("audit_server", {
    title: "Audit a server's permissions",
    description: "Exports a server and reviews its roles and permissions for security problems",
    argsSchema: { server: z.string().describe("Server name or ID") }
}, ({ server: target }) => ({
    messages: [{
        role: "user",
        content: {
            type: "text",
            text: [
                `Audit the Discord server "${target}". Use export_layout and get_server.`,
                "Look for risky permissions: ADMINISTRATOR or MANAGE_* on broad roles, @everyone able to mention everyone, create invites to private areas,",
                "staff channels visible to @everyone, roles that can manage roles above themselves, missing slowmode where it matters.",
                "Give me a short ranked list of problems with the exact fix for each. Don't change anything until I say so."
            ].join(" ")
        }
    }]
}));

await server.connect(new StdioServerTransport());
