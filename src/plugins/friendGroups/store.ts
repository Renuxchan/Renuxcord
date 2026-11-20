/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export interface FriendGroup {
    id: string;
    name: string;
    icon: string;
    color: string;
    collapsed: boolean;
    members: string[];
}

export const COLORS = ["#a78bfa", "#ec4899", "#f43f5e", "#f97316", "#facc15", "#4ade80", "#2dd4bf", "#38bdf8", "#6366f1", "#e879f9", "#94a3b8", "#ffffff"];
export const ICONS = ["⭐", "💖", "🎮", "🔥", "👑", "🏠", "📚", "💼", "🎵", "⚽", "🌙", "🍕", "🐱", "🌸", "💀", "🧠", "🛸", "🌊", "🍀", "💎", "🎨", "🗡️", "🎧", "☕"];
export const STARTER_GROUPS = [
    { name: "Besties", icon: "💖", color: "#ec4899" },
    { name: "Squad", icon: "🎮", color: "#a78bfa" },
    { name: "School", icon: "📚", color: "#38bdf8" },
    { name: "Family", icon: "🏠", color: "#4ade80" }
];

export const settings = definePluginSettings({
    groups: {
        type: OptionType.CUSTOM,
        default: [] as FriendGroup[]
    },
    tabName: {
        type: OptionType.STRING,
        description: "Name of the tab on the Friends page",
        default: "Groups",
        restartNeeded: true
    },
    sidebar: {
        type: OptionType.BOOLEAN,
        description: "Show your groups in the DM sidebar, under Friends",
        default: true
    },
    showOffline: {
        type: OptionType.BOOLEAN,
        description: "Show offline friends inside groups",
        default: true
    },
    chatIcons: {
        type: OptionType.BOOLEAN,
        description: "Show a person's group icon next to their name in chat",
        default: true
    }
});

export const getGroups = (): FriendGroup[] => settings.store.groups ?? [];

function save(groups: FriendGroup[]) {
    settings.store.groups = groups;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function createGroup(name: string, icon = "⭐", color = COLORS[0], members: string[] = []) {
    const group: FriendGroup = { id: newId(), name: name.trim() || "New group", icon, color, collapsed: false, members };
    save([...getGroups(), group]);
    return group;
}

export function updateGroup(id: string, patch: Partial<Omit<FriendGroup, "id">>) {
    save(getGroups().map(g => g.id === id ? { ...g, ...patch } : g));
}

export function deleteGroup(id: string) {
    save(getGroups().filter(g => g.id !== id));
}

export function moveGroup(id: string, by: number) {
    const groups = [...getGroups()];
    const from = groups.findIndex(g => g.id === id);
    const to = from + by;
    if (from === -1 || to < 0 || to >= groups.length) return;
    groups.splice(to, 0, ...groups.splice(from, 1));
    save(groups);
}

export function setCollapsedAll(collapsed: boolean) {
    save(getGroups().map(g => ({ ...g, collapsed })));
}

export function addToGroup(groupId: string, userId: string) {
    save(getGroups().map(g => g.id === groupId && !g.members.includes(userId) ? { ...g, members: [...g.members, userId] } : g));
}

export function removeFromGroup(groupId: string, userId: string) {
    save(getGroups().map(g => g.id === groupId ? { ...g, members: g.members.filter(m => m !== userId) } : g));
}

/** Moves a user into a group, taking them out of the group they were dragged from */
export function moveMember(userId: string, toGroupId: string | null, fromGroupId?: string | null) {
    save(getGroups().map(g => {
        let { members } = g;
        if (fromGroupId && g.id === fromGroupId && g.id !== toGroupId) members = members.filter(m => m !== userId);
        if (g.id === toGroupId && !members.includes(userId)) members = [...members, userId];
        return members === g.members ? g : { ...g, members };
    }));
}

export const groupsOf = (userId: string) => getGroups().filter(g => g.members.includes(userId));
