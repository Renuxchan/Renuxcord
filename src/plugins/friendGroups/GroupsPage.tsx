/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { getZone, timeIn } from "@plugins/friendTimes";
import { lastSeenText } from "@plugins/lastSeen";
import { classNameFactory } from "@utils/css";
import { openPrivateChannel, openUserProfile } from "@utils/discord";
import { User } from "@vencord/discord-types";
import { ContextMenuApi, Menu, PresenceStore, RelationshipStore, useEffect, useReducer, UserStore, useState } from "@webpack/common";
import type { DragEvent, MouseEvent } from "react";

import { openGroupEditor } from "./EditGroupModal";
import { addToGroup, createGroup, deleteGroup, FriendGroup, moveGroup, moveMember, removeFromGroup, setCollapsedAll, settings, STARTER_GROUPS, updateGroup } from "./store";

const cl = classNameFactory("rx-fg-");
const DRAG_TYPE = "application/x-renuxcord-friend";
const STATUS_ORDER: Record<string, number> = { online: 0, streaming: 0, idle: 1, dnd: 2, offline: 3, invisible: 3, unknown: 4 };

export const isOnline = (status: string) => status !== "offline" && status !== "invisible" && status !== "unknown";
export const statusOf = (id: string) => PresenceStore.getStatus(id) ?? "offline";
export const displayName = (id: string, user?: User) => RelationshipStore.getNickname(id) || user?.globalName || user?.username || "Unknown user";

export function activityText(id: string) {
    const activities: any[] = PresenceStore.getActivities(id) ?? [];
    const by = (type: number) => activities.find(a => a.type === type);
    const stream = by(1);
    const game = by(0);
    const listening = by(2);
    const watching = by(3);
    const custom = by(4);
    if (stream) return `🔴 Streaming ${stream.details || stream.name}`;
    if (game) return `🎮 Playing ${game.name}`;
    if (listening) return `🎵 ${listening.details ? `${listening.details}${listening.state ? ` · ${listening.state}` : ""}` : `Listening to ${listening.name}`}`;
    if (watching) return `📺 Watching ${watching.name}`;
    if (custom?.state) return `${custom.emoji?.id ? "" : custom.emoji?.name ? `${custom.emoji.name} ` : ""}${custom.state}`;
    return null;
}

export function sortMembers(ids: string[]) {
    return [...ids].sort((a, b) =>
        (STATUS_ORDER[statusOf(a)] ?? 4) - (STATUS_ORDER[statusOf(b)] ?? 4)
        || displayName(a, UserStore.getUser(a)).localeCompare(displayName(b, UserStore.getUser(b))));
}

/** Re-renders when presences or friends change, at most once a second */
function useLiveStores() {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const onChange = () => {
            timer ??= setTimeout(() => {
                timer = null;
                rerender();
            }, 1000);
        };
        const stores = [PresenceStore, RelationshipStore];
        stores.forEach(s => s.addChangeListener(onChange));
        return () => {
            stores.forEach(s => s.removeChangeListener(onChange));
            if (timer) clearTimeout(timer);
        };
    }, []);
}

export function writeDrag(e: DragEvent, userId: string, from: string | null) {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ userId, from }));
    e.dataTransfer.effectAllowed = "move";
}

export function readDrag(e: DragEvent): { userId: string; from: string | null; } | null {
    try {
        return JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
    } catch {
        return null;
    }
}

export const isFriendDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);

export function openGroupMenu(e: MouseEvent, group: FriendGroup, index: number, total: number) {
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu navId="rx-fg-group" onClose={ContextMenuApi.closeContextMenu} aria-label="Group options">
            <Menu.MenuItem id="rx-fg-edit" label="Edit name, icon and colour…" action={() => openGroupEditor(group)} />
            <Menu.MenuItem id="rx-fg-toggle" label={group.collapsed ? "Expand" : "Minimize"} action={() => updateGroup(group.id, { collapsed: !group.collapsed })} />
            <Menu.MenuItem id="rx-fg-up" label="Move up" disabled={index === 0} action={() => moveGroup(group.id, -1)} />
            <Menu.MenuItem id="rx-fg-down" label="Move down" disabled={index === total - 1} action={() => moveGroup(group.id, 1)} />
            <Menu.MenuItem id="rx-fg-new-group" label="New group…" action={() => openGroupEditor()} />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="rx-fg-delete" label="Delete group" color="danger" action={() => deleteGroup(group.id)} />
        </Menu.Menu>
    ));
}

export function openMemberMenu(e: MouseEvent, userId: string, groupId: string | null) {
    e.preventDefault();
    const groups = settings.store.groups ?? [];
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu navId="rx-fg-member" onClose={ContextMenuApi.closeContextMenu} aria-label="Friend options">
            <Menu.MenuItem id="rx-fg-message" label="Message" action={() => openPrivateChannel(userId)} />
            <Menu.MenuItem id="rx-fg-profile" label="Profile" action={() => openUserProfile(userId)} />
            <Menu.MenuSeparator />
            {groups.map(g => (
                <Menu.MenuCheckboxItem
                    id={`rx-fg-in-${g.id}`}
                    key={g.id}
                    label={`${g.icon} ${g.name}`}
                    checked={g.members.includes(userId)}
                    action={() => g.members.includes(userId) ? removeFromGroup(g.id, userId) : addToGroup(g.id, userId)}
                />
            ))}
            <Menu.MenuItem id="rx-fg-new-with" label="New group with them…" action={() => openGroupEditor(undefined, userId)} />
            {groupId && <Menu.MenuItem id="rx-fg-remove" label="Remove from this group" color="danger" action={() => removeFromGroup(groupId, userId)} />}
        </Menu.Menu>
    ));
}

export function Chevron({ open }: { open: boolean; }) {
    return (
        <svg className={cl("chevron", open && "chevron-open")} width="14" height="14" viewBox="0 0 24 24">
            <path fill="currentColor" d="M9.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 1 1-1.4-1.4l5.3-5.3-5.3-5.3a1 1 0 0 1 0-1.4Z" />
        </svg>
    );
}

function AvatarStack({ ids }: { ids: string[]; }) {
    const shown = sortMembers(ids).slice(0, 5);
    return (
        <div className={cl("stack")}>
            {shown.map(id => {
                const user = UserStore.getUser(id);
                return user ? <img key={id} className={cl("stack-avatar")} src={user.getAvatarURL(undefined, 32)} alt="" /> : null;
            })}
            {ids.length > 5 && <span className={cl("stack-more")}>+{ids.length - 5}</span>}
        </div>
    );
}

function FriendRow({ userId, groupId }: { userId: string; groupId: string | null; }) {
    const user = UserStore.getUser(userId);
    const status = statusOf(userId);
    const activity = activityText(userId);
    const zone = getZone(userId);
    const seen = isOnline(status) ? null : lastSeenText(userId);

    return (
        <div
            className={cl("row")}
            draggable
            onDragStart={e => writeDrag(e, userId, groupId)}
            onClick={() => openPrivateChannel(userId)}
            onContextMenu={e => openMemberMenu(e, userId, groupId)}
        >
            <div className={cl("avatar-wrap")}>
                {user ? <img className={cl("avatar")} src={user.getAvatarURL(undefined, 64)} alt="" /> : <div className={cl("avatar")} />}
                <span className={cl("status", `status-${status}`)} />
            </div>
            <div className={cl("row-text")}>
                <div className={cl("row-name")}>
                    {displayName(userId, user)}
                    {user && <span className={cl("row-username")}>{user.username}</span>}
                </div>
                <div className={cl("row-activity")}>
                    {activity ?? (isOnline(status) ? status === "dnd" ? "Do Not Disturb" : status === "idle" ? "Idle" : "Online" : seen ? `Last seen ${seen}` : "Offline")}
                    {zone && ` · 🕐 ${timeIn(zone)}`}
                </div>
            </div>
            <div className={cl("row-actions")}>
                <button className={cl("icon-btn")} aria-label="Message" title="Message" onClick={e => { e.stopPropagation(); openPrivateChannel(userId); }}>💬</button>
                <button className={cl("icon-btn")} aria-label="Groups" title="Groups" onClick={e => { e.stopPropagation(); openMemberMenu(e, userId, groupId); }}>📁</button>
            </div>
        </div>
    );
}

function DropZone({ groupId, className, style, children }: { groupId: string | null; className: string; style?: React.CSSProperties; children: React.ReactNode; }) {
    const [over, setOver] = useState(false);
    return (
        <section
            className={cl(className, over && "drop-target")}
            style={style}
            onDragOver={e => {
                if (!isFriendDrag(e)) return;
                e.preventDefault();
                if (!over) setOver(true);
            }}
            onDragLeave={e => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
            }}
            onDrop={e => {
                setOver(false);
                const data = readDrag(e);
                if (data && data.from !== groupId) moveMember(data.userId, groupId, data.from);
            }}
        >
            {children}
        </section>
    );
}

function GroupCard({ group, index, total, matches, searching }: { group: FriendGroup; index: number; total: number; matches(id: string): boolean; searching: boolean; }) {
    const { showOffline } = settings.store;
    const online = group.members.filter(id => isOnline(statusOf(id))).length;
    const visible = sortMembers(group.members.filter(id => (showOffline || isOnline(statusOf(id))) && matches(id)));
    const collapsed = group.collapsed && !searching;

    return (
        <DropZone groupId={group.id} className="group" style={{ "--rx-fg-color": group.color } as React.CSSProperties}>
            <header
                className={cl("group-header")}
                onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })}
                onContextMenu={e => openGroupMenu(e, group, index, total)}
            >
                <Chevron open={!collapsed} />
                <span className={cl("group-icon")}>{group.icon}</span>
                <span className={cl("group-name")}>{group.name}</span>
                <span className={cl("group-count")}>{online}/{group.members.length} online</span>
                {collapsed && group.members.length > 0 && <AvatarStack ids={group.members} />}
                <button className={cl("icon-btn", "group-more")} aria-label="Group options" onClick={e => { e.stopPropagation(); openGroupMenu(e, group, index, total); }}>⋯</button>
            </header>
            {!collapsed && (
                <div className={cl("members")}>
                    {visible.map(id => <FriendRow key={id} userId={id} groupId={group.id} />)}
                    {!visible.length && (
                        <div className={cl("hint")}>
                            {group.members.length ? "Nobody here right now" : "Drag friends here, or right-click anyone → Friend Groups"}
                        </div>
                    )}
                </div>
            )}
        </DropZone>
    );
}

function EmptyState() {
    return (
        <div className={cl("empty")}>
            <div className={cl("empty-art")}>📁</div>
            <div className={cl("empty-title")}>Sort your friends into groups</div>
            <div className={cl("empty-text")}>Folders with icons and colours that you can minimize. Drag friends between them, or right-click anyone in Discord → Friend Groups.</div>
            <div className={cl("starters")}>
                {STARTER_GROUPS.map(s => (
                    <button key={s.name} className={cl("starter")} style={{ "--rx-fg-color": s.color } as React.CSSProperties} onClick={() => createGroup(s.name, s.icon, s.color)}>
                        {s.icon} {s.name}
                    </button>
                ))}
                <button className={cl("starter")} onClick={() => openGroupEditor()}>＋ Custom…</button>
            </div>
        </div>
    );
}

export function GroupsPage({ inModal }: { inModal?: boolean; }) {
    const { groups = [], showOffline } = settings.use(["groups", "showOffline"]);
    useLiveStores();

    const [query, setQuery] = useState("");
    const [ungroupedOpen, setUngroupedOpen] = useState(true);

    const q = query.trim().toLowerCase();
    const matches = (id: string) => {
        if (!q) return true;
        const user = UserStore.getUser(id);
        return [displayName(id, user), user?.username ?? "", user?.globalName ?? ""].some(n => n.toLowerCase().includes(q));
    };

    const friends = RelationshipStore.getFriendIDs();
    const grouped = new Set(groups.flatMap(g => g.members));
    const ungrouped = sortMembers(friends.filter(id => !grouped.has(id) && matches(id) && (showOffline || isOnline(statusOf(id)))));
    const allCollapsed = groups.length > 0 && groups.every(g => g.collapsed);

    return (
        <div className={cl("page", inModal && "page-modal")}>
            <div className={cl("toolbar")}>
                <div className={cl("title")}>📁 Friend Groups</div>
                <span className={cl("subtitle")}>{groups.length} group{groups.length === 1 ? "" : "s"} · {friends.length} friends</span>
                <div className={cl("spacer")} />
                <input className={cl("search")} value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Search friends" />
                {groups.length > 0 && (
                    <Button size="small" variant="secondary" onClick={() => setCollapsedAll(!allCollapsed)}>
                        {allCollapsed ? "Expand all" : "Minimize all"}
                    </Button>
                )}
                <Button size="small" onClick={() => openGroupEditor()}>New group</Button>
            </div>

            <div className={cl("list")}>
                {groups.length === 0 && <EmptyState />}

                {groups.map((g, i) => <GroupCard key={g.id} group={g} index={i} total={groups.length} matches={matches} searching={!!q} />)}

                <DropZone groupId={null} className="group ungrouped">
                    <header className={cl("group-header")} onClick={() => setUngroupedOpen(o => !o)}>
                        <Chevron open={ungroupedOpen || !!q} />
                        <span className={cl("group-icon")}>👥</span>
                        <span className={cl("group-name")}>Not in a group</span>
                        <span className={cl("group-count")}>{ungrouped.length}</span>
                    </header>
                    {(ungroupedOpen || !!q) && (
                        <div className={cl("members")}>
                            {ungrouped.map(id => <FriendRow key={id} userId={id} groupId={null} />)}
                            {!ungrouped.length && <div className={cl("hint")}>{q ? "No matches" : "Everyone is sorted 🎉"}</div>}
                        </div>
                    )}
                </DropZone>
            </div>
        </div>
    );
}
