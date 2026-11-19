/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { Button } from "@components/Button";
import { rest, sleep } from "@plugins/renuxBridge/discord";
import { RenuxDevs } from "@utils/renuxcord";
import { whereLabel } from "@utils/renuxcordMessages";
import definePlugin, { PluginNative } from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu, Modal, openModal, showToast, useRef, useState } from "@webpack/common";

import type { FileToSave } from "./native";

const Native = VencordNative.pluginHelpers.MediaDownloader as PluginNative<typeof import("./native")>;

type Kind = "images" | "videos" | "files";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i;
const VIDEO = /\.(mp4|mov|webm|mkv|avi|m4v)$/i;

const kindOf = (name: string, contentType?: string): Kind =>
    contentType?.startsWith("image/") || IMAGE.test(name) ? "images" : contentType?.startsWith("video/") || VIDEO.test(name) ? "videos" : "files";

function folderName(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return channelId;
    if (!channel.guild_id) return `DM - ${channel.name || channel.rawRecipients?.map(r => r.username).join(", ") || channelId}`;
    return `${GuildStore.getGuild(channel.guild_id)?.name ?? "Server"} - ${channel.name}`;
}

interface RawAttachment { id: string; filename: string; url: string; content_type?: string; }
interface RawEmbed { type?: string; image?: { url?: string; proxy_url?: string; proxyURL?: string; }; video?: { url?: string; proxy_url?: string; proxyURL?: string; }; thumbnail?: { url?: string; proxy_url?: string; proxyURL?: string; }; }
interface RawMsg { id: string; timestamp?: string; attachments?: RawAttachment[]; embeds?: RawEmbed[]; }

function mediaOf(m: RawMsg, kinds: Set<Kind>): FileToSave[] {
    const date = (m.timestamp ? new Date(m.timestamp) : new Date()).toISOString().slice(0, 10);
    const out: FileToSave[] = [];
    for (const a of m.attachments ?? []) {
        if (kinds.has(kindOf(a.filename, a.content_type))) out.push({ url: a.url, name: `${date} ${a.filename}` });
    }
    for (const [i, e] of (m.embeds ?? []).entries()) {
        const media = e.video ?? e.image ?? (e.type === "image" || e.type === "gifv" ? e.thumbnail : undefined);
        const url = media?.proxy_url ?? media?.proxyURL;
        if (!url) continue;
        const ext = (/\.(\w{3,4})(?:\?|#|$)/.exec(url.split("?")[0])?.[1] ?? (e.video ? "mp4" : "png")).toLowerCase();
        const name = `${date} embed-${m.id}-${i}.${ext}`;
        if (kinds.has(kindOf(name))) out.push({ url, name });
    }
    return out;
}

async function save(channelId: string, files: FileToSave[]) {
    const result = await Native.saveFiles(folderName(channelId), files);
    return result;
}

function announce(result: { saved: number; failed: number; bytes: number; dir: string; }) {
    showNotification({
        title: `📥 Saved ${result.saved} file${result.saved === 1 ? "" : "s"}${result.failed ? ` (${result.failed} failed)` : ""}`,
        body: `${(result.bytes / 1048576).toFixed(1)} MB in Downloads › Renuxcord. Click to open the folder.`,
        onClick: () => Native.openFolder(result.dir)
    });
}

function ChannelDownloader({ channel, close }: { channel: Channel; close(): void; }) {
    const [limit, setLimit] = useState(500);
    const [kinds, setKinds] = useState<Set<Kind>>(new Set(["images", "videos", "files"]));
    const [status, setStatus] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const cancelled = useRef(false);

    const toggleKind = (k: Kind) => {
        const next = new Set(kinds);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        setKinds(next);
    };

    const start = async () => {
        setRunning(true);
        cancelled.current = false;
        let scanned = 0;
        let before: string | undefined;
        const totals = { saved: 0, failed: 0, bytes: 0, dir: "" };

        try {
            while (scanned < limit && !cancelled.current) {
                const batch: RawMsg[] = await rest("get", `/channels/${channel.id}/messages`, undefined, { limit: Math.min(100, limit - scanned), ...before ? { before } : {} });
                if (!batch?.length) break;
                scanned += batch.length;
                before = batch[batch.length - 1].id;

                const files = batch.flatMap(m => mediaOf(m, kinds));
                if (files.length) {
                    setStatus(`Scanned ${scanned} messages · saving ${files.length} more…`);
                    const r = await save(channel.id, files);
                    totals.saved += r.saved;
                    totals.failed += r.failed;
                    totals.bytes += r.bytes;
                    totals.dir = r.dir;
                }
                setStatus(`Scanned ${scanned} messages · ${totals.saved} files saved`);
                if (batch.length < 100) break;
                await sleep(700);
            }
            totals.dir ||= await Native.folderFor(folderName(channel.id));
            announce(totals);
            close();
        } catch (err) {
            setStatus(`Stopped: ${err instanceof Error ? err.message : String(err)}`);
            setRunning(false);
        }
    };

    const chip = (active: boolean) => ({
        padding: "6px 12px", borderRadius: 999, border: "none", cursor: running ? "default" : "pointer", fontWeight: 600,
        background: active ? "var(--brand-500, #5865f2)" : "var(--background-mod-strong, rgb(255 255 255 / 10%))",
        color: active ? "#fff" : "var(--text-default, var(--text-normal))"
    });

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, color: "var(--text-default, var(--text-normal))" }}>
            <div>
                <b>How far back</b>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {[100, 500, 1000, 5000, 25000].map(n => (
                        <button key={n} disabled={running} style={chip(limit === n)} onClick={() => setLimit(n)}>Last {n.toLocaleString()} messages</button>
                    ))}
                </div>
            </div>
            <div>
                <b>What to save</b>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    {(["images", "videos", "files"] as Kind[]).map(k => (
                        <button key={k} disabled={running} style={chip(kinds.has(k))} onClick={() => toggleKind(k)}>{k === "images" ? "🖼️ Images" : k === "videos" ? "🎬 Videos" : "📄 Other files"}</button>
                    ))}
                </div>
            </div>
            <div style={{ color: "var(--text-muted)" }}>{status ?? `Files go to Downloads › Renuxcord › ${folderName(channel.id)}`}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                {running
                    ? <Button variant="dangerSecondary" onClick={() => { cancelled.current = true; }}>Stop</Button>
                    : <Button disabled={!kinds.size} onClick={start}>Start download</Button>}
            </div>
        </div>
    );
}

const openChannelDownloader = (channel: Channel) => openModal(props => (
    <Modal {...props} size="md" title="📥 Download channel media" subtitle={whereLabel(channel.id)}>
        <ChannelDownloader channel={channel} close={props.onClose} />
    </Modal>
));

const messageContext: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message) return;
    const files = mediaOf(message as unknown as RawMsg, new Set(["images", "videos", "files"]));
    if (!files.length) return;
    children.push(
        <Menu.MenuItem
            id="rx-md-message"
            label={`Download ${files.length === 1 ? "this file" : `all ${files.length} files`}`}
            action={async () => {
                showToast({ text: "📥 Downloading…" });
                announce(await save(message.channel_id, files));
            }}
        />
    );
};

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel) return;
    children.push(<Menu.MenuItem id="rx-md-channel" label="Download all media…" action={() => openChannelDownloader(channel)} />);
};

export default definePlugin({
    name: "MediaDownloader",
    description: "Save every image, video and file from a message or a whole channel in one go (right-click → Download). Files land in Downloads › Renuxcord, sorted by server and channel",
    tags: ["Renuxcord", "Media", "Utility"],
    authors: [RenuxDevs.Larpbase],

    contextMenus: {
        "message": messageContext,
        "channel-context": channelContext,
        "thread-context": channelContext,
        "gdm-context": channelContext,
        "user-context"(children, { channel }: { channel?: Channel; }) {
            if (channel && !channel.guild_id) channelContext(children, { channel });
        }
    }
});
