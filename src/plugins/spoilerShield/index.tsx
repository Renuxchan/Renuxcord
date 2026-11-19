/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessageDecorationProps } from "@api/MessageDecorations";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { RenuxDevs } from "@utils/renuxcord";
import { RawMessage } from "@utils/renuxcordMessages";
import definePlugin, { OptionType } from "@utils/types";
import { MessageStore, SelectedChannelStore, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    words: {
        type: OptionType.STRING,
        description: "Words or phrases to blur, separated by commas (e.g. a show, game or person you don't want spoiled)",
        default: "",
        onChange: () => rescan()
    },
    blurMedia: {
        type: OptionType.BOOLEAN,
        description: "Blur the images and embeds in those messages too",
        default: true,
        onChange: () => writeCss()
    },
    strength: {
        type: OptionType.SLIDER,
        description: "Blur strength",
        markers: [2, 4, 6, 8, 12],
        default: 6,
        stickToMarkers: false,
        onChange: () => writeCss()
    }
});

const STYLE_ID = "rx-spoiler-shield";
const MAX_TRACKED = 3000;
/** message id → the word it matched */
const flagged = new Map<string, string>();
let cssTimer: ReturnType<typeof setTimeout> | undefined;

function wordList() {
    return settings.store.words.split(",").map(w => w.trim().toLowerCase()).filter(w => w.length >= 2);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let matcher: RegExp | null = null;
function buildMatcher() {
    const words = wordList();
    matcher = words.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(${words.map(escapeRe).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu") : null;
}

function textOf(m: RawMessage & { embeds?: Array<{ title?: string; description?: string; rawTitle?: string; rawDescription?: string; }>; }) {
    const embeds = (m.embeds ?? []).map(e => `${e.title ?? e.rawTitle ?? ""} ${e.description ?? e.rawDescription ?? ""}`).join(" ");
    return `${m.content ?? ""} ${embeds}`;
}

function check(m: RawMessage | undefined) {
    if (!m?.id || !matcher || m.author?.id === UserStore.getCurrentUser()?.id) return false;
    const hit = matcher.exec(textOf(m));
    if (!hit) return false;
    flagged.set(m.id, hit[1]);
    if (flagged.size > MAX_TRACKED) flagged.delete(flagged.keys().next().value!);
    return true;
}

function writeCss() {
    clearTimeout(cssTimer);
    cssTimer = setTimeout(() => {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement("style");
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }
        const ids = [...flagged.keys()];
        if (!ids.length) {
            style.textContent = "";
            return;
        }
        const blur = `filter: blur(${settings.store.strength}px); transition: filter .15s ease;`;
        const targets = ids.flatMap(id => [`#message-content-${id}`, ...settings.store.blurMedia ? [`#message-accessories-${id}`] : []]);
        style.textContent = `${targets.join(",")} { ${blur} }\n${targets.map(t => `${t}:hover`).join(",")} { filter: none; }`;
    }, 50);
}

/** Re-check the messages Discord has loaded, e.g. after the word list changed */
function rescan() {
    buildMatcher();
    flagged.clear();
    const channelId = SelectedChannelStore.getChannelId();
    if (channelId) for (const m of MessageStore.getMessages(channelId)?._array ?? []) check(m as unknown as RawMessage);
    writeCss();
}

const Tag = ErrorBoundary.wrap(({ id }: { id?: string; }) => {
    const word = id ? flagged.get(id) : undefined;
    if (!word) return null;
    return (
        <span
            title={`Blurred because it mentions “${word}”. Hover the message to read it.`}
            style={{ marginLeft: 6, padding: "0 6px", borderRadius: 4, fontSize: "0.7rem", fontWeight: 700, verticalAlign: "middle", background: "rgb(236 72 153 / 18%)", color: "#f472b6" }}
        >
            🛡️ SPOILER
        </span>
    );
}, { noop: true });

export default definePlugin({
    name: "SpoilerShield",
    description: "Blurs messages that mention words you pick (a show, a game, a person) until you hover them. Spoiler-free scrolling",
    tags: ["Renuxcord", "Chat", "Appearance"],
    authors: [RenuxDevs.Larpbase],
    settings,

    renderMessageDecoration: (props: MessageDecorationProps) => <Tag id={props.message?.id} />,

    flux: {
        MESSAGE_CREATE({ message }: { message: RawMessage; }) {
            if (check(message)) writeCss();
        },
        MESSAGE_UPDATE({ message }: { message: RawMessage; }) {
            if (check(message)) writeCss();
        },
        LOAD_MESSAGES_SUCCESS({ messages }: { messages: RawMessage[]; }) {
            let any = false;
            for (const m of messages ?? []) any = check(m) || any;
            if (any) writeCss();
        },
        CHANNEL_SELECT() {
            setTimeout(rescan, 100);
        }
    },

    start() {
        rescan();
    },

    stop() {
        clearTimeout(cssTimer);
        flagged.clear();
        document.getElementById(STYLE_ID)?.remove();
    }
});
