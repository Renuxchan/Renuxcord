/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The playground: small working copies of a few Renuxcord plugins. The logic is lifted from the plugins themselves

(() => {
    const $ = id => document.getElementById(id);
    const toast = text => window.RenuxSite?.toast(text);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const store = {
        get(key) {
            try {
                return JSON.parse(localStorage.getItem(key) ?? "null");
            } catch {
                return null;
            }
        },
        set(key, value) {
            try {
                if (value == null) localStorage.removeItem(key);
                else localStorage.setItem(key, JSON.stringify(value));
            } catch { }
        }
    };

    /* TextFX (src/plugins/textFX/effects.ts) */

    function alphabet(upper, lower, digits, holes = {}) {
        return text => Array.from(text, ch => {
            if (holes[ch]) return String.fromCodePoint(holes[ch]);
            const c = ch.codePointAt(0);
            if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
            if (c >= 97 && c <= 122) return lower == null ? String.fromCodePoint(upper + c - 97) : String.fromCodePoint(lower + c - 97);
            if (digits != null && c >= 48 && c <= 57) return String.fromCodePoint(digits + c - 48);
            return ch;
        }).join("");
    }

    function table(from, to) {
        const src = Array.from(from);
        const dst = Array.from(to);
        const map = new Map(src.map((c, i) => [c, dst[i]]));
        return text => Array.from(text.toLowerCase(), ch => map.get(ch) ?? ch).join("");
    }

    const LOWER = "abcdefghijklmnopqrstuvwxyz";
    const upsideDown = table(`${LOWER}0123456789.,!?'"()[]{}<>&_;`, "ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz0ƖᄅƐㄣϛ9ㄥ86˙'¡¿,„)(][}{><⅋‾؛");

    function zalgo(text) {
        const marks = Array.from({ length: 0x36f - 0x300 + 1 }, (_, i) => String.fromCharCode(0x300 + i));
        const pick = () => marks[Math.floor(Math.random() * marks.length)];
        return Array.from(text, ch => (ch === " " ? ch : ch + Array.from({ length: 2 + Math.floor(Math.random() * 3) }, pick).join(""))).join("");
    }

    const FX = [
        ["bold", alphabet(0x1D5D4, 0x1D5EE, 0x1D7EC)],
        ["script", alphabet(0x1D4D0, 0x1D4EA, null)],
        ["gothic", alphabet(0x1D56C, 0x1D586, null)],
        ["double", alphabet(0x1D538, 0x1D552, 0x1D7D8, { C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 })],
        ["vaporwave", text => Array.from(text, ch => {
            const c = ch.codePointAt(0);
            if (ch === " ") return "　";
            return c >= 0x21 && c <= 0x7E ? String.fromCodePoint(c + 0xFEE0) : ch;
        }).join("")],
        ["tiny caps", table(LOWER, "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ")],
        ["upside down", text => Array.from(upsideDown(text)).reverse().join("")],
        ["zalgo", zalgo],
        ["mocking", text => {
            let upper = false;
            return Array.from(text, ch => {
                if (!/[a-z]/i.test(ch)) return ch;
                upper = !upper;
                return upper ? ch.toUpperCase() : ch.toLowerCase();
            }).join("");
        }],
        ["clap", text => `👏 ${text.trim().split(/\s+/).join(" 👏 ")} 👏`]
    ];

    const fxInput = $("fx-input");
    const fxList = $("fx-list");
    if (fxInput && fxList) {
        const render = () => {
            const text = fxInput.value || "touch grass";
            fxList.replaceChildren(...FX.map(([label, fn]) => {
                const li = document.createElement("li");
                const out = fn(text);
                li.innerHTML = `<button type="button"><span class="fx-out">${esc(out)}</span><span class="fx-name">${label}</span></button>`;
                const btn = li.firstElementChild;
                btn.addEventListener("click", async () => {
                    try {
                        await navigator.clipboard.writeText(out);
                        btn.classList.add("copied");
                        btn.lastElementChild.textContent = "copied";
                        setTimeout(() => {
                            btn.classList.remove("copied");
                            btn.lastElementChild.textContent = label;
                        }, 1400);
                    } catch {
                        toast("Couldn't copy here. Select the text instead");
                    }
                });
                return li;
            }));
        };
        fxInput.addEventListener("input", render);
        render();
    }

    /* RenuxTheme (src/plugins/renuxTheme/index.ts presets), applied to this page */

    const PRESETS = [
        ["Renuxcord", "#ff5a2c", null],
        ["Midnight", "#a78bfa", ["#07070d", "#0c0c16", "#11111d", "#181828"]],
        ["Sakura", "#f472b6", ["#140b11", "#1a0f17", "#21131d", "#2b1826"]],
        ["Ocean", "#38bdf8", ["#050d14", "#08131d", "#0c1a27", "#122434"]],
        ["Forest", "#4ade80", ["#060d09", "#09130d", "#0d1a12", "#132419"]],
        ["Ember", "#fb923c", ["#120a06", "#180e09", "#20130c", "#2a1a11"]],
        ["OLED", "#e4e4e7", ["#000000", "#000000", "#050505", "#0e0e0e"]]
    ];

    const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const mix = (a, b, t) => `#${hexRgb(a).map((v, i) => Math.round(v + (hexRgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
    const lum = hex => {
        const [r, g, b] = hexRgb(hex).map(v => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const SURFACE_VARS = ["--bg", "--bg-1", "--bg-2", "--bg-3", "--line", "--line-2"];
    const ACCENT_VARS = ["--accent", "--accent-2", "--accent-ink", "--theme-brand"];
    const swatches = $("theme-swatches");
    const picker = $("theme-color");

    function applyTheme(name, accent, surfaces, save = true) {
        const root = document.documentElement.style;
        if (name === "Renuxcord" && !surfaces && accent.toLowerCase() === "#ff5a2c") {
            for (const v of [...SURFACE_VARS, ...ACCENT_VARS]) root.removeProperty(v);
        } else {
            root.setProperty("--accent", accent);
            root.setProperty("--accent-2", mix(accent, "#ffffff", 0.18));
            root.setProperty("--accent-ink", lum(accent) > 0.25 ? "#0c0c0d" : "#ffffff");
            // RenuxTheme recolours Discord's own brand colour too, so the shots follow along
            root.setProperty("--theme-brand", accent);
            if (surfaces) {
                ["--bg", "--bg-1", "--bg-2", "--bg-3"].forEach((v, i) => root.setProperty(v, surfaces[i]));
                root.setProperty("--line", mix(surfaces[3], "#ffffff", 0.05));
                root.setProperty("--line-2", mix(surfaces[3], "#ffffff", 0.11));
            } else for (const v of SURFACE_VARS) root.removeProperty(v);
        }
        window.RenuxSite?.syncThemeColor?.();
        for (const b of swatches?.children ?? []) b.setAttribute("aria-checked", String(b.dataset.preset === name));
        if (picker) picker.value = accent;
        if (save) store.set("rx-theme", name === "Renuxcord" && accent.toLowerCase() === "#ff5a2c" ? null : { name, accent });
    }

    if (swatches) {
        for (const [name, accent, surfaces] of PRESETS) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "swatch";
            b.dataset.preset = name;
            b.setAttribute("role", "radio");
            b.setAttribute("aria-checked", String(name === "Renuxcord"));
            const s = surfaces ?? ["#0a0a0b", "#0f0f11", "#151518", "#1c1c20"];
            b.innerHTML = `<i><b style="--s: ${s[0]}"></b><b style="--s: ${s[3]}"></b><b style="--s: ${accent}"></b></i>${name}`;
            b.addEventListener("click", () => applyTheme(name, accent, surfaces));
            swatches.append(b);
        }
        picker?.addEventListener("input", () => {
            const current = PRESETS.find(p => p[0] === swatches.querySelector('[aria-checked="true"]')?.dataset.preset);
            applyTheme(current?.[0] ?? "Custom", picker.value, current?.[2] ?? null);
        });
    }

    const saved = store.get("rx-theme");
    if (saved?.accent) {
        const preset = PRESETS.find(p => p[0] === saved.name);
        applyTheme(saved.name, saved.accent, preset?.[2] ?? null, false);
    }

    /* QuickTools (src/plugins/quickTools/tools.ts) */

    const FUNCS = {
        sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
        sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, log2: Math.log2, exp: Math.exp,
        min: Math.min, max: Math.max, pow: Math.pow
    };
    const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

    function calculate(input) {
        const tokens = input.toLowerCase().replace(/×/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^")
            .match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z_]\w*|[-+*/^%(),!]|\S/g) ?? [];
        let i = 0;
        const peek = () => tokens[i];
        const eat = t => {
            const tok = tokens[i++];
            if (t && tok !== t) throw new Error(`Expected "${t}"`);
            return tok;
        };
        const factorial = n => {
            if (n < 0 || n > 170 || !Number.isInteger(n)) throw new Error("Factorial needs a whole number from 0 to 170");
            let r = 1;
            for (let k = 2; k <= n; k++) r *= k;
            return r;
        };

        function primary() {
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

        function postfix() {
            let v = primary();
            while (peek() === "!") {
                eat();
                v = factorial(v);
            }
            return v;
        }

        function unary() {
            if (peek() === "-") {
                eat();
                return -unary();
            }
            if (peek() === "+") {
                eat();
                return unary();
            }
            return power();
        }

        function power() {
            const base = postfix();
            if (peek() === "^") {
                eat();
                return base ** unary();
            }
            return base;
        }

        function term() {
            let v = unary();
            for (; ;) {
                const t = peek();
                if (t === "*" || t === "/" || t === "%") {
                    eat();
                    const r = unary();
                    v = t === "*" ? v * r : t === "/" ? v / r : v % r;
                } else if (t === "(" || (t && /^[a-z_]/.test(t))) {
                    v *= unary();
                } else return v;
            }
        }

        function expr() {
            let v = term();
            while (peek() === "+" || peek() === "-") v = eat() === "+" ? v + term() : v - term();
            return v;
        }

        if (!tokens.length) throw new Error("Type something to calculate, like 12*(3+4)");
        const result = expr();
        if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}"`);
        return result;
    }

    const prettyNumber = n => {
        if (!Number.isFinite(n)) return String(n);
        const clean = Number(n.toPrecision(12));
        return Math.abs(clean) >= 1e15 || (clean !== 0 && Math.abs(clean) < 1e-6)
            ? clean.toExponential(6)
            : clean.toLocaleString("en-US", { maximumFractionDigits: 10 });
    };

    function rollDice(spec) {
        const parts = spec.toLowerCase().replace(/\s+/g, "").match(/[+-]?[^+-]+/g);
        if (!parts) throw new Error("Try something like 2d20+5");
        let total = 0;
        const shown = [];
        for (const part of parts) {
            const sign = part.startsWith("-") ? -1 : 1;
            const body = part.replace(/^[+-]/, "");
            const dice = /^(\d*)d(\d+)$/.exec(body);
            if (dice) {
                const n = Number(dice[1] || 1);
                const sides = Number(dice[2]);
                if (n < 1 || n > 100 || sides < 2 || sides > 1000) throw new Error("Use 1-100 dice with 2-1000 sides");
                const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
                total += sign * rolls.reduce((a, b) => a + b, 0);
                shown.push(`${sign < 0 ? "- " : shown.length ? "+ " : ""}${n}d${sides} [${rolls.join(", ")}]`);
            } else if (/^\d+$/.test(body)) {
                total += sign * Number(body);
                shown.push(`${sign < 0 ? "-" : "+"} ${body}`);
            } else throw new Error(`"${body}" isn't a dice roll. Try 2d20+5`);
        }
        return { total, detail: shown.join(" ") };
    }

    const EIGHT_BALL = [
        "It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.", "Most likely.", "Outlook good.", "Signs point to yes.",
        "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.",
        "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful."
    ];

    function password(length) {
        const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+?"];
        const all = sets.join("");
        const pick = chars => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
        const out = sets.map(pick);
        while (out.length < length) out.push(pick(all));
        for (let k = out.length - 1; k > 0; k--) {
            const j = crypto.getRandomValues(new Uint32Array(1))[0] % (k + 1);
            [out[k], out[j]] = [out[j], out[k]];
        }
        return out.join("");
    }

    const pick = list => list[Math.floor(Math.random() * list.length)];

    function runCommand(raw) {
        const m = /^\/(\w+)\s*([\s\S]*)$/.exec(raw.trim());
        if (!m) return "Commands start with a slash. Try /roll 2d20+5";
        const cmd = m[1].toLowerCase();
        const arg = m[2].trim();
        try {
            switch (cmd) {
                case "calc":
                    return `🧮 \`${arg}\` = **${prettyNumber(calculate(arg))}**`;
                case "roll": {
                    const spec = arg || "1d6";
                    const { total, detail } = rollDice(spec);
                    return `🎲 **${total}** · ${spec} → ${detail}`;
                }
                case "flip":
                    return Math.random() < 0.5 ? "🪙 **Heads**" : "🪙 **Tails**";
                case "choose": {
                    const options = arg.split(/\s*,\s*|\s+or\s+|\s*\|\s*/i).map(s => s.trim()).filter(Boolean);
                    if (options.length < 2) return "🤔 Give me at least two options, separated by commas.";
                    return `🤔 I choose **${pick(options)}**`;
                }
                case "random": {
                    let [min, max] = arg.split(/\s+/).map(Number).filter(Number.isFinite);
                    min ??= 1;
                    max ??= 100;
                    if (min > max) [min, max] = [max, min];
                    return `🔢 **${min + Math.floor(Math.random() * (max - min + 1))}** (${min}–${max})`;
                }
                case "8ball":
                    if (!arg) return "🎱 Ask it something first.";
                    return `🎱 *${arg}*\n**${pick(EIGHT_BALL)}**`;
                case "password": {
                    const n = Math.min(128, Math.max(8, Number(arg) || 20));
                    return `🔑 Only you can see this:\n\`${password(n)}\``;
                }
                default:
                    return `Here you can try /roll, /calc, /flip, /choose, /random, /8ball and /password. /${cmd} lives in Discord.`;
            }
        } catch (err) {
            return `${cmd === "roll" ? "🎲" : "🧮"} ${err.message}`;
        }
    }

    // Discord-ish markdown for the replies: **bold**, *italic*, `code`
    const md = text => esc(text)
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/\*(.+?)\*/g, "<i>$1</i>")
        .replace(/`(.+?)`/g, "<code>$1</code>");

    const qtLog = $("qt-log");
    const qtForm = $("qt-form");
    const qtInput = $("qt-input");
    const qtChips = $("qt-chips");

    function runQt(raw) {
        if (!raw.trim()) return;
        const row = document.createElement("div");
        row.className = "qt-msg";
        row.innerHTML = '<span class="av bot"><img src="logo.svg" alt="" /></span><div><p class="msg-meta"><b>QuickTools</b><span class="app-tag">APP</span></p>' +
            `<p class="cmd-line">nova used <b>${esc(raw.trim().split(/\s/)[0])}</b></p><p>${md(runCommand(raw))}</p></div>`;
        qtLog.append(row);
        while (qtLog.children.length > 6) qtLog.firstElementChild.remove();
        qtLog.scrollTop = qtLog.scrollHeight;
    }

    if (qtForm) {
        qtForm.addEventListener("submit", e => {
            e.preventDefault();
            runQt(qtInput.value);
            qtInput.select();
        });
        for (const ex of ["/roll 2d20+5", "/calc 64*0.15", "/flip", "/choose pizza, sushi, tacos", "/8ball will we win tonight", "/password 16"]) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = ex;
            b.addEventListener("click", () => {
                qtInput.value = ex;
                runQt(ex);
            });
            qtChips.append(b);
        }
        runQt("/flip");
        runQt("/roll 2d20+5");
    }

    /* TypingSounds (src/plugins/typingSounds/index.ts) */

    let ac = null;
    let master = null;
    let noise = null;
    let profile = "thock";
    let lastAt = 0;

    function audio() {
        if (!ac) {
            ac = new AudioContext();
            master = ac.createGain();
            master.connect(ac.destination);
            noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate);
            const data = noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        master.gain.value = 0.45 ** 1.6;
        if (ac.state === "suspended") void ac.resume();
        return ac;
    }

    const vary = n => n * (0.92 + Math.random() * 0.16);

    function burst(at, type, freq, q, duration, gain) {
        const src = ac.createBufferSource();
        src.buffer = noise;
        const filter = ac.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;
        const env = ac.createGain();
        env.gain.setValueAtTime(gain, at);
        env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        src.connect(filter).connect(env).connect(master);
        src.start(at, Math.random() * 0.1);
        src.stop(at + duration + 0.02);
    }

    function tone(at, type, from, to, duration, gain) {
        const osc = ac.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(from, at);
        osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), at + duration);
        const env = ac.createGain();
        env.gain.setValueAtTime(gain, at);
        env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(env).connect(master);
        osc.start(at);
        osc.stop(at + duration + 0.02);
    }

    const PROFILES = {
        thock(at, key) {
            const low = key === "space" || key === "enter";
            burst(at, "lowpass", vary(low ? 1100 : 1800), 0.8, low ? 0.07 : 0.05, low ? 0.8 : 0.6);
            tone(at, "sine", vary(low ? 120 : 170), low ? 40 : 60, low ? 0.09 : 0.06, low ? 0.6 : 0.45);
        },
        clicky(at, key) {
            const f = key === "space" ? 2600 : key === "enter" ? 3000 : 4200;
            burst(at, "highpass", vary(f), 1, 0.022, 0.5);
            burst(at + 0.014, "bandpass", vary(f * 1.4), 3, 0.014, 0.35);
        },
        typewriter(at, key) {
            burst(at, "bandpass", vary(key === "space" ? 1500 : 2400), 0.8, 0.045, 0.75);
            tone(at, "triangle", vary(900), 300, 0.03, 0.12);
            if (key === "enter") {
                burst(at + 0.03, "lowpass", 900, 0.5, 0.18, 0.5);
                tone(at + 0.12, "sine", 1760, 1740, 0.7, 0.22);
                tone(at + 0.12, "sine", 3520, 3500, 0.4, 0.06);
            }
        },
        bubble(at, key) {
            const base = key === "space" ? 420 : key === "enter" ? 330 : 620;
            tone(at, "sine", vary(base), vary(base * 2.2), 0.05, 0.35);
            tone(at + 0.05, "sine", vary(base * 2.2), base * 1.6, 0.04, 0.12);
        },
        retro(at, key) {
            const scale = [523, 587, 659, 784, 880, 1047];
            const f = key === "enter" ? 1319 : key === "space" ? 392 : scale[Math.floor(Math.random() * scale.length)];
            tone(at, "square", f, f, 0.045, 0.1);
            if (key === "enter") tone(at + 0.05, "square", 1760, 1760, 0.06, 0.08);
        }
    };

    const meter = $("sound-meter");
    const bars = [];
    if (meter) {
        for (let i = 0; i < 40; i++) bars.push(meter.appendChild(document.createElement("i")));
    }

    function playKey(key) {
        try {
            audio();
            PROFILES[profile](ac.currentTime + 0.002, key);
        } catch { }
        const bar = bars[Math.floor(Math.random() * bars.length)];
        if (!bar) return;
        // A little burst around a random spot, taller for space and enter
        const at = bars.indexOf(bar);
        const peak = key === "enter" ? 92 : key === "space" ? 70 : 34 + Math.random() * 40;
        for (let d = -3; d <= 3; d++) {
            const b = bars[at + d];
            if (!b) continue;
            b.classList.add("hit");
            b.style.height = `${Math.max(6, peak * (1 - Math.abs(d) / 4) * (0.75 + Math.random() * 0.5))}%`;
        }
        setTimeout(() => {
            for (let d = -3; d <= 3; d++) {
                const b = bars[at + d];
                if (!b) continue;
                b.classList.remove("hit");
                b.style.height = "";
            }
        }, 110);
    }

    const packs = $("sound-packs");
    const soundInput = $("sound-input");
    if (packs && soundInput) {
        const PACKS = [["thock", "Thocky"], ["clicky", "Clicky"], ["typewriter", "Typewriter"], ["bubble", "Bubbles"], ["retro", "8-bit"]];
        for (const [id, label] of PACKS) {
            const b = document.createElement("button");
            b.type = "button";
            b.setAttribute("role", "radio");
            b.setAttribute("aria-checked", String(id === profile));
            b.textContent = label;
            b.addEventListener("click", () => {
                profile = id;
                for (const other of packs.children) other.setAttribute("aria-checked", String(other === b));
                ["key", "key", "space", "key", "enter"].forEach((k, i) => setTimeout(() => playKey(k), i * 110));
                soundInput.focus({ preventScroll: true });
            });
            packs.append(b);
        }
        soundInput.addEventListener("keydown", e => {
            if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
            let key;
            if (e.key === " ") key = "space";
            else if (e.key === "Enter") key = "enter";
            else if (e.key === "Backspace" || e.key === "Delete") key = "back";
            else if (e.key.length === 1) key = "key";
            else return;
            const now = performance.now();
            if (now - lastAt < 18) return;
            lastAt = now;
            playKey(key);
            if (key === "enter") setTimeout(() => {
                soundInput.value = "";
            }, 60);
        });
    }

    /* PanicBlur (src/plugins/panicBlur/index.ts), for the whole page */

    const veil = $("blur-veil");

    function setBlur(on) {
        document.body.classList.toggle("blurred", on);
        if (veil) veil.hidden = !on;
    }

    const toggleBlur = () => setBlur(!document.body.classList.contains("blurred"));

    $("blur-try")?.addEventListener("click", () => setBlur(true));
    veil?.addEventListener("click", () => setBlur(false));
    document.addEventListener("keydown", e => {
        if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === "KeyB") {
            e.preventDefault();
            toggleBlur();
        } else if (e.key === "Escape" && document.body.classList.contains("blurred")) setBlur(false);
    });

    /* Confetti (src/plugins/confetti/index.ts) */

    const COLORS = ["#a78bfa", "#ec4899", "#f59e0b", "#22d3ee", "#34d399", "#f43f5e", "#facc15", "#ffffff"];
    const TRIGGERS = ["congrats", "congratulations", "happy birthday", "hbd", "🎉", "🥳", "🎊"];
    let canvas = null;
    let pieces = [];
    let frame = 0;

    function step() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== innerWidth * dpr || canvas.height !== innerHeight * dpr) {
            canvas.width = innerWidth * dpr;
            canvas.height = innerHeight * dpr;
        }
        const g = canvas.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of pieces) {
            p.vy += 0.32;
            p.vx *= 0.985;
            p.vy *= 0.985;
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vr;
            p.tilt += 0.1;
            g.save();
            g.translate(p.x, p.y);
            g.rotate(p.rot);
            g.scale(1, Math.cos(p.tilt));
            g.fillStyle = p.color;
            if (p.round) {
                g.beginPath();
                g.arc(0, 0, p.w / 2, 0, Math.PI * 2);
                g.fill();
            } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            g.restore();
        }
        pieces = pieces.filter(p => p.y < innerHeight + 40);
        if (pieces.length) frame = requestAnimationFrame(step);
        else {
            canvas.remove();
            canvas = null;
            frame = 0;
        }
    }

    function fire(amount = 160) {
        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.className = "confetti-canvas";
            document.body.append(canvas);
        }
        const per = Math.round(amount / 2);
        for (const side of [0, 1]) {
            for (let i = 0; i < per; i++) {
                const angle = (side ? -1 : 1) * (0.35 + Math.random() * 0.45);
                const speed = 13 + Math.random() * 11;
                pieces.push({
                    x: side ? innerWidth + 10 : -10,
                    y: innerHeight * (0.75 + Math.random() * 0.1),
                    vx: Math.sin(angle) * speed,
                    vy: -Math.cos(Math.abs(angle)) * speed,
                    rot: Math.random() * Math.PI,
                    vr: (Math.random() - 0.5) * 0.3,
                    w: 6 + Math.random() * 7,
                    h: 4 + Math.random() * 5,
                    color: COLORS[Math.floor(Math.random() * COLORS.length)],
                    round: Math.random() < 0.25,
                    tilt: Math.random() * Math.PI
                });
            }
        }
        if (!frame) frame = requestAnimationFrame(step);
    }

    const said = text => {
        const lower = text.toLowerCase();
        return TRIGGERS.some(t => (/^[\p{L}\p{N} ]+$/u.test(t)
            ? new RegExp(`(?:^|[^\\p{L}\\p{N}])${t}(?=$|[^\\p{L}\\p{N}])`, "u").test(lower)
            : lower.includes(t)));
    };

    $("confetti-go")?.addEventListener("click", () => fire());
    $("confetti-form")?.addEventListener("submit", e => {
        e.preventDefault();
        const input = $("confetti-input");
        if (said(input.value)) {
            fire();
            input.value = "";
        } else toast("No trigger words in that. Try congrats or happy birthday");
    });

    window.RenuxPlay = { fire, setBlur, applyTheme: name => {
        const preset = PRESETS.find(p => p[0].toLowerCase() === name.toLowerCase());
        if (preset) applyTheme(...preset);
    } };
})();
