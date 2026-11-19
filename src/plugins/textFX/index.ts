/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin from "@utils/types";
import { showToast } from "@webpack/common";

import { EFFECTS } from "./effects";

const PREVIEW = "👀 preview every style";

export default definePlugin({
    name: "TextFX",
    description: "Fancy text with /fx: 𝗯𝗼𝗹𝗱, 𝓼𝓬𝓻𝓲𝓹𝓽, 𝖌𝖔𝖙𝖍𝖎𝖈, ｖａｐｏｒｗａｖｅ, ᴛɪɴʏ ᴄᴀᴘs, uʍop ǝpısdn, z̷a̷l̷g̷o̷, mOcKiNg, 👏 clap 👏, owo and more, straight into your message box",
    tags: ["Renuxcord", "Fun", "Chat", "Commands"],
    authors: [RenuxDevs.Larpbase],

    commands: [{
        name: "fx",
        description: "Turn text into fancy text",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "style",
                description: "The look",
                type: ApplicationCommandOptionType.STRING,
                required: true,
                choices: [PREVIEW, ...Object.keys(EFFECTS)].map(name => ({ name, label: name, value: name }))
            },
            { name: "text", description: "Your text", type: ApplicationCommandOptionType.STRING, required: true }
        ],
        execute(args, ctx) {
            const style = findOption(args, "style", PREVIEW);
            const text = findOption(args, "text", "");

            if (style === PREVIEW || !EFFECTS[style]) {
                const lines = Object.entries(EFFECTS).map(([name, fx]) => `**${name}** · ${fx(text)}`);
                return void sendBotMessage(ctx.channel.id, { content: lines.join("\n").slice(0, 1990) });
            }

            const out = EFFECTS[style](text);
            if (out.length > 2000) return void showToast({ text: "That comes out longer than 2000 characters", variant: "critical" });
            insertTextIntoChatInputBox(out);
            showToast({ text: "Fancy text is in your message box", variant: "success" });
        }
    }]
});
