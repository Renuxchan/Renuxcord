/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { Button } from "@components/Button";
import { parseWhen } from "@plugins/messageScheduler";
import { RenuxDevs } from "@utils/renuxcord";
import { jumpTo, truncate, whereLabel } from "@utils/renuxcordMessages";
import definePlugin, { IconComponent } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ContextMenuApi, Menu, Modal, openModal, showToast, TextInput, useEffect, useReducer, useState } from "@webpack/common";
import type { MouseEvent } from "react";

interface Reminder {
    id: number;
    channelId: string;
    messageId: string;
    author: string;
    preview: string;
    at: number;
}

const KEY = "Renuxcord_reminders";
let reminders: Reminder[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function persist() {
    void DataStore.set(KEY, reminders);
    listeners.forEach(l => l());
}

const stamp = (ms: number, style = "f") => `<t:${Math.floor(ms / 1000)}:${style}>`;

function add(message: Message, at: number) {
    reminders = [...reminders, {
        id: Date.now(),
        channelId: message.channel_id,
        messageId: message.id,
        author: message.author?.globalName || message.author?.username || "Someone",
        preview: truncate(message.content || (message.attachments?.length ? "📎 attachment" : "(no text)"), 140),
        at
    }].sort((a, b) => a.at - b.at);
    persist();
    showToast({ text: `⏰ I'll remind you ${new Date(at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`, variant: "success" });
}

function fire(r: Reminder, late: boolean) {
    showNotification({
        title: `⏰ Reminder${late ? " (while Discord was closed)" : ""}`,
        body: `${r.author} in ${whereLabel(r.channelId)}: ${r.preview}`,
        permanent: true,
        onClick: () => jumpTo(r.channelId, r.messageId)
    });
}

function tick(startup = false) {
    const now = Date.now();
    const due = reminders.filter(r => r.at <= now);
    if (!due.length) return;
    reminders = reminders.filter(r => r.at > now);
    persist();
    for (const r of due) fire(r, startup && now - r.at > 60_000);
}

function tomorrowAt9() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
}

function openCustomTime(message: Message) {
    openModal(props => {
        function Picker() {
            const [value, setValue] = useState("");
            const at = parseWhen(value);
            return (
                <Modal
                    {...props}
                    title="Remind me about this message"
                    subtitle="Like 45m, 2h30m, 9pm, tomorrow 9:00 or 3d"
                    actions={[
                        { text: "Cancel", variant: "secondary", onClick: props.onClose },
                        { text: "Set reminder", variant: "primary", disabled: !at, onClick: () => { add(message, at!); props.onClose(); } }
                    ]}
                >
                    <TextInput value={value} onChange={setValue} placeholder="2h" autoFocus />
                    <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                        {value ? at ? `→ ${new Date(at).toLocaleString()}` : "I don't understand that time yet" : ""}
                    </div>
                </Modal>
            );
        }
        return <Picker />;
    });
}

function reminderItems(message: Message) {
    const quick = [
        ["In 15 minutes", 15 * 60_000],
        ["In 1 hour", 60 * 60_000],
        ["In 3 hours", 3 * 60 * 60_000]
    ] as const;
    return [
        ...quick.map(([label, ms]) => <Menu.MenuItem id={`rx-remind-${ms}`} key={label} label={label} action={() => add(message, Date.now() + ms)} />),
        <Menu.MenuItem id="rx-remind-tomorrow" key="tomorrow" label="Tomorrow at 9:00" action={() => add(message, tomorrowAt9())} />,
        <Menu.MenuItem id="rx-remind-custom" key="custom" label="Custom time…" action={() => openCustomTime(message)} />
    ];
}

const BellIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7v3.6L3.3 16a1 1 0 0 0 .9 1.5h15.6a1 1 0 0 0 .9-1.5L19 12.6V9a7 7 0 0 0-7-7Zm0 20a3 3 0 0 0 2.8-2H9.2a3 3 0 0 0 2.8 2Z" />
    </svg>
);

const messageContext: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message) return;
    children.push(
        <Menu.MenuItem id="rx-remind" label="Remind me" icon={BellIcon}>
            {reminderItems(message)}
        </Menu.MenuItem>
    );
};

function RemindersList({ close }: { close(): void; }) {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        listeners.add(rerender);
        return () => void listeners.delete(rerender);
    }, []);

    if (!reminders.length) return <div style={{ color: "var(--text-muted)" }}>No reminders set. Right-click any message → Remind me.</div>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reminders.map(r => (
                <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "var(--background-mod-subtle, rgb(255 255 255 / 4%))" }}>
                    <div style={{ flex: 1, minWidth: 0, color: "var(--text-default, var(--text-normal))" }}>
                        <div style={{ fontWeight: 600 }}>{new Date(r.at).toLocaleString()}</div>
                        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{r.author} in {whereLabel(r.channelId)}: {r.preview}</div>
                    </div>
                    <Button size="small" variant="secondary" onClick={() => { close(); jumpTo(r.channelId, r.messageId); }}>Jump</Button>
                    <Button size="small" variant="dangerSecondary" onClick={() => { reminders = reminders.filter(x => x.id !== r.id); persist(); }}>Delete</Button>
                </div>
            ))}
        </div>
    );
}

function openReminders() {
    openModal(props => (
        <Modal {...props} title="Reminders" subtitle="Pending message reminders" actions={[{ text: "Close", variant: "secondary", onClick: props.onClose }]}>
            <RemindersList close={props.onClose} />
        </Modal>
    ));
}

export default definePlugin({
    name: "MessageReminders",
    description: "Right-click (or hover) any message → Remind me in 15m / 1h / tomorrow / any time. You get a notification that jumps back to it",
    tags: ["Renuxcord", "Chat", "Notifications", "Utility"],
    authors: [RenuxDevs.Larpbase],

    contextMenus: {
        "message": messageContext
    },

    messagePopoverButton: {
        icon: BellIcon,
        render(message) {
            return {
                label: "Remind me",
                icon: BellIcon,
                onClick: (e: MouseEvent) => ContextMenuApi.openContextMenu(e, () => (
                    <Menu.Menu navId="rx-remind-popover" onClose={ContextMenuApi.closeContextMenu} aria-label="Remind me">
                        {reminderItems(message)}
                    </Menu.Menu>
                ))
            };
        }
    },

    commands: [{
        name: "reminders",
        description: "List your message reminders",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{ name: "clear", description: "Delete all of them", type: ApplicationCommandOptionType.BOOLEAN, required: false }],
        execute(args, ctx) {
            if (args.find(a => a.name === "clear")?.value) {
                const n = reminders.length;
                reminders = [];
                persist();
                return void sendBotMessage(ctx.channel.id, { content: `🗑️ Deleted ${n} reminder${n === 1 ? "" : "s"}.` });
            }
            sendBotMessage(ctx.channel.id, {
                content: reminders.length
                    ? reminders.map(r => `⏰ ${stamp(r.at)} (${stamp(r.at, "R")}): **${r.author}** in ${whereLabel(r.channelId)}: ${r.preview}`).join("\n")
                    : "No reminders set. Right-click any message → Remind me."
            });
        }
    }],

    toolboxActions: {
        "Open reminders": openReminders
    },

    async start() {
        reminders = (await DataStore.get<Reminder[]>(KEY)) ?? [];
        tick(true);
        timer = setInterval(tick, 15_000);
    },

    stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }
});
