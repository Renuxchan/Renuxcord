/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { parseWhen } from "@plugins/messageScheduler";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin from "@utils/types";
import { CommandArgument, CommandOption } from "@vencord/discord-types";
import { showToast } from "@webpack/common";

import { bytesOf, calculate, EIGHT_BALL, ENCODERS, password, prettyNumber, rollDice } from "./tools";

const STR = ApplicationCommandOptionType.STRING;
const INT = ApplicationCommandOptionType.INTEGER;
const BOOL = ApplicationCommandOptionType.BOOLEAN;

const choice = (name: string, value = name) => ({ name, label: name, value });
const publicOption: CommandOption = { name: "public", description: "Send the result in chat instead of only showing it to you", type: BOOL, required: false };

/** Shows the result only to you, or sends it when public was set */
async function reply(args: CommandArgument[], channelId: string, text: string) {
    if (findOption(args, "public", false)) await sendMessage(channelId, { content: text });
    else sendBotMessage(channelId, { content: text });
}

// ─── Timestamps ───

const STYLES: Record<string, string> = {
    "relative (in 2 hours)": "R",
    "full (Monday, 1 December 2026 9:00 PM)": "F",
    "short (1 December 2026 9:00 PM)": "f",
    "time (9:00 PM)": "t",
    "time with seconds": "T",
    "date (01/12/2026)": "d",
    "long date (1 December 2026)": "D"
};

function parseMoment(input: string) {
    const s = input.trim();
    if (/^\d{9,10}$/.test(s)) return Number(s) * 1000;
    if (/^\d{12,13}$/.test(s)) return Number(s);
    const when = parseWhen(s);
    if (when) return when;
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : parsed;
}

export default definePlugin({
    name: "QuickTools",
    description: "Handy slash commands: /calc, /roll dice, /flip, /choose, /random, /8ball, /timestamp for Discord time tags, /encode (base64, hex, morse…), /hash and /password",
    tags: ["Renuxcord", "Commands", "Utility", "Fun"],
    authors: [RenuxDevs.Larpbase],

    commands: [
        {
            name: "calc",
            description: "Calculate something, like 15% tip: 64*0.15 or sqrt(2)^3",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "expression", description: "Math to work out", type: STR, required: true }, publicOption],
            execute(args, ctx) {
                const expression = findOption(args, "expression", "");
                try {
                    return void reply(args, ctx.channel.id, `🧮 \`${expression}\` = **${prettyNumber(calculate(expression))}**`);
                } catch (err) {
                    sendBotMessage(ctx.channel.id, { content: `🧮 ${err instanceof Error ? err.message : String(err)}` });
                }
            }
        },
        {
            name: "roll",
            description: "Roll dice, like 1d20, 2d6+3 or 4d6-1",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "dice", description: "Dice to roll (default 1d6)", type: STR, required: false }, publicOption],
            execute(args, ctx) {
                const spec = findOption(args, "dice", "1d6") || "1d6";
                try {
                    const { total, detail } = rollDice(spec);
                    return void reply(args, ctx.channel.id, `🎲 **${total}** · ${spec} → ${detail}`);
                } catch (err) {
                    sendBotMessage(ctx.channel.id, { content: `🎲 ${err instanceof Error ? err.message : String(err)}` });
                }
            }
        },
        {
            name: "flip",
            description: "Flip a coin",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [publicOption],
            execute: (args, ctx) => void reply(args, ctx.channel.id, Math.random() < 0.5 ? "🪙 **Heads**" : "🪙 **Tails**")
        },
        {
            name: "choose",
            description: "Let fate pick: pizza, sushi, tacos",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "options", description: "Choices separated by commas or \"or\"", type: STR, required: true }, publicOption],
            execute(args, ctx) {
                const options = findOption(args, "options", "").split(/\s*,\s*|\s+or\s+|\s*\|\s*/i).map(s => s.trim()).filter(Boolean);
                if (options.length < 2) return void sendBotMessage(ctx.channel.id, { content: "🤔 Give me at least two options, separated by commas." });
                void reply(args, ctx.channel.id, `🤔 I choose **${options[Math.floor(Math.random() * options.length)]}**`);
            }
        },
        {
            name: "random",
            description: "A random number",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "min", description: "Lowest (default 1)", type: INT, required: false },
                { name: "max", description: "Highest (default 100)", type: INT, required: false },
                publicOption
            ],
            execute(args, ctx) {
                let min = Number(findOption(args, "min", 1));
                let max = Number(findOption(args, "max", 100));
                if (min > max) [min, max] = [max, min];
                void reply(args, ctx.channel.id, `🔢 **${min + Math.floor(Math.random() * (max - min + 1))}** (${min}–${max})`);
            }
        },
        {
            name: "8ball",
            description: "Ask the magic 8-ball",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "question", description: "Your question", type: STR, required: true }, publicOption],
            execute(args, ctx) {
                const question = findOption(args, "question", "");
                void reply(args, ctx.channel.id, `🎱 *${question}*\n**${EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)]}**`);
            }
        },
        {
            name: "timestamp",
            description: "Make a Discord time tag that shows in everyone's own time zone",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "when", description: "e.g. 9pm, tomorrow 18:30, in 2h, 2026-12-25 18:00", type: STR, required: true },
                { name: "style", description: "How it shows (default relative)", type: STR, required: false, choices: Object.keys(STYLES).map(k => choice(k)) }
            ],
            execute(args, ctx) {
                const when = parseMoment(findOption(args, "when", ""));
                if (!when) return void sendBotMessage(ctx.channel.id, { content: "🕐 I couldn't read that time. Try 9pm, tomorrow 18:30, in 2h or 2026-12-25 18:00." });
                const style = STYLES[findOption(args, "style", "")] ?? "R";
                insertTextIntoChatInputBox(`<t:${Math.floor(when / 1000)}:${style}> `);
                showToast({ text: "Time tag is in your message box", variant: "success" });
            }
        },
        {
            name: "encode",
            description: "Encode or decode text: base64, url, hex, binary, rot13, morse, reverse",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "type", description: "What to do", type: STR, required: true, choices: Object.keys(ENCODERS).map(k => choice(k)) },
                { name: "text", description: "The text", type: STR, required: true },
                publicOption
            ],
            execute(args, ctx) {
                const type = findOption(args, "type", "base64");
                try {
                    const out = ENCODERS[type](findOption(args, "text", ""));
                    void reply(args, ctx.channel.id, `🔤 ${type}:\n\`\`\`\n${out.slice(0, 1900)}\n\`\`\``);
                } catch {
                    sendBotMessage(ctx.channel.id, { content: `🔤 That text isn't valid ${type.replace(" decode", "")}.` });
                }
            }
        },
        {
            name: "hash",
            description: "SHA hash of some text",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "text", description: "The text", type: STR, required: true },
                { name: "algorithm", description: "Default SHA-256", type: STR, required: false, choices: ["SHA-256", "SHA-1", "SHA-384", "SHA-512"].map(k => choice(k)) }
            ],
            async execute(args, ctx) {
                const algorithm = findOption(args, "algorithm", "SHA-256");
                const digest = await crypto.subtle.digest(algorithm, bytesOf(findOption(args, "text", "")));
                const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
                sendBotMessage(ctx.channel.id, { content: `#️⃣ ${algorithm}\n\`\`\`\n${hex}\n\`\`\`` });
            }
        },
        {
            name: "password",
            description: "Generate a strong password (only you see it)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "length", description: "8 to 128 characters (default 20)", type: INT, required: false }],
            execute(args, ctx) {
                const length = Math.min(Math.max(Number(findOption(args, "length", 20)), 8), 128);
                sendBotMessage(ctx.channel.id, { content: `🔑 Only you can see this:\n\`\`\`\n${password(length)}\n\`\`\`` });
            }
        }
    ]
});
