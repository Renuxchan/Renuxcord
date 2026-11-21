/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { rest, sleep } from "@plugins/renuxBridge/discord";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin from "@utils/types";
import { saveFile } from "@utils/web";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu, showToast, UserStore } from "@webpack/common";

type Format = "html" | "txt" | "json";

interface Exported {
    id: string;
    author: { id: string; name: string; avatar: string | null; bot: boolean; };
    timestamp: string;
    edited: string | null;
    content: string;
    attachments: { name: string; url: string; image: boolean; }[];
    embeds: { title?: string; description?: string; url?: string; }[];
    replyTo: string | null;
}

let busy = false;
let stopRequested = false;
let progress = 0;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function avatarUrl(a: any) {
    if (a?.avatar) return `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.png?size=64`;
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(a?.id ?? 0) >> 22n) % 6n)}.png`;
}

function simplify(m: any): Exported {
    return {
        id: m.id,
        author: { id: m.author?.id, name: m.author?.global_name || m.author?.username || "Unknown", avatar: avatarUrl(m.author), bot: !!m.author?.bot },
        timestamp: m.timestamp,
        edited: m.edited_timestamp ?? null,
        content: m.content ?? "",
        attachments: (m.attachments ?? []).map((a: any) => ({ name: a.filename, url: a.url, image: /^image\//.test(a.content_type ?? "") })),
        embeds: (m.embeds ?? []).map((e: any) => ({ title: e.title, description: e.description, url: e.url })).filter((e: any) => e.title || e.description || e.url),
        replyTo: m.message_reference?.message_id ?? null
    };
}

/** The whole history (Discord hands it over newest first, 100 at a time). Stops early at `limit` or when asked to */
async function fetchHistory(channelId: string, limit = Infinity) {
    const out: Exported[] = [];
    let before: string | undefined;
    while (out.length < limit && !stopRequested) {
        const batch: any[] = await rest("get", `/channels/${channelId}/messages`, undefined, { limit: Math.min(100, limit - out.length), ...(before ? { before } : {}) });
        if (!batch?.length) break;
        for (const m of batch) out.push(simplify(m));
        progress = out.length;
        before = batch[batch.length - 1].id;
        if (out.length % 1000 === 0) showToast({ text: `Exporting… ${out.length.toLocaleString()} messages so far` });
        if (batch.length < 100) break;
        await sleep(450);
    }
    return out.reverse();
}

function mentions(text: string) {
    return text.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => `<span class="mention">@${esc(UserStore.getUser(id)?.username ?? "user")}</span>`)
        .replace(/&lt;#(\d+)&gt;/g, (_, id) => `<span class="mention">#${esc(ChannelStore.getChannel(id)?.name ?? "channel")}</span>`)
        .replace(/&lt;a?:(\w+):\d+&gt;/g, ":$1:");
}

function markdown(text: string) {
    let html = esc(text);
    html = html.replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_, code) => `<pre>${code}</pre>`);
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/__([^_]+)__/g, "<u>$1</u>").replace(/~~([^~]+)~~/g, "<s>$1</s>");
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    return mentions(html).replace(/\n/g, "<br>");
}

function where(channel: Channel) {
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id)?.name : null;
    const name = channel.name || (channel.recipients?.length ? channel.recipients.map(id => UserStore.getUser(id)?.username ?? id).join(", ") : "DM");
    return { guild, name };
}

// The exporters return chunks, so a chat with hundreds of thousands of messages never becomes one giant string
function toHtml(channel: Channel, messages: Exported[]) {
    const { guild, name } = where(channel);
    const byId = new Map(messages.map(m => [m.id, m]));
    const rows = messages.map(m => {
        const reply = m.replyTo && byId.get(m.replyTo);
        return `<div class="msg">
<img class="av" src="${esc(m.author.avatar ?? "")}" alt="">
<div class="body">
${reply ? `<div class="reply">↪ <b>${esc(reply.author.name)}</b> ${esc(reply.content.slice(0, 120))}</div>` : ""}
<div class="head"><b>${esc(m.author.name)}</b>${m.author.bot ? ' <span class="bot">BOT</span>' : ""} <span class="time">${new Date(m.timestamp).toLocaleString()}${m.edited ? " (edited)" : ""}</span></div>
<div class="text">${markdown(m.content)}</div>
${m.attachments.map(a => a.image ? `<a href="${esc(a.url)}"><img class="att" src="${esc(a.url)}" alt="${esc(a.name)}"></a>` : `<div class="file">📎 <a href="${esc(a.url)}">${esc(a.name)}</a></div>`).join("")}
${m.embeds.map(e => `<div class="embed">${e.title ? `<b>${esc(e.title)}</b>` : ""}${e.description ? `<div>${markdown(e.description)}</div>` : ""}${e.url ? `<a href="${esc(e.url)}">${esc(e.url)}</a>` : ""}</div>`).join("")}
</div></div>\n`;
    });

    const head = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(guild ? `${guild} · #${name}` : name)}</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#16161f;color:#dcdde6;font:15px/1.45 "gg sans","Segoe UI",system-ui,sans-serif}
header{position:sticky;top:0;background:#1d1d29ee;backdrop-filter:blur(6px);padding:16px 24px;border-bottom:1px solid #2c2c3d}
h1{margin:0;font-size:20px;color:#fff}header p{margin:4px 0 0;color:#9a9cb0;font-size:13px}
main{max-width:980px;margin:0 auto;padding:12px 16px 48px}.msg{display:flex;gap:14px;padding:8px 8px;border-radius:8px}.msg:hover{background:#1e1e2a}
.av{width:40px;height:40px;border-radius:50%;flex-shrink:0;background:#2c2c3d}.body{min-width:0;flex:1}.head b{color:#fff}.time{color:#7f8196;font-size:12px;margin-left:6px}
.bot{background:#5865f2;color:#fff;font-size:10px;font-weight:700;padding:1px 4px;border-radius:3px}.text{white-space:normal;overflow-wrap:anywhere}
pre{background:#11111a;border:1px solid #2c2c3d;border-radius:6px;padding:8px 10px;white-space:pre-wrap}code{background:#11111a;border-radius:4px;padding:1px 4px}
a{color:#a78bfa}.mention{background:#a78bfa33;color:#c4b5fd;border-radius:3px;padding:0 2px}.att{max-width:420px;max-height:320px;border-radius:8px;margin-top:6px;display:block}
.file{margin-top:4px}.embed{border-left:4px solid #a78bfa;background:#1e1e2a;border-radius:4px;padding:8px 10px;margin-top:6px;max-width:520px}
.reply{font-size:13px;color:#9a9cb0;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}footer{text-align:center;color:#7f8196;font-size:12px;padding:24px}
</style></head><body>
<header><h1>${esc(guild ? `#${name}` : name)}</h1><p>${guild ? `${esc(guild)} · ` : ""}${messages.length} messages · exported ${new Date().toLocaleString()} with Renuxcord</p></header>
<main>
`;
    return [head, ...rows, "</main><footer>Exported with Renuxcord ChatExporter</footer></body></html>"];
}

function toText(channel: Channel, messages: Exported[]) {
    const { guild, name } = where(channel);
    const lines = messages.map(m => {
        const extra = [...m.attachments.map(a => `[file] ${a.url}`), ...m.embeds.map(e => `[embed] ${e.title ?? e.url ?? ""}`)];
        return `[${new Date(m.timestamp).toLocaleString()}] ${m.author.name}: ${m.content}${extra.length ? `\n    ${extra.join("\n    ")}` : ""}`;
    });
    return [`${guild ? `${guild} / #${name}` : name}\n${messages.length} messages, exported ${new Date().toLocaleString()}\n\n`, ...lines.map(l => `${l}\n`)];
}

function toJson(channel: Channel, messages: Exported[]) {
    const { guild, name } = where(channel);
    const head = JSON.stringify({ server: guild, channel: name, channelId: channel.id, exportedAt: new Date().toISOString() }, null, 2).replace(/\n}$/, ',\n  "messages": [\n');
    return [head, ...messages.map((m, i) => `    ${JSON.stringify(m)}${i < messages.length - 1 ? "," : ""}\n`), "  ]\n}\n"];
}

/** Exports the whole chat, or only the newest `limit` messages */
export async function exportChat(channel: Channel, format: Format, limit?: number) {
    if (busy) return showToast({ text: `An export is already running (${progress.toLocaleString()} messages so far). Right-click a channel › Export chat › Stop to end it`, variant: "critical" });
    busy = true;
    stopRequested = false;
    progress = 0;
    try {
        const max = limit && limit > 0 ? limit : Infinity;
        showToast({ text: max === Infinity ? "Exporting the whole chat… big chats take a few minutes" : `Exporting the newest ${max.toLocaleString()} messages…` });
        const messages = await fetchHistory(channel.id, max);
        const { guild, name } = where(channel);
        const base = `${guild ? `${guild}-` : ""}${name}-${new Date().toISOString().slice(0, 10)}`.replace(/[^\w.-]+/g, "_").slice(0, 120);

        const parts = format === "json" ? toJson(channel, messages) : format === "txt" ? toText(channel, messages) : toHtml(channel, messages);
        const type = format === "json" ? "application/json" : format === "txt" ? "text/plain" : "text/html";

        saveFile(new File(parts, `${base}.${format}`, { type }));
        showToast({
            text: `✅ Exported ${messages.length.toLocaleString()} messages as ${format.toUpperCase()}${stopRequested ? " (stopped early: the newest ones)" : ""}`,
            variant: "success"
        });
        return messages.length;
    } catch (err) {
        showToast({ text: `Export failed: ${err instanceof Error ? err.message : String(err)}`, variant: "critical" });
    } finally {
        busy = false;
        stopRequested = false;
    }
}

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel) return;
    children.push(
        <Menu.MenuItem id="rx-export" label="Export chat">
            {busy
                ? <Menu.MenuItem id="rx-export-stop" label={`Stop the export (${progress.toLocaleString()} so far)`} color="danger" action={() => { stopRequested = true; }} />
                : [
                    <Menu.MenuItem key="html" id="rx-export-html" label="As a web page (HTML)" action={() => exportChat(channel, "html")} />,
                    <Menu.MenuItem key="txt" id="rx-export-txt" label="As text (TXT)" action={() => exportChat(channel, "txt")} />,
                    <Menu.MenuItem key="json" id="rx-export-json" label="As data (JSON)" action={() => exportChat(channel, "json")} />
                ]}
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "ChatExporter",
    description: "Save a whole chat, every message, as a styled HTML page, plain text or JSON (/export, or right-click a channel → Export chat)",
    tags: ["Renuxcord", "Chat", "Utility"],
    authors: [RenuxDevs.Larpbase],

    contextMenus: {
        "channel-context": channelContext,
        "gdm-context": channelContext,
        "user-context": (children, { channel }: { channel?: Channel; }) => channel && channelContext(children, { channel })
    },

    commands: [{
        name: "export",
        description: "Save this chat to a file",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "format", description: "html (default), txt or json", type: ApplicationCommandOptionType.STRING, required: false },
            { name: "messages", description: "Only the newest this many (leave it out for the whole chat)", type: ApplicationCommandOptionType.INTEGER, required: false }
        ],
        async execute(args, ctx) {
            const format = String(findOption(args, "format", "html")).toLowerCase() as Format;
            if (!["html", "txt", "json"].includes(format)) return void sendBotMessage(ctx.channel.id, { content: "❌ Format has to be html, txt or json." });
            await exportChat(ctx.channel, format, findOption<number>(args, "messages"));
        }
    }]
});
