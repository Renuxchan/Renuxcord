/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ApplicationCommandInputType } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import { jumpTo, whereLabel } from "@utils/renuxcordMessages";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, Modal, openModal, showToast, useEffect, useMemo, useReducer, useState } from "@webpack/common";

const cl = classNameFactory("rx-bookmarks-");
const KEY = "Renuxcord_bookmarks";

interface Bookmark {
    id: string;
    channelId: string;
    author: string;
    avatar?: string;
    content: string;
    attachments: number;
    sentAt: number;
    savedAt: number;
}

const settings = definePluginSettings({
    hoverButton: {
        type: OptionType.BOOLEAN,
        description: "Show a bookmark button when hovering messages",
        default: true
    }
});

let bookmarks: Bookmark[] = [];
const listeners = new Set<() => void>();

function persist() {
    void DataStore.set(KEY, bookmarks);
    listeners.forEach(l => l());
}

const isBookmarked = (id: string) => bookmarks.some(b => b.id === id);

function toggleBookmark(message: Message) {
    if (isBookmarked(message.id)) {
        bookmarks = bookmarks.filter(b => b.id !== message.id);
        persist();
        showToast({ text: "Bookmark removed" });
        return;
    }

    bookmarks.unshift({
        id: message.id,
        channelId: message.channel_id,
        author: message.author?.globalName || message.author?.username || "Unknown",
        avatar: message.author?.getAvatarURL?.(undefined, 64),
        content: (message.content ?? "").slice(0, 2000),
        attachments: message.attachments?.length ?? 0,
        sentAt: Number(new Date(message.timestamp as any)) || Date.now(),
        savedAt: Date.now()
    });
    persist();
    showToast({ text: "Bookmarked 🔖", variant: "success" });
}

const BookmarkIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M6 2h12a2 2 0 0 1 2 2v18l-8-4.5L4 22V4a2 2 0 0 1 2-2Zm0 2v14.6l6-3.4 6 3.4V4H6Z" />
    </svg>
);

const BookmarkFilledIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M6 2h12a2 2 0 0 1 2 2v18l-8-4.5L4 22V4a2 2 0 0 1 2-2Z" />
    </svg>
);

function BookmarkList({ close }: { close(): void; }) {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    const [query, setQuery] = useState("");

    useEffect(() => {
        listeners.add(rerender);
        return () => void listeners.delete(rerender);
    }, []);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? bookmarks.filter(b => `${b.author} ${b.content} ${whereLabel(b.channelId)}`.toLowerCase().includes(q)) : bookmarks;
    }, [query, bookmarks]);

    if (!bookmarks.length)
        return <div className={cl("empty")}>No bookmarks yet. Hover a message and click the bookmark icon, or right-click it.</div>;

    return (
        <>
            <input className={cl("search")} value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder={`Search ${bookmarks.length} bookmarks…`} autoFocus />
            <div className={cl("list")}>
                {shown.map(b => (
                    <div key={b.id} className={cl("row")}>
                        {b.avatar && <img className={cl("avatar")} src={b.avatar} alt="" />}
                        <div className={cl("body")}>
                            <div className={cl("meta")}>
                                <b>{b.author}</b>
                                <span>{whereLabel(b.channelId)}</span>
                                <span>{new Date(b.sentAt).toLocaleString()}</span>
                            </div>
                            <div className={cl("content")}>
                                {b.content || <i>(no text)</i>}
                                {b.attachments > 0 && <span className={cl("attach")}> 📎 {b.attachments}</span>}
                            </div>
                        </div>
                        <div className={cl("actions")}>
                            <Button size="small" onClick={() => { close(); jumpTo(b.channelId, b.id); }} disabled={!ChannelStore.getChannel(b.channelId)}>Jump</Button>
                            <Button size="small" variant="secondary" onClick={() => copyWithToast(b.content)}>Copy</Button>
                            <Button size="small" variant="dangerSecondary" onClick={() => { bookmarks = bookmarks.filter(x => x.id !== b.id); persist(); }}>Remove</Button>
                        </div>
                    </div>
                ))}
                {!shown.length && <div className={cl("empty")}>Nothing matches "{query}"</div>}
            </div>
        </>
    );
}

export function openBookmarks() {
    openModal(props => (
        <Modal {...props} size="lg" title="Bookmarks" subtitle="Messages you saved for later. Only stored on this computer">
            <BookmarkList close={props.onClose} />
        </Modal>
    ));
}

const messageContext: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message) return;
    const saved = isBookmarked(message.id);
    children.push(
        <Menu.MenuItem
            id="rx-bookmark"
            label={saved ? "Remove bookmark" : "Bookmark message"}
            icon={saved ? BookmarkFilledIcon : BookmarkIcon}
            action={() => toggleBookmark(message)}
        />
    );
};

export default definePlugin({
    name: "Bookmarks",
    description: "Save messages for later and find them again in one searchable list with jump-to-message (/bookmarks, right-click or hover button)",
    tags: ["Renuxcord", "Chat", "Organisation", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    contextMenus: {
        "message": messageContext
    },

    messagePopoverButton: {
        icon: BookmarkIcon,
        render(message) {
            if (!settings.store.hoverButton) return null;
            const saved = isBookmarked(message.id);
            return {
                label: saved ? "Remove bookmark" : "Bookmark",
                icon: saved ? BookmarkFilledIcon : BookmarkIcon,
                onClick: () => toggleBookmark(message)
            };
        }
    },

    commands: [{
        name: "bookmarks",
        description: "Open your saved messages",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: () => void openBookmarks()
    }],

    toolboxActions: {
        "Open bookmarks": openBookmarks
    },

    async start() {
        bookmarks = (await DataStore.get<Bookmark[]>(KEY)) ?? [];
        listeners.forEach(l => l());
    }
});
