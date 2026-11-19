/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { MessageDecorationProps } from "@api/MessageDecorations";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { Menu, Modal, openModal, TextInput, UserStore, useState } from "@webpack/common";

const settings = definePluginSettings({
    zones: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>
    },
    showInChat: {
        type: OptionType.BOOLEAN,
        description: "Show the sender's local time next to their messages",
        default: true
    },
    clock: {
        type: OptionType.SELECT,
        description: "Clock style",
        options: [
            { label: "Your system's default", value: "auto", default: true },
            { label: "12-hour (3:42 PM)", value: "12" },
            { label: "24-hour (15:42)", value: "24" }
        ]
    }
});

const ALL_ZONES: string[] = (() => {
    try {
        return (Intl as any).supportedValuesOf("timeZone");
    } catch {
        return ["UTC"];
    }
})();

/** The time zone set for a user, if FriendTimes is on */
export function getZone(userId: string): string | undefined {
    if (!isPluginEnabled("FriendTimes")) return undefined;
    return settings.store.zones?.[userId];
}

export function timeIn(zone: string, date = new Date()) {
    const { clock } = settings.store;
    try {
        return new Intl.DateTimeFormat(undefined, {
            timeZone: zone,
            hour: "numeric",
            minute: "2-digit",
            ...(clock === "auto" ? {} : { hour12: clock === "12" })
        }).format(date);
    } catch {
        return "?";
    }
}

function setZone(userId: string, zone: string | null) {
    const zones = { ...settings.store.zones };
    if (zone) zones[userId] = zone;
    else delete zones[userId];
    settings.store.zones = zones;
}

function openZonePicker(user: User) {
    openModal(props => {
        function Picker() {
            const [query, setQuery] = useState("");
            const q = query.trim().toLowerCase().replace(/\s+/g, "_");
            const matches = (q ? ALL_ZONES.filter(z => z.toLowerCase().includes(q)) : ALL_ZONES).slice(0, 60);
            const current = settings.store.zones?.[user.id];

            return (
                <Modal
                    {...props}
                    title={`${user.globalName || user.username}'s time zone`}
                    subtitle="Type a city or region, e.g. london, new york, dubai, tokyo"
                    actions={[
                        ...(current ? [{ text: "Clear", variant: "secondary", onClick: () => { setZone(user.id, null); props.onClose(); } }] : []),
                        { text: "Close", variant: "secondary", onClick: props.onClose }
                    ]}
                >
                    <TextInput value={query} onChange={setQuery} placeholder="Search time zones" autoFocus />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8, maxHeight: 360, overflowY: "auto" }}>
                        {matches.map(z => (
                            <button
                                key={z}
                                onClick={() => { setZone(user.id, z); props.onClose(); }}
                                style={{
                                    display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 6, border: "none", cursor: "pointer", textAlign: "left",
                                    background: z === current ? "var(--background-mod-strong, rgb(255 255 255 / 12%))" : "transparent",
                                    color: "var(--text-default, var(--text-normal))"
                                }}
                            >
                                <span>{z.replace(/_/g, " ")}</span>
                                <span style={{ color: "var(--text-muted)" }}>{timeIn(z)}</span>
                            </button>
                        ))}
                    </div>
                </Modal>
            );
        }
        return <Picker />;
    });
}

const ChatTime = ErrorBoundary.wrap(({ userId, timestamp }: { userId?: string; timestamp?: any; }) => {
    if (!userId || !settings.store.showInChat) return null;
    const zone = settings.store.zones?.[userId];
    if (!zone) return null;

    const sent = timestamp ? new Date(timestamp) : new Date();
    return (
        <span
            className="rx-ft-chat"
            style={{ marginLeft: 6, fontSize: "0.75em", color: "var(--text-muted)", cursor: "default" }}
            title={`Sent at ${timeIn(zone, sent)} their time (${zone.replace(/_/g, " ")}). It's ${timeIn(zone)} there now.`}
        >
            🕐 {timeIn(zone, sent)}
        </span>
    );
}, { noop: true });

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.bot) return;
    const zone = settings.store.zones?.[user.id];
    children.push(
        <Menu.MenuItem
            id="rx-ft-set"
            label={zone ? `Local time: ${timeIn(zone)} (change…)` : "Set their local time…"}
            action={() => openZonePicker(user)}
        />
    );
};

export default definePlugin({
    name: "FriendTimes",
    description: "Remember what time it is for your friends: set their time zone once and see their local time in chat, in Friend Groups and with /time",
    tags: ["Renuxcord", "Friends", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    contextMenus: {
        "user-context": userContext
    },

    renderMessageDecoration: (props: MessageDecorationProps) => <ChatTime userId={props.message?.author?.id} timestamp={props.message?.timestamp} />,

    commands: [{
        name: "time",
        description: "What time is it for someone?",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{ name: "user", description: "Who", type: ApplicationCommandOptionType.USER, required: true }],
        execute(args, ctx) {
            const id = findOption<string>(args, "user", "");
            const user = UserStore.getUser(id);
            const zone = settings.store.zones?.[id];
            sendBotMessage(ctx.channel.id, {
                content: zone
                    ? `🕐 It's **${timeIn(zone)}** for ${user?.globalName || user?.username || "them"} (${zone.replace(/_/g, " ")}).`
                    : `I don't know ${user?.username ?? "their"} time zone yet. Right-click them → Set their local time.`
            });
        }
    }]
});
