/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ─── Calculator: a tiny recursive-descent parser, no eval ───

const FUNCS: Record<string, (...a: number[]) => number> = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    log: Math.log10, ln: Math.log, log2: Math.log2, exp: Math.exp, min: Math.min, max: Math.max, pow: Math.pow
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

export function calculate(input: string): number {
    const tokens = input.toLowerCase().replace(/×/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^")
        .match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z_]\w*|[-+*/^%(),!]|\S/g) ?? [];
    let i = 0;
    const peek = () => tokens[i];
    const eat = (t?: string) => {
        const tok = tokens[i++];
        if (t && tok !== t) throw new Error(`Expected "${t}"`);
        return tok;
    };

    const factorial = (n: number) => {
        if (n < 0 || n > 170 || !Number.isInteger(n)) throw new Error("Factorial needs a whole number from 0 to 170");
        let r = 1;
        for (let k = 2; k <= n; k++) r *= k;
        return r;
    };

    function primary(): number {
        const tok = eat();
        if (tok == null) throw new Error("The expression ends too early");
        if (tok === "(") {
            const v = expr();
            eat(")");
            return v;
        }
        if (/^\d|^\./.test(tok)) return Number(tok);
        if (tok in FUNCS) {
            eat("(");
            const args = [expr()];
            while (peek() === ",") {
                eat();
                args.push(expr());
            }
            eat(")");
            return FUNCS[tok](...args);
        }
        if (tok in CONSTS) return CONSTS[tok];
        throw new Error(`I don't know "${tok}"`);
    }

    function postfix(): number {
        let v = primary();
        while (peek() === "!") {
            eat();
            v = factorial(v);
        }
        return v;
    }

    function unary(): number {
        if (peek() === "-") return eat(), -unary();
        if (peek() === "+") return eat(), unary();
        return power();
    }

    function power(): number {
        const base = postfix();
        if (peek() === "^") {
            eat();
            return base ** unary();
        }
        return base;
    }

    function term(): number {
        let v = unary();
        for (; ;) {
            const t = peek();
            if (t === "*" || t === "/" || t === "%") {
                eat();
                const r = unary();
                v = t === "*" ? v * r : t === "/" ? v / r : v % r;
            } else if (t === "(" || (t && /^[a-z_]/.test(t))) {
                v *= unary(); // implicit multiplication: 2pi, 3(4+1)
            } else return v;
        }
    }

    function expr(): number {
        let v = term();
        while (peek() === "+" || peek() === "-") v = eat() === "+" ? v + term() : v - term();
        return v;
    }

    if (!tokens.length) throw new Error("Type something to calculate, like 12*(3+4)");
    const result = expr();
    if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}"`);
    return result;
}

export const prettyNumber = (n: number) => {
    if (!Number.isFinite(n)) return String(n);
    const clean = Number(n.toPrecision(12));
    return Math.abs(clean) >= 1e15 || (clean !== 0 && Math.abs(clean) < 1e-6) ? clean.toExponential(6) : clean.toLocaleString("en-US", { maximumFractionDigits: 10 });
};

// ─── Dice ───

export function rollDice(spec: string) {
    const parts = spec.toLowerCase().replace(/\s+/g, "").match(/[+-]?[^+-]+/g);
    if (!parts) throw new Error("Try something like 2d20+5");

    let total = 0;
    const shown: string[] = [];
    for (const part of parts) {
        const sign = part.startsWith("-") ? -1 : 1;
        const body = part.replace(/^[+-]/, "");
        const dice = /^(\d*)d(\d+)$/.exec(body);
        if (dice) {
            const count = Number(dice[1] || 1);
            const sides = Number(dice[2]);
            if (count < 1 || count > 100 || sides < 2 || sides > 1000) throw new Error("Use 1-100 dice with 2-1000 sides");
            const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
            total += sign * rolls.reduce((a, b) => a + b, 0);
            shown.push(`${sign < 0 ? "- " : shown.length ? "+ " : ""}${count}d${sides} [${rolls.join(", ")}]`);
        } else if (/^\d+$/.test(body)) {
            total += sign * Number(body);
            shown.push(`${sign < 0 ? "-" : "+"} ${body}`);
        } else throw new Error(`"${body}" isn't a dice roll. Try 2d20+5`);
    }
    return { total, detail: shown.join(" ") };
}

// ─── Encoders ───

export const bytesOf = (s: string) => new TextEncoder().encode(s);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const MORSE: Record<string, string> = {
    a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--",
    n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
    0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "!": "-.-.--", "/": "-..-.", "@": ".--.-.", "'": ".----.", "-": "-....-", ":": "---..."
};
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

export const ENCODERS: Record<string, (s: string) => string> = {
    "base64": s => btoa(Array.from(bytesOf(s), b => String.fromCharCode(b)).join("")),
    "base64 decode": s => textOf(Uint8Array.from(atob(s.trim()), c => c.charCodeAt(0))),
    "url": s => encodeURIComponent(s),
    "url decode": s => decodeURIComponent(s),
    "hex": s => Array.from(bytesOf(s), b => b.toString(16).padStart(2, "0")).join(" "),
    "hex decode": s => textOf(Uint8Array.from(s.replace(/[^0-9a-f]/gi, "").match(/../g) ?? [], h => parseInt(h, 16))),
    "binary": s => Array.from(bytesOf(s), b => b.toString(2).padStart(8, "0")).join(" "),
    "binary decode": s => textOf(Uint8Array.from(s.replace(/[^01]/g, "").match(/.{8}/g) ?? [], b => parseInt(b, 2))),
    "rot13": s => s.replace(/[a-z]/gi, c => String.fromCharCode((c <= "Z" ? 65 : 97) + (c.toLowerCase().charCodeAt(0) - 97 + 13) % 26)),
    "morse": s => s.toLowerCase().split(" ").map(w => [...w].map(c => MORSE[c] ?? "").filter(Boolean).join(" ")).join(" / "),
    "morse decode": s => s.trim().split(/\s*\/\s*|\s{2,}/).map(w => w.split(/\s+/).map(c => UNMORSE[c] ?? "?").join("")).join(" "),
    "reverse": s => [...s].reverse().join("")
};

export const EIGHT_BALL = [
    "It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.", "Most likely.", "Outlook good.", "Signs point to yes.",
    "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.",
    "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."
];

export function password(length: number) {
    const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+?"];
    const all = sets.join("");
    const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
    const out = sets.map(pick);
    while (out.length < length) out.push(pick(all));
    for (let k = out.length - 1; k > 0; k--) {
        const j = crypto.getRandomValues(new Uint32Array(1))[0] % (k + 1);
        [out[k], out[j]] = [out[j], out[k]];
    }
    return out.join("");
}
