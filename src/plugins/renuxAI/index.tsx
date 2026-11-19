/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType, PluginNative, PluginSettingComponentProps } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, MessageStore, showToast, TextInput, useState } from "@webpack/common";

import type { AskOptions } from "./native";

const Native = VencordNative.pluginHelpers.RenuxAI as PluginNative<typeof import("./native")>;

const DEFAULT_PERSONA = [
    "You're RenuxAI, a sharp, friendly assistant built into the user's Discord client (Renuxcord).",
    "Keep answers short and easy to skim, use Discord markdown (bold, lists, code blocks), and match the tone of the chat.",
    "Never pretend to be the user or claim to be a real person."
].join(" ");

function ApiKeySetting({ setValue }: PluginSettingComponentProps) {
    const [value, setLocal] = useState<string>(settings.store.apiKey ?? "");
    return (
        <section>
            <Heading tag="h5">Anthropic API key</Heading>
            <Paragraph style={{ color: "var(--text-muted)", marginBottom: 8 }}>
                From console.anthropic.com. Stored only in your local Renuxcord settings. Leave empty to use ANTHROPIC_API_KEY or an `ant auth login` profile.
                Every request is billed to that key.
            </Paragraph>
            <TextInput
                type="password"
                value={value}
                placeholder="sk-ant-…"
                onChange={(v: string) => {
                    setLocal(v);
                    setValue(v.trim());
                }}
            />
        </section>
    );
}

const settings = definePluginSettings({
    apiKey: {
        type: OptionType.COMPONENT,
        default: "",
        component: props => <ApiKeySetting {...props} />
    },
    model: {
        type: OptionType.SELECT,
        description: "Claude model",
        options: [
            { label: "Claude Opus 5.5 (smartest, default)", value: "claude-opus-5-5", default: true },
            { label: "Claude Sonnet 5.5 (fast and cheaper)", value: "claude-sonnet-5-5" },
            { label: "Claude Haiku 5.5 (fastest, cheapest)", value: "claude-haiku-5-5" },
            { label: "Claude Fable 5.2 (most capable, priciest)", value: "claude-fable-5-2" }
        ]
    },
    effort: {
        type: OptionType.SELECT,
        description: "How hard Claude thinks before answering. Low is snappiest",
        options: [
            { label: "Low", value: "low", default: true },
            { label: "Medium", value: "medium" },
            { label: "High", value: "high" }
        ]
    },
    persona: {
        type: OptionType.STRING,
        description: "System prompt / personality for RenuxAI",
        default: DEFAULT_PERSONA,
        multiline: true
    }
});

const AUTHOR = { username: "RenuxAI" };

function botReply(channelId: string, text: string) {
    const chunks = text.match(/[\s\S]{1,1900}(?=\n|$)|[\s\S]{1,1900}/g) ?? [text];
    for (const chunk of chunks) sendBotMessage(channelId, { content: chunk, author: AUTHOR as any });
}

async function askClaude(prompt: string, extra: Partial<AskOptions> = {}) {
    showToast({ text: "✨ Asking Claude…" });
    const res = await Native.ask({
        apiKey: settings.store.apiKey,
        model: settings.store.model,
        effort: settings.store.effort as AskOptions["effort"],
        system: settings.store.persona || DEFAULT_PERSONA,
        messages: [{ role: "user", content: prompt }],
        ...extra
    });
    if (!res.ok) throw new Error(res.error);
    return res.text;
}

function messageText(m: Message) {
    const name = m.author?.globalName || m.author?.username || "Unknown";
    const attachments = m.attachments?.length ? ` [${m.attachments.length} attachment(s)]` : "";
    return `${name}: ${m.content || ""}${attachments}`.trim();
}

function transcript(channelId: string, opts: { last?: number; fromId?: string; }) {
    let messages: Message[] = MessageStore.getMessages(channelId)?._array ?? [];
    if (opts.fromId) messages = messages.slice(Math.max(messages.findIndex(m => m.id === opts.fromId), 0));
    if (opts.last) messages = messages.slice(-opts.last);
    return messages.filter(m => m.content || m.attachments?.length).map(messageText).join("\n");
}

const where = (channelId: string) => {
    const c = ChannelStore.getChannel(channelId);
    return c?.guild_id ? `#${c.name}` : "a DM";
};

async function run(channelId: string, job: () => Promise<void>) {
    try {
        await job();
    } catch (err) {
        botReply(channelId, `❌ ${err instanceof Error ? err.message : String(err)}`);
    }
}

const summarizePrompt = (chat: string, channelId: string) =>
    `Summarize this Discord conversation from ${where(channelId)}. Use a few short bullet points, say who said what when it matters, and end with open questions or decisions if there are any.\n\n<conversation>\n${chat}\n</conversation>`;

const messageContext: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message) return;
    const channelId = message.channel_id;

    children.push(
        <Menu.MenuItem id="rx-ai" label="RenuxAI">
            <Menu.MenuItem id="rx-ai-explain" label="Explain this" action={() => run(channelId, async () => {
                botReply(channelId, await askClaude(`Explain this Discord message simply. Include any slang, jokes or context someone might miss.\n\n<message>\n${messageText(message)}\n</message>`));
            })} />
            <Menu.MenuItem id="rx-ai-summary" label="Summarize from here" action={() => run(channelId, async () => {
                const chat = transcript(channelId, { fromId: message.id });
                botReply(channelId, await askClaude(summarizePrompt(chat, channelId)));
            })} />
            <Menu.MenuItem id="rx-ai-reply" label="Suggest a reply" action={() => run(channelId, async () => {
                const chat = transcript(channelId, { last: 25 });
                const reply = await askClaude(
                    `Write one reply I could send to the last message from ${message.author?.username ?? "them"} in this chat. Match the chat's tone. `
                    + `Return only the reply text, nothing else.\n\n<conversation>\n${chat}\n</conversation>\n\n<reply_to>\n${messageText(message)}\n</reply_to>`
                );
                insertTextIntoChatInputBox(reply);
                showToast({ text: "Reply suggestion is in your message box", variant: "success" });
            })} />
            <Menu.MenuItem id="rx-ai-translate" label="Translate to English" action={() => run(channelId, async () => {
                botReply(channelId, await askClaude(`Translate this message to English. Reply with only the translation.\n\n<message>\n${message.content}\n</message>`));
            })} />
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "RenuxAI",
    description: "Claude inside Discord: /ai ask, summarize a chat, rewrite or translate text, and right-click any message to explain it or get a reply suggestion. Needs an Anthropic API key",
    tags: ["Renuxcord", "Chat", "Commands", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    contextMenus: {
        "message": messageContext
    },

    commands: [{
        name: "ai",
        description: "Ask Claude (RenuxAI)",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "ask",
                description: "Ask Claude anything. Only you see the answer unless you set public",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [
                    { name: "prompt", description: "Your question", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "public", description: "Send the answer in chat as you", type: ApplicationCommandOptionType.BOOLEAN, required: false }
                ]
            },
            {
                name: "summarize",
                description: "Summarize the recent conversation in this channel",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [{ name: "messages", description: "How many recent messages (default 50, max 200)", type: ApplicationCommandOptionType.INTEGER, required: false }]
            },
            {
                name: "rewrite",
                description: "Rewrite your text and put it in the message box",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [
                    { name: "text", description: "What you want to say", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "style", description: "e.g. casual, formal, funny, shorter, nicer, fix grammar", type: ApplicationCommandOptionType.STRING, required: false }
                ]
            },
            {
                name: "translate",
                description: "Translate text and put it in the message box",
                type: ApplicationCommandOptionType.SUB_COMMAND,
                options: [
                    { name: "text", description: "Text to translate", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "to", description: "Target language (default English)", type: ApplicationCommandOptionType.STRING, required: false }
                ]
            }
        ],
        execute(args, ctx) {
            const sub = args[0];
            const opts = sub.options ?? [];
            const channelId = ctx.channel.id;

            switch (sub.name) {
                case "ask":
                    return void run(channelId, async () => {
                        const answer = await askClaude(findOption(opts, "prompt", ""));
                        if (findOption(opts, "public", false)) await sendMessage(channelId, { content: answer.slice(0, 2000) });
                        else botReply(channelId, answer);
                    });
                case "summarize":
                    return void run(channelId, async () => {
                        const count = Math.min(Math.max(findOption(opts, "messages", 50), 5), 200);
                        const chat = transcript(channelId, { last: count });
                        if (!chat) throw new Error("No messages loaded in this channel yet. Scroll up a bit and try again.");
                        botReply(channelId, await askClaude(summarizePrompt(chat, channelId)));
                    });
                case "rewrite":
                    return void run(channelId, async () => {
                        const style = findOption(opts, "style", "clearer and natural");
                        const text = await askClaude(`Rewrite this Discord message to be ${style}. Keep the meaning. Return only the rewritten message.\n\n<message>\n${findOption(opts, "text", "")}\n</message>`);
                        insertTextIntoChatInputBox(text);
                        showToast({ text: "Rewritten text is in your message box", variant: "success" });
                    });
                case "translate":
                    return void run(channelId, async () => {
                        const to = findOption(opts, "to", "English");
                        const text = await askClaude(`Translate this into ${to}. Return only the translation.\n\n<text>\n${findOption(opts, "text", "")}\n</text>`);
                        insertTextIntoChatInputBox(text);
                        showToast({ text: `Translation (${to}) is in your message box`, variant: "success" });
                    });
            }
        }
    }]
});
