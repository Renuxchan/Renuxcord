/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Maps A-Z, a-z (and optionally 0-9) onto a Unicode block, with per-letter exceptions for the holes in it */
function alphabet(upper: number, lower: number | null, digits: number | null, holes: Record<string, number> = {}) {
    return (text: string) => Array.from(text, ch => {
        if (holes[ch]) return String.fromCodePoint(holes[ch]);
        const c = ch.codePointAt(0)!;
        if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
        if (c >= 97 && c <= 122) return lower == null ? String.fromCodePoint(upper + c - 97) : String.fromCodePoint(lower + c - 97);
        if (digits != null && c >= 48 && c <= 57) return String.fromCodePoint(digits + c - 48);
        return ch;
    }).join("");
}

function table(from: string, to: string, lower = true) {
    const src = Array.from(from);
    const dst = Array.from(to);
    const map = new Map(src.map((c, i) => [c, dst[i]]));
    return (text: string) => Array.from(lower ? text.toLowerCase() : text, ch => map.get(ch) ?? ch).join("");
}

const combining = (mark: string) => (text: string) => Array.from(text, ch => ch === " " ? ch : ch + mark).join("");

const LOWER = "abcdefghijklmnopqrstuvwxyz";

const upsideDownMap = table(
    `${LOWER}0123456789.,!?'"()[]{}<>&_;`,
    "ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz0ƖᄅƐㄣϛ9ㄥ86˙'¡¿,„)(][}{><⅋‾؛"
);

function zalgo(text: string) {
    const marks = Array.from({ length: 0x36f - 0x300 + 1 }, (_, i) => String.fromCharCode(0x300 + i));
    const pick = () => marks[Math.floor(Math.random() * marks.length)];
    return Array.from(text, ch => ch === " " ? ch : ch + Array.from({ length: 2 + Math.floor(Math.random() * 5) }, pick).join("")).join("");
}

function owo(text: string) {
    const faces = [" uwu", " owo", " >w<", " ^w^", " (◕ᴗ◕✿)", " ✨"];
    return text
        .replace(/[rl]/g, "w").replace(/[RL]/g, "W")
        .replace(/n([aeiou])/g, "ny$1").replace(/N([aeiou])/g, "Ny$1")
        .replace(/ove/g, "uv")
        .replace(/([.!?])(\s|$)/g, (_, p, s) => `${p}${faces[Math.floor(Math.random() * faces.length)]}${s}`)
        + (/[.!?]$/.test(text) ? "" : faces[Math.floor(Math.random() * faces.length)]);
}

export const EFFECTS: Record<string, (text: string) => string> = {
    "𝗯𝗼𝗹𝗱": alphabet(0x1D5D4, 0x1D5EE, 0x1D7EC),
    "𝘪𝘵𝘢𝘭𝘪𝘤": alphabet(0x1D608, 0x1D622, null),
    "𝓼𝓬𝓻𝓲𝓹𝓽": alphabet(0x1D4D0, 0x1D4EA, null),
    "𝖌𝖔𝖙𝖍𝖎𝖈": alphabet(0x1D56C, 0x1D586, null),
    "𝕕𝕠𝕦𝕓𝕝𝕖": alphabet(0x1D538, 0x1D552, 0x1D7D8, { C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 }),
    "𝚖𝚘𝚗𝚘": alphabet(0x1D670, 0x1D68A, 0x1D7F6),
    "ｖａｐｏｒｗａｖｅ": text => Array.from(text, ch => {
        const c = ch.codePointAt(0)!;
        if (ch === " ") return "　";
        return c >= 0x21 && c <= 0x7E ? String.fromCodePoint(c + 0xFEE0) : ch;
    }).join(""),
    "ⓑⓤⓑⓑⓛⓔ": text => alphabet(0x24B6, 0x24D0, null)(text).replace(/[0-9]/g, d => d === "0" ? "⓪" : String.fromCodePoint(0x2460 + Number(d) - 1)),
    "🅂🅀🅄🄰🅁🄴": text => alphabet(0x1F130, null, null)(text.toUpperCase()),
    "ᴛɪɴʏ ᴄᴀᴘs": table(LOWER, "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ"),
    "ˢᵘᵖᵉʳˢᶜʳⁱᵖᵗ": table(`${LOWER}0123456789+-=()`, "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖᵠʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾"),
    "uʍop ǝpısdn": text => Array.from(upsideDownMap(text)).reverse().join(""),
    "z̷a̷l̷g̷o̷": zalgo,
    "mOcKiNg": text => {
        let upper = false;
        return Array.from(text, ch => {
            if (!/[a-z]/i.test(ch)) return ch;
            upper = !upper;
            return upper ? ch.toUpperCase() : ch.toLowerCase();
        }).join("");
    },
    "👏 clap 👏": text => `👏 ${text.trim().split(/\s+/).join(" 👏 ")} 👏`,
    "owo": owo,
    "s̶t̶r̶i̶k̶e̶": combining("̶"),
    "u̲n̲d̲e̲r̲l̲i̲n̲e̲": combining("̲"),
    "s p a c e d": text => Array.from(text).join(" "),
    "l33t 5p34k": table("aeiostbgl", "43105789|", true),
    "🇫 🇱 🇦 🇬 🇸": text => Array.from(text.toLowerCase(), ch => /[a-z]/.test(ch) ? String.fromCodePoint(0x1F1E6 + ch.charCodeAt(0) - 97) + "​" : ch).join(""),
    "esrever": text => Array.from(text).reverse().join("")
};
