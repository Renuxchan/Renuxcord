/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { ContextMenuApi, Menu, Modal, openModal, useState } from "@webpack/common";

const settings = definePluginSettings({
    replies: {
        type: OptionType.STRING,
        description: "Your quick replies, one per line as: name | text",
        multiline: true,
        default: [
            "brb | brb, give me a few minutes",
            "omw | on my way 🏃",
            "gn | goodnight everyone 🌙",
            "ty | thank you so much 🙏",
            "gg | gg wp 🫡",
            "1v1 | 1v1 me rn"
        ].join("\n")
    },
    kaomoji: {
        type: OptionType.BOOLEAN,
        description: "Show the kaomoji library in the menu",
        default: true
    }
});

const KAOMOJI: Record<string, string[]> = {
    "😊 Happy": ["(◕‿◕)", "(＾▽＾)", "ヽ(・∀・)ﾉ", "(๑˃ᴗ˂)ﻭ", "٩(◕‿◕)۶", "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧", "(ﾉ´ヮ`)ﾉ*: ･ﾟ"],
    "💖 Love": ["(♡˙︶˙♡)", "(｡♥‿♥｡)", "(づ｡◕‿‿◕｡)づ", "♡(ˆ⌣ˆԅ)", "(っ˘з(˘⌣˘ ) ♡", "(´∀`)♡"],
    "😢 Sad": ["(╥﹏╥)", "(ಥ﹏ಥ)", "(｡•́︿•̀｡)", "(っ˘̩╭╮˘̩)っ", "( ; ω ; )", "(ᗒᗣᗕ)՞"],
    "😠 Angry": ["(╯°□°)╯︵ ┻━┻", "(ノಠ益ಠ)ノ彡┻━┻", "(╬ಠ益ಠ)", "٩(╬ʘ益ʘ╬)۶", "(ง'̀-'́)ง", "ಠ_ಠ", "┬─┬ノ( º _ ºノ)"],
    "😎 Cool": ["(⌐■_■)", "( •_•)>⌐■-■", "(☞ﾟヮﾟ)☞", "( ͡° ͜ʖ ͡°)", "¯\\\\_(ツ)_/¯", "(☉_☉)", "༼ つ ◕_◕ ༽つ"],
    "🐾 Animals": ["ʕ•ᴥ•ʔ", "(=^･ω･^=)", "ฅ^•ﻌ•^ฅ", "(ᵔᴥᵔ)", "くコ:彡", ">°))))彡", "(・θ・)"]
};

function parseReplies() {
    return settings.store.replies.split("\n").map(line => {
        const [name, ...rest] = line.split("|");
        const text = rest.join("|").trim();
        return text ? { name: name.trim() || text.slice(0, 20), text } : null;
    }).filter(Boolean) as Array<{ name: string; text: string; }>;
}

const insert = (text: string) => insertTextIntoChatInputBox(`${text} `);

function openEditor() {
    openModal(props => {
        function Editor() {
            const [value, setValue] = useState(settings.store.replies);
            return (
                <Modal
                    {...props}
                    size="md"
                    title="⚡ Quick replies"
                    subtitle="One per line as: name | text"
                    actions={[
                        { text: "Cancel", variant: "secondary", onClick: props.onClose },
                        { text: "Save", variant: "primary", onClick: () => { settings.store.replies = value; props.onClose(); } }
                    ]}
                >
                    <textarea
                        value={value}
                        onChange={e => setValue(e.currentTarget.value)}
                        spellCheck={false}
                        style={{
                            width: "100%", minHeight: 260, padding: 12, borderRadius: 8, resize: "vertical", boxSizing: "border-box",
                            border: "1px solid var(--border-subtle, rgb(255 255 255 / 8%))", background: "var(--background-secondary-alt, var(--background-tertiary))",
                            color: "var(--text-default, var(--text-normal))", font: "14px/1.5 var(--font-code, monospace)"
                        }}
                    />
                </Modal>
            );
        }
        return <Editor />;
    });
}

function QuickMenu() {
    const replies = parseReplies();
    return (
        <Menu.Menu navId="rx-quick-replies" onClose={ContextMenuApi.closeContextMenu} aria-label="Quick replies">
            <Menu.MenuGroup label="Quick replies">
                {replies.length
                    ? replies.map((r, i) => <Menu.MenuItem key={i} id={`rx-qr-${i}`} label={r.name} subtext={r.text.length > 40 ? `${r.text.slice(0, 40)}…` : r.text} action={() => insert(r.text)} />)
                    : <Menu.MenuItem id="rx-qr-none" label="No quick replies yet" disabled />}
            </Menu.MenuGroup>
            {settings.store.kaomoji && (
                <Menu.MenuGroup label="Kaomoji">
                    {Object.entries(KAOMOJI).map(([group, faces]) => (
                        <Menu.MenuItem key={group} id={`rx-qr-k-${group}`} label={group}>
                            {faces.map((face, i) => <Menu.MenuItem key={i} id={`rx-qr-k-${group}-${i}`} label={face.replace(/\\\\/g, "\\")} action={() => insert(face)} />)}
                        </Menu.MenuItem>
                    ))}
                </Menu.MenuGroup>
            )}
            <Menu.MenuSeparator />
            <Menu.MenuItem id="rx-qr-edit" label="Edit quick replies…" action={openEditor} />
        </Menu.Menu>
    );
}

function BoltIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg width={width} height={height} className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M4 4.5A2.5 2.5 0 0 1 6.5 2h11A2.5 2.5 0 0 1 20 4.5v9a2.5 2.5 0 0 1-2.5 2.5H11l-4.4 3.7A1 1 0 0 1 5 19v-3h.5A1.5 1.5 0 0 1 4 14.5zm9.2 1.1-4.4 5.6c-.3.4 0 .9.5.9h2.2l-.7 3.3c-.1.5.5.8.9.4l4.4-5.6c.3-.4 0-.9-.5-.9h-2.2l.7-3.3c.1-.5-.5-.8-.9-.4" />
        </svg>
    );
}

const QuickRepliesButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton tooltip="Quick replies & kaomoji" onClick={e => ContextMenuApi.openContextMenu(e, () => <QuickMenu />)}>
            <BoltIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "QuickReplies",
    description: "A ⚡ button in the message box with your saved replies (brb, omw, gn…) and a kaomoji library ( ͡° ͜ʖ ͡°). One click and it's in your message",
    tags: ["Renuxcord", "Chat", "Fun"],
    authors: [RenuxDevs.Larpbase],
    settings,

    chatBarButton: {
        icon: BoltIcon,
        render: QuickRepliesButton
    },

    toolboxActions: {
        "Edit quick replies": openEditor
    }
});
