/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The tour at the top of the site: a Discord window with Renuxcord in it, acting out the main features scene by scene

(() => {
    const host = document.querySelector("[data-demo-fit]");
    if (!host) return;

    const stage = document.querySelector("[data-demo]");
    const chapterList = document.querySelector("[data-chapters]");
    const chapters = [...chapterList.querySelectorAll(".chapter")];
    const captionEl = document.querySelector("[data-demo-caption]");
    const clockEl = document.querySelector("[data-demo-clock]");
    const pauseBtn = document.querySelector("[data-demo-pause]");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");

    const DESK = { w: 1160, h: 680 };
    const PHONE = { w: 390, h: 680 };
    const HOLD = 2600;

    /* Bits of Discord */

    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const ic = (id, cls) => `<svg${cls ? ` class="${cls}"` : ""}><use href="#i-${id}" /></svg>`;

    const COLORS = {
        maya: "#d6336c", noor: "#0c8599", jay: "#1c7ed6", rio: "#7048e8", dev: "#2f9e44", kenji: "#f08c00", lucas: "#5c636a",
        sam: "#099268", eli: "#868e96", amira: "#c2255c", theo: "#5f3dc4", kai: "#6c757d", nova: "#a61e4d", ari: "#e67700"
    };
    const av = (who, { s, cls } = {}) =>
        `<span class="av${cls ? ` ${cls}` : ""}"${s ? ` data-s="${s}"` : ""} style="--a: ${COLORS[who]}">${who[0].toUpperCase()}</span>`;

    const GROUPS = () => [
        {
            id: "besties", icon: "💖", label: "Besties", color: "#ec4899", rows: [
                { p: "maya", s: "online", sub: "Playing Valorant" },
                { p: "noor", s: "online", sub: "Watching Frieren", badge: 2 },
                { p: "jay", s: "idle", sub: "Listening to Spotify" },
                { p: "rio", s: "offline", sub: "Last seen 3 hours ago" }
            ]
        },
        {
            id: "squad", icon: "🎮", label: "Squad", color: "#a78bfa", folded: true, rows: [
                { p: "dev", s: "online", sub: "Streaming Minecraft" },
                { p: "lucas", s: "online", sub: "Playing Rocket League", badge: 5 },
                { p: "kenji", s: "dnd", sub: "Do Not Disturb" },
                { p: "eli", s: "offline", sub: "Last seen yesterday" }
            ]
        },
        {
            id: "school", icon: "📚", label: "School", color: "#38bdf8", folded: true, rows: [
                { p: "amira", s: "online", sub: "Online" },
                { p: "theo", s: "idle", sub: "Idle" },
                { p: "ari", s: "offline", sub: "Last seen 2 days ago" }
            ]
        }
    ];

    const DMS = [
        { id: "sam", p: "sam", s: "online", sub: "Playing Fortnite" },
        { id: "nightshift", group: "night shift", sub: "6 Members" },
        { id: "theo", p: "theo", s: "idle" },
        { id: "kenji", p: "kenji", s: "dnd", sub: "Do Not Disturb" }
    ];

    const NS_LAYOUT = [
        { cat: "Info", items: [["welcome"], ["rules"], ["announcements"]] },
        { cat: "Team", items: [["general"], ["strats"], ["vod-review"], ["clips"], ["Lobby 1", "voice"], ["Lobby 2", "voice"]] },
        { cat: "Staff", lock: true, items: [["staff"], ["Staff room", "voice"]] }
    ];

    const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const online = rows => rows.filter(r => r.s !== "offline").length;

    const fgRow = (r, extra = "") =>
        `<div class="fg-row${r.s === "offline" ? " off" : ""}${r.badge ? " unread" : ""}${extra}" data-p="${r.p}">${av(r.p, { s: r.s })}` +
        `<span class="who"><b>${r.p}</b><small>${esc(r.sub)}</small></span>${r.badge ? `<span class="badge">${r.badge}</span>` : ""}</div>`;

    const fgHtml = g =>
        `<div class="fg" data-g="${g.id}" style="--c: ${g.color}"><div class="fg-head${g.folded ? " folded" : ""}">${ic("chev", "chev")}` +
        `<span class="fg-ic">${g.icon}</span><span class="fg-name">${g.label}</span><span class="fg-count">${online(g.rows)}/${g.rows.length}</span>` +
        `<span class="fg-stack">${g.rows.filter(r => r.s !== "offline").slice(0, 3).map(r => av(r.p)).join("")}</span></div>` +
        `<div class="fg-rows${g.folded ? " folded" : ""}"><div>${g.rows.map(r => fgRow(r)).join("")}</div></div></div>`;

    const searchHtml = '<span class="side-search">Find or start a conversation</span>';
    const srvHead = n => `<div class="srv-head">${esc(n)}${ic("down")}</div>`;

    function dmListHtml({ on = null, friendsOn = false } = {}) {
        const links = compact
            ? ""
            : `<div class="side-link${friendsOn ? " on" : ""}">${ic("friends")}Friends</div><div class="side-link">${ic("nitro")}Nitro</div><div class="side-rule"></div>`;
        const dms = DMS.map(d =>
            `<div class="dm${d.id === on ? " on" : ""}" data-dm="${d.id}">${d.group ? `<span class="av group">${ic("people")}</span>` : av(d.p, { s: d.s })}` +
            `<span class="who"><b>${d.group ?? d.p}</b>${d.sub ? `<small>${d.sub}</small>` : ""}</span></div>`
        ).join("");
        return `${links}${GROUPS().map(fgHtml).join("")}<div class="dm-head"><span>Direct Messages</span>${ic("plus")}</div>${dms}`;
    }

    function channelParts({ on = "general", fresh = false } = {}) {
        const anim = fresh ? " in" : "";
        const parts = [];
        for (const g of NS_LAYOUT) {
            parts.push(`<div class="cat${anim}">${ic("down")}${g.cat}${g.lock ? ic("lock", "lock") : ""}</div>`);
            for (const [n, kind] of g.items) {
                parts.push(
                    `<div class="ch${n === on ? " on" : ""}${anim}" data-ch="${slug(n)}">${ic(kind === "voice" ? "voice" : "hash")}${esc(n)}</div>` +
                    (kind === "voice" ? `<div class="vc-users" data-vc-users="${slug(n)}"></div>` : "")
                );
            }
        }
        return parts;
    }

    function rail(on, { ns = true, fresh = false } = {}) {
        const srv = (id, label, color, extra = "") => `<span class="ri${extra}${on === id ? " on" : ""}" style="--c: ${color}">${label}</span>`;
        return [
            `<span class="ri home${on === "home" ? " on" : ""}"><img src="logo.svg" alt="" /></span>`,
            '<span class="rail-sep"></span>',
            ns ? srv("ns", "NS", "#364fc7", fresh ? " new" : "") : "",
            srv("vl", "VL", "#2b8a3e", " unread"),
            srv("ac", "AC", "#862e9c"),
            srv("ln", "LN", "#a61e4d", " unread"),
            `<span class="ri add">${ic("plus")}</span>`,
            `<span class="ri explore">${ic("compass")}</span>`
        ].join("");
    }

    function msgHtml(m) {
        if (m.cont) return `<div class="msg cont"><p>${m.lines[0]}</p></div>`;
        return `<div class="msg${m.cls ? ` ${m.cls}` : ""}"${m.id ? ` data-m="${m.id}"` : ""}>${av(m.p, { cls: "lg" })}<div class="msg-body">` +
            `<p class="msg-meta"><b>${m.p}</b><time>${m.t}</time></p>${m.lines.map(l => `<p>${l}</p>`).join("")}</div></div>`;
    }

    const composerHtml = ph =>
        `<div class="composer" data-composer><span class="plus">+</span><span class="c-text" data-ctext>${esc(ph)}</span>` +
        `<span class="composer-icons">${ic("gift", "opt")}${ic("bolt", "bolt")}${ic("sticker", "opt")}${ic("smile")}</span></div>`;

    const chatHtml = ({ head, msgs, ph }) =>
        `<header class="chat-head">${ic("chev", "back")}${head}</header><div class="log" data-log>${msgs.map(msgHtml).join("")}</div>${composerHtml(ph)}`;

    const channelHead = n => `${ic("hash")}<span>${n}</span><span class="chat-head-icons">${ic("bell")}${ic("pin")}${ic("people")}${ic("search")}</span>`;
    const dmHead = (p, s) => `${av(p, { s })}<span>${p}</span><span class="chat-head-icons">${ic("phone")}${ic("video")}${ic("pin")}</span>`;
    const groupHead = n => `<span class="av group">${ic("people")}</span><span>${n}</span><span class="chat-head-icons">${ic("phone")}${ic("video")}${ic("pin")}${ic("people")}</span>`;

    function friendsHtml() {
        const rows = [
            ["maya", "online", "Playing Valorant"], ["noor", "online", "Watching Frieren"], ["jay", "idle", "Idle"],
            ["dev", "online", "Streaming Minecraft"], ["lucas", "online", "Playing Rocket League"], ["kenji", "dnd", "Do Not Disturb"]
        ];
        return `<header class="chat-head">${ic("friends")}<span>Friends</span><span class="tabs-fr"><span class="on">Online</span><span>All</span>` +
            `<span>Pending</span><span class="rx-tab">${ic("spark")}Groups</span><span class="add">Add Friend</span></span></header>` +
            `<div class="fr-list"><p>Online — ${rows.length}</p>${rows.map(([p, s, sub]) =>
                `<div class="fr-row">${av(p, { s })}<span class="who"><b>${p}</b><small>${sub}</small></span><span class="round">${ic("chat")}</span><span class="round">${ic("dots")}</span></div>`
            ).join("")}</div>`;
    }

    const introHtml = n =>
        `<header class="chat-head">${ic("chev", "back")}${channelHead(n)}</header><div class="log" data-log><div class="ch-intro"><span>${ic("hash")}</span>` +
        `<h5>Welcome to #${n}!</h5><p>This is the start of the #${n} channel.</p></div></div>${composerHtml(`Message #${n}`)}`;

    const NIGHT = [
        { p: "maya", t: "Yesterday at 11:48 PM", lines: ["ok that lobby was actually insane"] },
        { cont: true, lines: ["down 4–10 and we still won 13–11"] },
        { p: "jay", id: "jay", t: "Yesterday at 11:51 PM", lines: ["i flashed my own team twice. we're not talking about it"] },
        { p: "noor", t: "Yesterday at 11:52 PM", lines: ["friday 8pm again? i can bring a fifth"] },
        { p: "kenji", t: "Yesterday at 11:58 PM", lines: ["only if jay buys his own flashes 💀"] }
    ];
    const GENERAL = [
        { p: "dev", t: "Today at 3:02 PM", lines: ["gg last night, that clutch was disgusting"] },
        { p: "lucas", t: "Today at 3:40 PM", lines: ["who's on tonight"] },
        { p: "kenji", t: "Today at 3:41 PM", lines: ["me after 9, need to finish this essay first"] },
        { cont: true, lines: ["(i will not finish the essay)"] }
    ];
    const LUCAS = [
        { p: "lucas", t: "Today at 7:12 PM", lines: ["you on tonight?", "new season dropped, ranked is so back"] },
        { p: "nova", t: "Today at 7:20 PM", lines: ["say less"] },
        { p: "lucas", t: "Today at 7:21 PM", lines: ["bring sam, we need a third"] }
    ];
    const SUMMARY = "You missed 48 messages. They came back from 4–10 to win 13–11, Jay flashed his own team twice and isn't living it down, and Friday at 8 PM is on, with Noor bringing a fifth.";
    const AI_CMDS = [
        ["/ai ask", "Ask Claude anything. Only you see the answer unless you set public"],
        ["/ai catchup", "Summarize everything you haven't read in this channel"],
        ["/ai summarize", "Summarize the recent conversation in this channel"],
        ["/ai rewrite", "Rewrite your text and put it in the message box"],
        ["/ai translate", "Translate text and put it in the message box"]
    ];
    const PAL_START = [
        ["Renuxcord", "Open Renuxcord settings"], ["Renuxcord", "Reload Discord", "Ctrl+R"], ["Profiles", 'Switch to profile "Gaming"'],
        ["Night Shift", "Go to #strats"], ["DMs", "Message noor"]
    ];
    const PAL_FRI = [
        [["Plugins", "Enable FakeDeafen"], ["Plugins", "Enable FocusMode"], ["Plugins", "Enable FriendGroups"], ["Plugins", "Disable FriendWatch"]],
        [["Plugins", "Enable FriendGroups"], ["Plugins", "Enable FriendTimes"], ["Plugins", "Disable FriendWatch"]],
        [["Plugins", "Enable FriendGroups"], ["Plugins", "Enable FriendTimes"], ["Plugins", "Disable FriendWatch"]]
    ];
    const PAL_GAM = [
        [["Profiles", 'Switch to profile "Gaming"'], ["Night Shift", "Go to #general"], ["Plugins", "Enable GhostPingAlert"], ["Plugins", "Enable GameActivityToggle"]],
        [["Profiles", 'Switch to profile "Gaming"'], ["Plugins", "Enable GameActivityToggle"]],
        [["Profiles", 'Switch to profile "Gaming"'], ["Plugins", "Enable GameActivityToggle"]]
    ];
    const COOKIE = "can you finish my trades for me? cookie: _|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you";
    const PROMPT = "make me a server called Night Shift for my valorant team: roles for coach, players and subs, a private staff area, voice lobbies and a rules channel";

    /* The window */

    const win = document.createElement("div");
    win.className = "dw dc";
    win.setAttribute("aria-hidden", "true");
    win.innerHTML =
        '<div class="dw-title"><span class="dw-tl"><span class="lights"><i></i><i></i><i></i></span></span><span class="dw-where" data-where></span>' +
        `<span class="dw-tr">${ic("inbox")}${ic("help")}<span class="win-ctl"><i class="min"></i><i class="max"></i><i class="x"></i></span></span></div>` +
        `<div class="dw-status"><span>9:41</span><span class="ps-icons">${ic("signal")}<i class="batt"></i></span></div>` +
        '<div class="dw-body"><nav class="dw-rail" data-rail></nav><aside class="dw-side"><div class="side-top" data-side-top></div>' +
        '<div class="side-list" data-side></div></aside><section class="dw-chat" data-chat></section>' +
        `<div class="dw-me"><div class="vc-panel" data-vc><div><div class="vc-in">${ic("signal")}<span class="vc-state"><b data-vc-state>Connecting</b>` +
        `<small>Lobby 1 / Night Shift</small></span>${ic("hangup", "hang")}</div></div></div><div class="me-row">${av("nova", { s: "online" })}` +
        `<span class="who"><b>nova</b><small>Online</small></span><span class="me-icons">${ic("mic")}${ic("headset")}${ic("cog")}</span></div></div>` +
        `<div class="dw-tabs"><span>${ic("home")}Home</span><span>${ic("bell")}Notifications</span><span>${av("nova")}You</span></div></div>` +
        '<div class="dw-callout" data-callout><span></span></div>' +
        '<div class="dw-cursor" data-cursor><svg viewBox="0 0 24 24"><path d="M5 2.8v16.6l4.4-4.2 3 6.7 2.9-1.3-3-6.6 6.1-.3z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round" /></svg><i class="tap"></i></div>';
    host.append(win);

    const q = sel => win.querySelector(sel);
    const ui = {
        where: q("[data-where]"),
        rail: q("[data-rail]"),
        sideTop: q("[data-side-top]"),
        side: q("[data-side]"),
        chat: q("[data-chat]"),
        vc: q("[data-vc]"),
        vcState: q("[data-vc-state]"),
        callout: q("[data-callout]"),
        cursor: q("[data-cursor]")
    };

    const platform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
    if (platform.startsWith("mac") && navigator.maxTouchPoints < 2) win.classList.add("mac");

    function setWhere(kind, label) {
        if (kind === "server") ui.where.innerHTML = `<span class="mini">NS</span>${esc(label)}`;
        else if (kind === "dm") ui.where.innerHTML = `${av(label)}${esc(label)}`;
        else ui.where.innerHTML = `${ic(kind)}${esc(label)}`;
    }

    function count(id, text) {
        const el = q(`[data-g="${id}"] .fg-count`);
        el.textContent = text;
        el.classList.remove("flip");
        void el.offsetWidth;
        el.classList.add("flip");
    }

    function fold(id, folded) {
        q(`[data-g="${id}"] .fg-head`).classList.toggle("folded", folded);
        q(`[data-g="${id}"] .fg-rows`).classList.toggle("folded", folded);
    }

    function temp(cls, html) {
        const node = document.createElement("div");
        node.className = cls;
        node.dataset.temp = "";
        node.innerHTML = html;
        win.append(node);
        return node;
    }

    /* Where things are, in the window's own pixels */

    let scale = 1;
    let compact = false;
    const cur = { x: 0, y: 0 };

    function local(el) {
        const w = win.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return { x: (r.left - w.left) / scale, y: (r.top - w.top) / scale, w: r.width / scale, h: r.height / scale };
    }

    function placeCursor(x, y, ms) {
        ui.cursor.style.setProperty("--cd", `${ms}ms`);
        ui.cursor.style.transform = `translate(${x}px, ${y}px)`;
        cur.x = x;
        cur.y = y;
    }

    /* Scenes run on a clock that can be paused and cancelled */

    const CANCEL = new Error("scene cancelled");
    let token = 0;
    let paused = false;
    let waiters = [];
    let elapsed = 0;

    function resume() {
        const list = waiters;
        waiters = [];
        for (const fn of list) fn();
    }

    const whilePaused = () => (paused ? new Promise(r => waiters.push(r)) : null);

    function makeCtx(mine, instant) {
        const check = () => {
            if (mine !== token) throw CANCEL;
        };

        async function wait(ms) {
            check();
            if (instant) return;
            await whilePaused();
            check();
            elapsed += ms;
            await new Promise(r => setTimeout(r, ms));
            check();
            await whilePaused();
            check();
        }

        const el = t => (typeof t === "string" ? q(t) : t);
        const point = (t, { dx = 0.5, dy = 0.5, ox = 0, oy = 0 } = {}) => {
            const r = local(el(t));
            return [r.x + r.w * dx + ox, r.y + r.h * dy + oy];
        };

        async function move(t, opts = {}) {
            if (instant) return;
            const [x, y] = point(t, opts);
            const ms = opts.ms ?? Math.round(Math.min(900, Math.max(380, Math.hypot(x - cur.x, y - cur.y) * 1.1)));
            ui.cursor.classList.add("on");
            placeCursor(x, y, ms);
            await wait(ms + 60);
        }

        async function click(t, opts) {
            if (t) await move(t, opts);
            if (instant) return;
            ui.cursor.classList.add("down");
            await wait(110);
            ui.cursor.classList.remove("down", "click");
            void ui.cursor.offsetWidth;
            ui.cursor.classList.add("click");
            await wait(150);
        }

        // Picks something up under the cursor and carries it to a drop target
        async function drag(src, dst, opts = {}) {
            if (instant) return;
            const from = local(src);
            const grab = [cur.x - from.x, cur.y - from.y];
            const ghost = temp(`ghost ${src.className.replace(/\b(hover|on)\b/g, "")}`, src.innerHTML);
            ghost.style.width = `${from.w}px`;
            ghost.style.transition = "none";
            ghost.style.transform = `translate(${from.x}px, ${from.y}px)`;
            void ghost.offsetWidth;
            ghost.style.transition = "";
            ui.cursor.classList.add("down");
            await wait(180);

            const [x, y] = point(dst, opts);
            const ms = 950;
            placeCursor(x, y, ms);
            ghost.style.transitionDuration = `${ms}ms`;
            ghost.style.transform = `translate(${x - grab[0]}px, ${y - grab[1]}px)`;
            await wait(ms * 0.6);
            el(dst).classList.add("drop");
            await wait(ms * 0.4 + 160);
            ui.cursor.classList.remove("down");
            ghost.remove();
            el(dst).classList.remove("drop");
        }

        async function type(node, text, { cps = 16, append = false } = {}) {
            node.classList.add("typed");
            if (!append) node.textContent = "";
            if (instant) {
                node.textContent += text;
                return;
            }
            node.classList.add("typing");
            for (const ch of text) {
                node.textContent += ch;
                await wait(Math.round((1000 / cps) * (0.55 + Math.random() * 0.9)));
            }
            node.classList.remove("typing");
        }

        async function stream(node, text, { wps = 16 } = {}) {
            if (instant) {
                node.textContent = text;
                return;
            }
            node.textContent = "";
            node.classList.add("stream-caret");
            const words = text.split(" ");
            for (let i = 0; i < words.length; i++) {
                node.textContent += (i ? " " : "") + words[i];
                await wait(Math.round((1000 / wps) * (0.6 + Math.random() * 0.8)));
            }
            node.classList.remove("stream-caret");
        }

        function callout(t, label, { pad = 6, below = false } = {}) {
            const r = local(el(t));
            const box = ui.callout;
            const place = () => Object.assign(box.style, {
                left: `${r.x - pad}px`,
                top: `${r.y - pad}px`,
                width: `${r.w + pad * 2}px`,
                height: `${r.h + pad * 2}px`
            });
            if (box.classList.contains("on")) place();
            else {
                box.style.transition = "none";
                place();
                void box.offsetWidth;
                box.style.transition = "";
            }
            box.firstChild.textContent = label;
            box.classList.toggle("below", below || r.y - pad < 30);
            box.classList.add("on");
            dispatchEvent(new CustomEvent("renuxdemo:callout", { detail: { scene: current, label } }));
        }

        const uncallout = () => ui.callout.classList.remove("on");

        async function keys(list) {
            if (instant) return;
            const box = temp("dw-keys", list.map(k => `<kbd>${k}</kbd>`).join(""));
            for (const k of box.children) {
                await wait(190);
                k.classList.add("down");
            }
            await wait(420);
            for (const k of box.children) k.classList.remove("down");
            await wait(200);
            box.remove();
        }

        function toast(text) {
            win.querySelector(".dw-toast")?.remove();
            return temp("dw-toast", `${ic("check")}<span>${esc(text)}</span>`);
        }

        async function focus(panel) {
            win.dataset.focus = panel;
            if (compact) await wait(450);
        }

        return { wait, move, click, drag, type, stream, callout, uncallout, keys, toast, focus, instant, at: () => [cur.x, cur.y] };
    }

    function menu(items, x, y) {
        const m = temp("cm", items.map(i => (i === "-"
            ? '<div class="cm-sep"></div>'
            : `<div class="cm-i"${i.k ? ` data-k="${i.k}"` : ""}>${i.t}${i.sub ? ic("chev") : ""}</div>`)).join(""));
        m.style.left = `${Math.max(8, Math.min(x, win.offsetWidth - m.offsetWidth - 8))}px`;
        m.style.top = `${Math.max(44, Math.min(y, win.offsetHeight - m.offsetHeight - 8))}px`;
        return m;
    }

    function palette(c) {
        const box = temp("dw-overlay top", '<div class="modal pal-dc"><div class="modal-head"><h4>Command Palette</h4><p>Plugins, settings, profiles, servers and quick actions</p></div>' +
            '<div class="modal-body"><div class="pal-q typing"></div><div class="pal-items"></div></div></div>');
        const input = box.querySelector(".pal-q");
        const list = box.querySelector(".pal-items");
        const render = (items, sel = 0) => {
            list.innerHTML = items.map(([sec, lab, hint], i) =>
                `<div class="pal-it${i === sel ? " sel" : ""}"><span class="sec">${esc(sec)}</span><span class="lab">${esc(lab)}</span>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`
            ).join("");
        };
        render(PAL_START);
        return {
            modal: box.firstElementChild,
            async typeIn(text, steps) {
                for (let i = 0; i < text.length; i++) {
                    input.textContent += text[i];
                    render(steps[i] ?? steps.at(-1));
                    await c.wait(230 + Math.round(Math.random() * 120));
                }
            },
            select(i) {
                [...list.children].forEach((n, k) => n.classList.toggle("sel", k === i));
            },
            close: () => box.remove()
        };
    }

    /* The scenes */

    const SCENES = [
        {
            title: "Friend Groups",
            caption: "Friend Groups puts your friends into folders right in the DM list: an emoji, a colour and an online count for each, and drag and drop to sort people.",
            dur: 13500,
            setup() {
                setWhere("friends", "Friends");
                ui.rail.innerHTML = rail("home");
                ui.sideTop.innerHTML = searchHtml;
                ui.side.innerHTML = dmListHtml({ friendsOn: true });
                ui.chat.innerHTML = friendsHtml();
                win.dataset.focus = "side";
            },
            async play(c) {
                await c.wait(700);
                c.callout('[data-g="besties"]', "Friend Groups", { pad: 4 });
                await c.wait(1300);

                const rio = q('[data-p="rio"]');
                rio.classList.remove("off");
                rio.querySelector(".av").dataset.s = "online";
                rio.querySelector("small").textContent = "Online";
                count("besties", "4/4");
                await c.wait(1500);
                c.uncallout();

                const sam = q('[data-dm="sam"]');
                await c.move(sam, { dx: 0.3 });
                sam.classList.add("hover");
                await c.drag(sam, '[data-g="besties"] .fg-head', { dx: 0.55 });
                sam.classList.remove("hover");
                q('[data-g="besties"] .fg-rows > div').insertAdjacentHTML("beforeend", fgRow({ p: "sam", s: "online", sub: "Playing Fortnite" }, " fresh"));
                count("besties", "5/5");
                await c.wait(1200);

                await c.click('[data-g="besties"] .fg-head', { dx: 0.3 });
                fold("besties", true);
                await c.wait(650);
                await c.click('[data-g="squad"] .fg-head', { dx: 0.3 });
                fold("squad", false);
                await c.wait(900);

                const lucas = q('[data-g="squad"] [data-p="lucas"]');
                await c.click(lucas, { dx: 0.4 });
                lucas.classList.remove("unread");
                lucas.querySelector(".badge")?.remove();
                setWhere("dm", "lucas");
                ui.chat.innerHTML = chatHtml({ head: dmHead("lucas", "online"), msgs: LUCAS, ph: "Message @lucas" });
                await c.focus("chat");
                await c.wait(300);
            }
        },
        {
            title: "RenuxAI",
            caption: "/ai catchup reads everything you missed and sums it up, only for you. Right-click any message to get it explained, translated or answered.",
            dur: 14500,
            setup() {
                setWhere("people", "night shift");
                ui.rail.innerHTML = rail("home");
                ui.sideTop.innerHTML = searchHtml;
                ui.side.innerHTML = dmListHtml({ on: "nightshift" });
                ui.chat.innerHTML = chatHtml({ head: groupHead("night shift"), msgs: NIGHT, ph: "Message night shift" });
                win.dataset.focus = "chat";
            },
            async play(c) {
                const composer = q("[data-composer]");
                const text = q("[data-ctext]");
                await c.wait(600);
                await c.click(composer, { dx: 0.3 });
                composer.classList.add("focus");
                await c.type(text, "/ai", { cps: 9 });

                const auto = document.createElement("div");
                auto.className = "auto";
                const list = compact ? AI_CMDS.slice(0, 3) : AI_CMDS;
                auto.innerHTML = `<p class="auto-h">RenuxAI</p>${list.map(([cmd, d], i) =>
                    `<div class="auto-i${i === 0 ? " sel" : ""}"><img class="auto-ic" src="logo.svg" alt="" /><b>${cmd}</b><span>${d}</span></div>`
                ).join("")}`;
                ui.chat.append(auto);
                await c.wait(500);
                await c.type(text, " catchup", { cps: 14, append: true });
                auto.innerHTML = `<p class="auto-h">RenuxAI</p><div class="auto-i sel"><img class="auto-ic" src="logo.svg" alt="" /><b>${AI_CMDS[1][0]}</b><span>${AI_CMDS[1][1]}</span></div>`;
                await c.wait(750);

                auto.remove();
                text.classList.remove("typed");
                text.textContent = "Message night shift";
                composer.classList.remove("focus");
                q("[data-log]").insertAdjacentHTML("beforeend",
                    '<div class="msg new" data-ai><span class="av lg bot"><img src="logo.svg" alt="" /></span><div class="msg-body"><p class="msg-meta"><b>RenuxAI</b><span class="app-tag">APP</span>' +
                    '<time>Today at 9:12 AM</time></p><p data-ai-text><span class="typing-dots"><i></i><i></i><i></i></span></p></div></div>');
                await c.wait(1300);
                await c.stream(q("[data-ai-text]"), SUMMARY, { wps: 17 });
                q("[data-ai] .msg-body").insertAdjacentHTML("beforeend", `<p class="eph">${ic("eye")}Only you can see this · <u>Dismiss message</u></p>`);
                c.callout("[data-ai]", "RenuxAI · /ai catchup", { pad: 2 });
                await c.wait(1900);
                c.uncallout();
                if (compact) return;

                const jay = q('[data-m="jay"]');
                await c.move(jay, { dx: 0.42, dy: 0.55 });
                jay.classList.add("hover");
                await c.wait(250);
                const [mx, my] = c.at();
                const main = menu([{ t: "Add Reaction", sub: true }, { t: "Reply" }, { t: "Copy Text" }, "-", { t: "RenuxAI", sub: true, k: "rx" }, "-", { t: "Copy Message Link" }], mx + 6, my - 120);
                await c.wait(500);
                const rx = main.querySelector('[data-k="rx"]');
                await c.move(rx, { dx: 0.4, ms: 420 });
                rx.classList.add("open");
                const sub = menu([{ t: "Explain this" }, { t: "Summarize from here" }, { t: "Suggest a reply" }, { t: "Translate to English" }],
                    parseFloat(main.style.left) + main.offsetWidth + 4, local(rx).y - 6);
                await c.wait(380);
                const suggest = sub.children[2];
                await c.move(suggest, { dx: 0.35, ms: 420 });
                suggest.classList.add("sel");
                await c.wait(400);
            }
        },
        {
            title: "Command palette",
            caption: "CommandPalette: Ctrl+Shift+K, a few letters, Enter. Switch any plugin on or off, change plugin profiles, or jump to a server, channel or DM.",
            dur: 12600,
            setup() {
                setWhere("server", "Night Shift");
                ui.rail.innerHTML = rail("ns");
                ui.sideTop.innerHTML = srvHead("Night Shift");
                ui.side.innerHTML = channelParts().join("");
                ui.chat.innerHTML = chatHtml({ head: channelHead("general"), msgs: GENERAL, ph: "Message #general" });
                win.dataset.focus = "chat";
            },
            async play(c) {
                await c.wait(700);
                await c.keys(["Ctrl", "Shift", "K"]);
                const pal = palette(c);
                c.callout(pal.modal, "Command palette · Ctrl+Shift+K", { pad: 6 });
                await c.wait(700);
                await pal.typeIn("fri", PAL_FRI);
                await c.wait(450);
                pal.select(1);
                await c.wait(380);
                pal.select(0);
                await c.wait(500);
                pal.close();
                c.uncallout();
                c.toast("FriendGroups enabled");
                await c.wait(1700);
                win.querySelector(".dw-toast")?.remove();

                await c.keys(["Ctrl", "Shift", "K"]);
                const again = palette(c);
                await c.wait(300);
                await again.typeIn("gam", PAL_GAM);
                await c.wait(750);
                again.close();
                c.toast('Profile "Gaming": 12 plugins switched');
                await c.wait(300);
            }
        },
        {
            title: "Safety",
            caption: "LinkSafety flags look-alike links before anyone clicks them, and SecretGuard stops you before your token, a Roblox cookie or a card number goes out.",
            dur: 13300,
            setup() {
                setWhere("server", "Night Shift");
                ui.rail.innerHTML = rail("ns");
                ui.sideTop.innerHTML = srvHead("Night Shift");
                ui.side.innerHTML = channelParts().join("");
                ui.chat.innerHTML = chatHtml({ head: channelHead("general"), msgs: GENERAL, ph: "Message #general" });
                win.dataset.focus = "chat";
            },
            async play(c) {
                await c.wait(800);
                q("[data-log]").insertAdjacentHTML("beforeend", msgHtml({
                    p: "kai", id: "kai", cls: "new", t: "Today at 4:17 PM",
                    lines: ["free steam gift for the first 5 people <a>https://steamcommunlty.com/gift/7a2c</a>"]
                }));
                await c.wait(1000);
                q('[data-m="kai"] .msg-body').insertAdjacentHTML("beforeend",
                    '<div class="ls"><b>⚠️ Careful with this link</b><ul><li>steamcommunlty.com looks like steamcommunity but isn’t an official steamcommunity site</li>' +
                    "<li>Classic free-gift scam wording next to a link</li></ul></div>");
                c.callout('[data-m="kai"] .ls', "LinkSafety", { pad: 4 });
                await c.wait(2100);
                c.uncallout();

                const composer = q("[data-composer]");
                await c.click(composer, { dx: 0.4 });
                composer.classList.add("focus");
                await c.type(q("[data-ctext]"), COOKIE, { cps: 44 });
                await c.wait(450);

                const box = temp("dw-overlay", '<div class="modal"><div class="modal-head"><h4>🛡️ Hold on, that looks secret</h4><p>Your message seems to contain a Roblox login cookie (.ROBLOSECURITY). Anyone who sees it can use it.</p></div>' +
                    '<div class="modal-body"><div class="secret-list">a Roblox login cookie (.ROBLOSECURITY): _|WA••••••••••••ou</div></div>' +
                    '<div class="modal-foot"><span class="dbtn" data-no>Don’t send</span><span class="dbtn red">Send anyway</span></div></div>');
                c.callout(box.firstElementChild, "SecretGuard", { pad: 6 });
                await c.wait(1800);
                const no = box.querySelector("[data-no]");
                await c.click(no);
                no.classList.add("press");
                await c.wait(160);
                box.remove();
                c.uncallout();
                await c.wait(200);
            }
        },
        {
            title: "Voice unblocker",
            caption: "Where Discord voice is blocked, like in the UAE, VoiceChatUnblocker gets the call through: decoy packets first, and a new trick whenever one fails. No VPN.",
            dur: 13200,
            setup() {
                setWhere("server", "Night Shift");
                ui.rail.innerHTML = rail("ns");
                ui.sideTop.innerHTML = srvHead("Night Shift");
                ui.side.innerHTML = channelParts().join("");
                ui.chat.innerHTML = chatHtml({ head: channelHead("general"), msgs: GENERAL, ph: "Message #general" });
                win.dataset.focus = "side";
            },
            async play(c) {
                await c.wait(700);
                const lobby = q('[data-ch="lobby1"]');
                await c.click(lobby, { dx: 0.3 });
                q('[data-ch="general"]').classList.remove("on");
                lobby.classList.add("on");
                const users = q('[data-vc-users="lobby1"]');
                users.innerHTML = `<div class="vc-user" data-vu="nova">${av("nova")}<span>nova</span></div>`;
                ui.vcState.textContent = "Connecting";
                ui.vc.classList.add("open");
                await c.wait(400);

                const log = temp("dw-vcu", `<div class="vcu-h">${ic("spark")}VoiceChatUnblocker<em>relay 127.0.0.1:50311</em></div><div class="vcu-log"></div>`).lastElementChild;
                const line = (text, cls = "") => log.insertAdjacentHTML("beforeend", `<p${cls ? ` class="${cls}"` : ""}>${text}</p>`);
                line("→ voice server dubai7412.discord.media");
                await c.wait(600);
                line("try 1 · junk decoys, then IP discovery…");
                await c.wait(1500);
                line("no answer in 1.5 s, next trick", "no");
                await c.wait(500);
                line("try 2 · junk + low TTL, fresh port…");
                await c.wait(900);
                line("answered in 61 ms. voice is through", "yes");
                await c.wait(500);

                ui.vc.classList.add("ok");
                ui.vcState.textContent = "Voice Connected";
                for (const p of ["maya", "jay", "noor"]) {
                    users.insertAdjacentHTML("beforeend", `<div class="vc-user" data-vu="${p}">${av(p)}<span>${p}</span></div>`);
                    await c.wait(220);
                }
                log.parentElement.remove();
                if (!compact) {
                    setWhere("voice", "Lobby 1");
                    ui.chat.innerHTML = `<header class="chat-head">${ic("voice")}<span>Lobby 1</span><span class="chat-head-icons">${ic("people")}</span></header>` +
                        `<div class="call">${["nova", "maya", "jay", "noor"].map(p =>
                            `<div class="tile" data-tile="${p}" style="--t: color-mix(in srgb, ${COLORS[p]} 32%, #18181b)">${av(p)}<em>${p}</em></div>`
                        ).join("")}</div><div class="call-bar"><span>${ic("mic")}</span><span>${ic("video")}</span><span>${ic("screen")}</span><span class="red">${ic("hangup")}</span></div>`;
                }
                c.callout(".dw-me", "VoiceChatUnblocker · no VPN", { pad: 4 });

                const talk = async (p, ms) => {
                    for (const n of win.querySelectorAll(`[data-vu="${p}"], [data-tile="${p}"]`)) n.classList.add("talk");
                    await c.wait(ms);
                    for (const n of win.querySelectorAll(`[data-vu="${p}"], [data-tile="${p}"]`)) n.classList.remove("talk");
                };
                await c.wait(300);
                await talk("maya", 900);
                await talk("jay", 700);
                await c.wait(200);
                await talk("maya", 600);
                await talk("noor", 800);
            }
        },
        {
            title: "Server builder",
            caption: "RenuxBridge hooks Discord up to Claude Code over MCP. Describe the server you want, and the roles, private categories and voice lobbies get built for you.",
            dur: 12500,
            setup() {
                setWhere("friends", "Friends");
                ui.rail.innerHTML = rail("home", { ns: false });
                ui.sideTop.innerHTML = searchHtml;
                ui.side.innerHTML = dmListHtml({ friendsOn: true });
                ui.chat.innerHTML = friendsHtml();
                win.dataset.focus = "side";
            },
            async play(c) {
                await c.wait(500);
                const term = temp("dw-term", '<div class="term-bar"><span class="lights"><i></i><i></i><i></i></span><span>claude · ~/servers</span></div><div class="term-body"></div>').lastElementChild;
                const add = (cls, html) => {
                    const p = document.createElement("p");
                    p.className = cls;
                    p.innerHTML = html;
                    term.append(p);
                    return p;
                };
                await c.wait(400);
                await c.type(add("t-you", ""), PROMPT, { cps: 62 });
                await c.wait(500);
                add("t-call", '<span class="t-dot">⏺</span> renuxcord - create_server (MCP)(name: "Night Shift", layout: {…})');
                const out = add("t-out", '⎿&nbsp; <span class="spin">✻</span> Building…');
                await c.wait(700);

                ui.rail.innerHTML = rail("ns", { fresh: true });
                setWhere("server", "Night Shift");
                ui.sideTop.innerHTML = srvHead("Night Shift");
                ui.side.innerHTML = "<div data-built></div>";
                ui.chat.innerHTML = introHtml("welcome");
                const built = q("[data-built]");
                for (const part of channelParts({ on: "welcome", fresh: true })) {
                    built.insertAdjacentHTML("beforeend", part);
                    await c.wait(110);
                }
                out.innerHTML = "⎿&nbsp; Created Night Shift: 4 roles, 3 categories, 11 channels";
                await c.wait(600);
                add("t-call", '<span class="t-dot">⏺</span> renuxcord - create_invite (MCP)(server: "Night Shift", channel: "welcome")');
                await c.wait(800);
                add("t-out", "⎿&nbsp; Invite ready, expires in 7 days");
                await c.wait(600);
                add("t-done", '<span class="t-dot">⏺</span> Done. Roles go Coach › Players › Subs › Members, STAFF is hidden from everyone but Coach, and both lobbies are open to Players and Subs.');
                if (compact) c.callout(".ri.on", "Built by Claude Code", { pad: 4 });
                else c.callout("[data-built]", "Built by Claude Code", { pad: 4, below: true });
                await c.wait(300);
            }
        }
    ];

    /* Playing them */

    let current = 0;
    let running = false;
    let hovering = false;
    let visible = false;

    function reset() {
        for (const n of win.querySelectorAll("[data-temp]")) n.remove();
        ui.callout.classList.remove("on");
        ui.cursor.classList.remove("on", "down", "click");
        const size = compact ? PHONE : DESK;
        placeCursor(size.w * 0.72, size.h * 0.88, 0);
        ui.vc.classList.remove("open", "ok", "bad");
        win.dataset.focus = "side";
    }

    function select(i) {
        chapters.forEach((ch, n) => {
            ch.setAttribute("aria-selected", String(n === i));
            ch.tabIndex = n === i ? 0 : -1;
        });
        const ch = chapters[i];
        ch.style.setProperty("--dur", `${SCENES[i].dur}ms`);
        const bar = ch.querySelector(".ch-bar");
        bar.style.animation = "none";
        void bar.offsetWidth;
        bar.style.animation = "";
        captionEl.textContent = SCENES[i].caption;
        clockEl.textContent = `${String(i + 1).padStart(2, "0")}/${String(SCENES.length).padStart(2, "0")} · ${SCENES[i].title}`;
    }

    async function play(i, { instant = reduced.matches, once = false } = {}) {
        const mine = ++token;
        resume();
        current = i;
        elapsed = 0;
        reset();
        select(i);
        SCENES[i].setup();
        const ctx = makeCtx(mine, instant);
        try {
            await SCENES[i].play(ctx);
            if (instant || once) return;
            if (location.search.includes("demo-debug")) console.log(`[demo] ${SCENES[i].title}: ${elapsed} ms of ${SCENES[i].dur}`);
            await ctx.wait(Math.max(HOLD, SCENES[i].dur - elapsed));
            while (hovering) await ctx.wait(400);
            if (mine === token && running) play((i + 1) % SCENES.length);
        } catch (err) {
            if (err !== CANCEL) console.error(err);
        }
    }

    function start() {
        if (running) return;
        running = true;
        play(current);
    }

    function stop() {
        if (!running) return;
        running = false;
        token++;
        resume();
    }

    function fit() {
        const avail = host.clientWidth;
        const wantCompact = avail < 760;
        if (wantCompact !== compact) {
            compact = wantCompact;
            win.classList.toggle("compact", compact);
            if (running) play(current);
            else {
                reset();
                SCENES[current].setup();
            }
        }
        const size = compact ? PHONE : DESK;
        scale = Math.min(1, avail / size.w);
        win.style.width = `${size.w}px`;
        win.style.height = `${size.h}px`;
        win.style.transform = `translate(${Math.max(0, (avail - size.w * scale) / 2)}px, 0) scale(${scale})`;
        host.style.height = `${Math.round(size.h * scale)}px`;
    }

    compact = host.clientWidth < 760;
    win.classList.toggle("compact", compact);
    fit();
    reset();
    select(0);
    SCENES[0].setup();
    chapterList.classList.toggle("still", reduced.matches);
    new ResizeObserver(fit).observe(host);

    new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !document.hidden) start();
        else stop();
    }, { threshold: 0.3 }).observe(stage);

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) stop();
        else if (visible) start();
    });

    stage.addEventListener("pointerenter", e => {
        if (e.pointerType === "mouse") hovering = true;
    });
    stage.addEventListener("pointerleave", () => {
        hovering = false;
    });

    function setPaused(on) {
        paused = on;
        pauseBtn.setAttribute("aria-pressed", String(on));
        pauseBtn.querySelector("span").textContent = on ? "Play" : "Pause";
        pauseBtn.querySelector("use").setAttribute("href", on ? "#i-play" : "#i-pause");
        chapterList.classList.toggle("paused", on);
        if (!on) resume();
    }

    pauseBtn.addEventListener("click", () => setPaused(!paused));
    if (reduced.matches) pauseBtn.hidden = true;

    chapters.forEach((ch, i) => {
        ch.addEventListener("click", () => {
            if (paused) setPaused(false);
            running = true;
            play(i);
        });
        ch.addEventListener("keydown", e => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const next = (i + (e.key === "ArrowRight" ? 1 : -1) + chapters.length) % chapters.length;
            chapters[next].focus();
            chapters[next].click();
        });
    });

    // For rendering the README art: RenuxDemo.play(2, { once: true }) plays one scene, { instant: true } shows how it ends
    window.RenuxDemo = {
        scenes: SCENES.length,
        play(i, opts) {
            running = !opts?.instant && !opts?.once;
            return play(i, opts);
        },
        pause: on => setPaused(on),
        stop
    };
})();
