/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { lastSeenText } from "@plugins/lastSeen";
import { classNameFactory } from "@utils/css";
import { openPrivateChannel } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { ChannelStore, PresenceStore, ReadStateStore, RelationshipStore, SelectedChannelStore, useMemo, UserStore, useState, useStateFromStores } from "@webpack/common";
import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from "react";

import { openGroupEditor } from "./EditGroupModal";
import { activityText, Chevron, displayName, isFriendDrag, isOnline, openGroupMenu, openMemberMenu, readDrag, sortMembers, statusOf, writeDrag } from "./GroupsPage";
import { FriendGroup, moveMember, settings, updateGroup } from "./store";

const cl = classNameFactory("rx-fgs-");
const logger = new Logger("FriendGroups");

// Discord's DM list only learns these heights through our getRowHeight patch.
// If that patch ever stops applying, every row gets Discord's default 40px, so we draw at 40px too
const HEADER_HEIGHT = 32;
const FRIEND_HEIGHT = 44;
const FALLBACK_HEIGHT = 40;
let heightsPatched = false;

const KEY = "rx-fg-";

/** Called from Discord's DM list for each row above Direct Messages. Returns null for Discord's own rows */
export function rowHeight(row: any): number | null {
    const key = row?.key;
    if (typeof key !== "string" || !key.startsWith(KEY)) return null;
    heightsPatched = true;
    return key.startsWith(`${KEY}f-`) ? FRIEND_HEIGHT : HEADER_HEIGHT;
}

const heightOf = (designed: number) => heightsPatched ? designed : FALLBACK_HEIGHT;

/** Which rows to show, as one string, so the sidebar only re-renders when the rows actually change */
function layoutOf(groups: FriendGroup[], showOffline: boolean) {
    if (!groups.length) return "new";
    const rows: string[] = [];
    for (const group of groups) {
        rows.push(`h:${group.id}`);
        if (group.collapsed) continue;
        for (const id of sortMembers(group.members.filter(m => showOffline || isOnline(statusOf(m)))))
            rows.push(`f:${group.id}:${id}`);
    }
    return rows.join(",");
}

function hash(text: string) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return `${(h >>> 0).toString(36)}.${text.length}`;
}

const onEnter = (action: () => void) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    action();
};

/** Drop a dragged friend here to move them into this group */
function useDrop(groupId: string) {
    const [over, setOver] = useState(false);
    return {
        over,
        handlers: {
            onDragOver(e: DragEvent) {
                if (!isFriendDrag(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (!over) setOver(true);
            },
            onDragLeave(e: DragEvent) {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
            },
            onDrop(e: DragEvent) {
                setOver(false);
                const data = readDrag(e);
                if (data && data.from !== groupId) moveMember(data.userId, groupId, data.from);
            }
        }
    };
}

function MiniStack({ ids }: { ids: string[]; }) {
    return (
        <span className={cl("stack")}>
            {sortMembers(ids).slice(0, 3).map(id => {
                const user = UserStore.getUser(id);
                return user ? <img key={id} src={user.getAvatarURL(undefined, 32)} alt="" /> : null;
            })}
        </span>
    );
}

const Header = ErrorBoundary.wrap(({ groupId }: { groupId: string; }) => {
    const { groups = [] } = settings.use(["groups"]);
    const index = groups.findIndex(g => g.id === groupId);
    const group: FriendGroup | undefined = groups[index];
    const online = useStateFromStores([PresenceStore], () => group?.members.filter(id => isOnline(statusOf(id))).length ?? 0, [group]);
    const { over, handlers } = useDrop(groupId);
    if (!group) return null;

    const toggle = () => updateGroup(group.id, { collapsed: !group.collapsed });
    return (
        <li
            className={cl("header", over && "drop")}
            style={{ "--rx-fg-color": group.color, height: heightOf(HEADER_HEIGHT) } as CSSProperties}
            role="button"
            tabIndex={0}
            aria-expanded={!group.collapsed}
            onClick={toggle}
            onKeyDown={onEnter(toggle)}
            onContextMenu={e => openGroupMenu(e, group, index, groups.length)}
            {...handlers}
        >
            <Chevron open={!group.collapsed} />
            <span className={cl("icon")}>{group.icon}</span>
            <span className={cl("name")}>{group.name}</span>
            <span className={cl("count")} title={`${online} of ${group.members.length} online`}>{online}/{group.members.length}</span>
            {group.collapsed && group.members.length > 0 && <MiniStack ids={group.members} />}
            <button
                className={cl("more")}
                aria-label="Group options"
                onClick={e => {
                    e.stopPropagation();
                    openGroupMenu(e, group, index, groups.length);
                }}
            >
                ⋯
            </button>
        </li>
    );
}, { noop: true });

const Friend = ErrorBoundary.wrap(({ groupId, userId }: { groupId: string; userId: string; }) => {
    const { groups = [] } = settings.use(["groups"]);
    const color = groups.find(g => g.id === groupId)?.color;
    const user = useStateFromStores([UserStore], () => UserStore.getUser(userId), [userId]);
    const status = useStateFromStores([PresenceStore], () => statusOf(userId), [userId]);
    const activity = useStateFromStores([PresenceStore], () => activityText(userId), [userId]);
    const dmId = useStateFromStores([ChannelStore], () => ChannelStore.getDMFromUserId(userId), [userId]);
    const selected = useStateFromStores([SelectedChannelStore], () => dmId != null && SelectedChannelStore.getChannelId() === dmId, [dmId]);
    const unread = useStateFromStores([ReadStateStore], () => dmId ? ReadStateStore.getMentionCount(dmId) : 0, [dmId]);
    const { over, handlers } = useDrop(groupId);

    const online = isOnline(status);
    const seen = online ? null : lastSeenText(userId);
    const sub = activity ?? (seen ? `Last seen ${seen}` : null);
    const name = displayName(userId, user);
    const open = () => openPrivateChannel(userId);

    return (
        <li
            className={cl("friend", selected && "selected", unread > 0 && "unread", !online && "offline", over && "drop")}
            style={{ "--rx-fg-color": color, height: heightOf(FRIEND_HEIGHT) } as CSSProperties}
            role="button"
            tabIndex={0}
            aria-label={`${name}, message`}
            draggable
            onDragStart={e => writeDrag(e, userId, groupId)}
            onClick={open}
            onKeyDown={onEnter(open)}
            onContextMenu={e => openMemberMenu(e, userId, groupId)}
            {...handlers}
        >
            <span className={cl("avatar-wrap")}>
                {user ? <img className={cl("avatar")} src={user.getAvatarURL(undefined, 64)} alt="" /> : <span className={cl("avatar")} />}
                <span className={`rx-fg-status rx-fg-status-${status} ${cl("status")}`} />
            </span>
            <span className={cl("text")}>
                <span className={cl("name")}>{name}</span>
                {sub && <span className={cl("sub")}>{sub}</span>}
            </span>
            {unread > 0 && <span className={cl("badge")}>{unread > 99 ? "99+" : unread}</span>}
        </li>
    );
}, { noop: true });

const NewGroup = ErrorBoundary.wrap(() => {
    const open = () => openGroupEditor();
    return (
        <li className={cl("new")} style={{ height: heightOf(HEADER_HEIGHT) }} role="button" tabIndex={0} onClick={open} onKeyDown={onEnter(open)}>
            <span className={cl("icon")}>📁</span>
            <span className={cl("name")}>New friend group</span>
        </li>
    );
}, { noop: true });

function buildRows(layout: string): ReactNode[] {
    return layout.split(",").map(row => {
        const [kind, groupId, userId] = row.split(":");
        if (kind === "h") return <Header key={`${KEY}h-${groupId}`} groupId={groupId} />;
        if (kind === "f") return <Friend key={`${KEY}f-${groupId}-${userId}`} groupId={groupId} userId={userId} />;
        return <NewGroup key={`${KEY}new`} />;
    });
}

const EMPTY = { version: "", rows: [] as ReactNode[] };

/** Patched into the top of Discord's DM sidebar. It runs inside Discord's own component, so it must never throw */
export function useSidebarRows() {
    const { groups = [], showOffline, sidebar } = settings.use(["groups", "showOffline", "sidebar"]);
    const layout = useStateFromStores([PresenceStore, RelationshipStore], () => {
        try {
            return sidebar ? layoutOf(groups, showOffline) : "";
        } catch (e) {
            logger.error("Couldn't lay out the sidebar groups", e);
            return "";
        }
    }, [groups, showOffline, sidebar]);

    return useMemo(() => {
        try {
            return layout ? { version: hash(layout), rows: buildRows(layout) } : EMPTY;
        } catch (e) {
            logger.error("Couldn't build the sidebar groups", e);
            return EMPTY;
        }
    }, [layout]);
}
