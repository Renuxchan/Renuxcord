/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { copyWithToast, insertTextIntoChatInputBox } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import { matchesHotkey } from "@utils/renuxcordHotkeys";
import { timeAgo } from "@utils/renuxcordTime";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, Modal, openModal, showToast, useEffect, useState } from "@webpack/common";

interface Note { id: string; body: string; updatedAt: number; }

const KEY = "Renuxcord_notepad";
let notes: Note[] = [];
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let modalOpen = false;

const settings = definePluginSettings({
    hotkey: {
        type: OptionType.STRING,
        description: "Shortcut that opens the notepad",
        default: "ctrl+alt+n"
    }
});

const load = () => loaded ??= DataStore.get<Note[]>(KEY).then(n => { notes = Array.isArray(n) ? n : []; });

function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, notes), 400);
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const titleOf = (n: Note) => n.body.trim().split("\n")[0].slice(0, 40) || "Empty note";

async function addNote(body: string) {
    await load();
    const note = { id: newId(), body, updatedAt: Date.now() };
    notes = [note, ...notes];
    persist();
    return note;
}

function NotepadBody({ close, startId }: { close(): void; startId?: string; }) {
    const [list, setList] = useState<Note[]>(notes);
    const [activeId, setActiveId] = useState<string | undefined>(startId ?? notes[0]?.id);
    const active = list.find(n => n.id === activeId);

    const commit = (next: Note[]) => {
        notes = next;
        setList(next);
        persist();
    };

    useEffect(() => {
        if (!list.length) {
            const first = { id: newId(), body: "", updatedAt: Date.now() };
            commit([first]);
            setActiveId(first.id);
        }
    }, []);

    const create = () => {
        const note = { id: newId(), body: "", updatedAt: Date.now() };
        commit([note, ...list]);
        setActiveId(note.id);
    };

    const remove = (id: string) => {
        const next = list.filter(n => n.id !== id);
        commit(next);
        if (activeId === id) setActiveId(next[0]?.id);
    };

    return (
        <div className="rx-np">
            <div className="rx-np-side">
                <Button size="small" onClick={create}>+ New note</Button>
                <div className="rx-np-list">
                    {list.map(n => (
                        <div
                            key={n.id}
                            className={`rx-np-item${n.id === activeId ? " rx-np-on" : ""}`}
                            onClick={() => setActiveId(n.id)}
                        >
                            <b>{titleOf(n)}</b>
                            <small>{timeAgo(n.updatedAt)}</small>
                            <span
                                className="rx-np-del"
                                title="Delete note"
                                onClick={e => {
                                    e.stopPropagation();
                                    remove(n.id);
                                }}
                            >✕</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="rx-np-main">
                {active ? (
                    <>
                        <textarea
                            className="rx-np-text"
                            value={active.body}
                            autoFocus
                            spellCheck
                            placeholder="Write anything. It saves by itself."
                            onChange={e => {
                                const body = e.currentTarget.value;
                                commit(list.map(n => n.id === active.id ? { ...n, body, updatedAt: Date.now() } : n));
                            }}
                        />
                        <div className="rx-np-actions">
                            <small>{active.body.length} characters</small>
                            <Button size="small" variant="secondary" onClick={() => copyWithToast(active.body, "Note copied")}>Copy</Button>
                            <Button size="small" onClick={() => {
                                insertTextIntoChatInputBox(active.body.slice(0, 4000));
                                close();
                            }}>Put in message box</Button>
                        </div>
                    </>
                ) : <div className="rx-np-empty">No note selected</div>}
            </div>
        </div>
    );
}

async function openNotepad(startId?: string) {
    if (modalOpen) return;
    await load();
    modalOpen = true;
    openModal(props => (
        <Modal {...props} size="lg" title="📝 Notepad" subtitle="Saved on this computer as you type">
            <NotepadBody close={props.onClose} startId={startId} />
        </Modal>
    ), { onCloseCallback: () => { modalOpen = false; } });
}

function onKeyDown(e: KeyboardEvent) {
    if (!settings.store.hotkey || !matchesHotkey(settings.store.hotkey, e)) return;
    e.preventDefault();
    e.stopPropagation();
    void openNotepad();
}

const messageContext: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message?.content) return;
    children.push(
        <Menu.MenuItem
            id="rx-np-save"
            label="Save to Notepad"
            action={async () => {
                const channel = ChannelStore.getChannel(message.channel_id);
                const link = `https://discord.com/channels/${channel?.guild_id ?? "@me"}/${message.channel_id}/${message.id}`;
                const name = message.author?.globalName || message.author?.username || "someone";
                await addNote(`${message.content}\n\n— ${name} · ${link}`);
                showToast({ text: "Saved to your Notepad", variant: "success" });
            }}
        />
    );
};

export default definePlugin({
    name: "Notepad",
    description: "A notepad inside Discord with as many notes as you want. Ctrl+Alt+N, /notes or /note to jot something down, and right-click messages to save them",
    tags: ["Renuxcord", "Utility", "Organisation"],
    authors: [RenuxDevs.Larpbase],
    settings,

    contextMenus: {
        "message": messageContext
    },

    toolboxActions: {
        "Open Notepad": () => void openNotepad()
    },

    commands: [
        {
            name: "notes",
            description: "Open your notepad",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: () => void openNotepad()
        },
        {
            name: "note",
            description: "Jot something down in your notepad",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "text", description: "What to remember", type: ApplicationCommandOptionType.STRING, required: true }],
            async execute(args, ctx) {
                await addNote(findOption(args, "text", ""));
                sendBotMessage(ctx.channel.id, { content: `📝 Saved to your notepad (${notes.length} note${notes.length === 1 ? "" : "s"}). Open it with /notes.` });
            }
        }
    ],

    start() {
        void load();
        document.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        clearTimeout(saveTimer);
        void DataStore.set(KEY, notes);
    }
});
