/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const $ = id => document.getElementById(id);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Toasts, shared with the playground */

    const toastBox = $("toasts");
    function toast(text) {
        const t = document.createElement("div");
        t.className = "toast";
        t.innerHTML = '<svg aria-hidden="true"><use href="#i-check" /></svg><span></span>';
        t.lastElementChild.textContent = text;
        toastBox.append(t);
        setTimeout(() => {
            t.classList.add("out");
            setTimeout(() => t.remove(), 260);
        }, 2200);
    }

    // Link embeds get the orange theme colour from the HTML; people browsing get the page's own background
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const syncThemeColor = () => {
        if (themeMeta) themeMeta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0a0a0b";
    };
    syncThemeColor();

    window.RenuxSite = { toast, syncThemeColor };

    /* Links and downloads */

    const { repo } = document.body.dataset;
    const file = n => `https://github.com/${repo}/releases/latest/download/${n}`;
    const links = {
        repo: `https://github.com/${repo}`,
        releases: `https://github.com/${repo}/releases`,
        issues: `https://github.com/${repo}/issues`,
        commits: `https://github.com/${repo}/commits/main`,
        license: `https://github.com/${repo}/blob/main/LICENSE`,
        readmePlugins: `https://github.com/${repo}#write-your-own-plugins`,
        installer: file("RenuxcordInstaller.exe"),
        mac: file("RenuxcordInstaller-mac.zip"),
        deb: file("RenuxcordInstaller-linux-x64.deb"),
        rpm: file("RenuxcordInstaller-linux-x64.rpm"),
        linux: file("RenuxcordInstaller-linux-x64.tar.gz"),
        apk: file("Renuxcord.apk"),
        ipa: file("Renuxcord.ipa"),
        userscript: file("Renuxcord.user.js"),
        // One tap on an iPhone: SideStore and AltStore add the source, TrollStore installs the IPA straight away
        sidestore: `sidestore://source?url=${encodeURIComponent(file("altstore.json"))}`,
        altstore: `altstore://source?url=${encodeURIComponent(file("altstore.json"))}`,
        trollstore: `apple-magnifier://install?url=${encodeURIComponent(file("Renuxcord.ipa"))}`
    };
    for (const a of document.querySelectorAll("[data-link]")) if (links[a.dataset.link]) a.href = links[a.dataset.link];

    function detectOs() {
        const ua = navigator.userAgent;
        const platform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
        if (/iphone|ipad|ipod/i.test(ua) || (platform === "macintel" && navigator.maxTouchPoints > 1)) return "ios";
        if (/android/i.test(ua)) return "android";
        if (platform.startsWith("win") || /windows/i.test(ua)) return "windows";
        if (platform.startsWith("mac") || /mac os x/i.test(ua)) return "mac";
        if (/linux|x11|cros/i.test(`${platform} ${ua}`)) return "linux";
        return "windows";
    }

    const OS = {
        windows: { label: "Download for Windows", file: "RenuxcordInstaller.exe", link: "installer", icon: "windows" },
        mac: { label: "Download for macOS", file: "RenuxcordInstaller-mac.zip", link: "mac", icon: "apple" },
        linux: { label: "Download for Linux", file: "RenuxcordInstaller-linux-x64.deb", link: "deb", icon: "linux" },
        android: { label: "Download for Android", file: "Renuxcord.apk", link: "apk", icon: "android" },
        ios: { label: "Get it on iPhone", href: "#download", icon: "apple", meta: "SideStore, AltStore or TrollStore" }
    };
    const os = detectOs();
    const mine = OS[os];

    for (const a of document.querySelectorAll('[data-download="full"]')) {
        a.href = mine.href ?? links[mine.link];
        a.querySelector("[data-download-label]").textContent = mine.label;
        a.querySelector("[data-download-meta]").textContent = mine.meta ?? mine.file;
        a.querySelector("use")?.setAttribute("href", `#i-${mine.icon}`);
        // Show the steps (SmartScreen and friends) alongside the download
        if (!mine.href) a.addEventListener("click", () => showOs(os));
    }

    const fmtSize = bytes => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

    function timeAgo(iso) {
        const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
        for (const [unit, secs] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
            const n = Math.floor(s / secs);
            if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
        }
        return "just now";
    }

    let buildName = "DevBuild";

    // The rolling release keeps the date it was first published, so the newest upload is when this build landed
    fetch(`https://api.github.com/repos/${repo}/releases/latest`)
        .then(r => (r.ok ? r.json() : null))
        .then(release => {
            if (!release) return;
            buildName = release.name || buildName;
            const hash = buildName.split(" ").pop();
            const uploads = (release.assets ?? []).map(a => a.updated_at).filter(Boolean).sort();
            const builtAt = uploads.at(-1) ?? release.published_at;
            for (const node of document.querySelectorAll("[data-build]")) node.textContent = `Build ${hash} · updated ${timeAgo(builtAt)}`;

            const sizes = Object.fromEntries((release.assets ?? []).map(a => [a.name, a.size]));
            for (const node of document.querySelectorAll("[data-size]")) {
                const size = sizes[node.dataset.size];
                if (size) node.textContent = `${node.textContent} · ${fmtSize(size)}`;
            }
            for (const node of document.querySelectorAll("[data-size-inline]")) {
                const size = sizes[node.dataset.sizeInline];
                if (size) node.textContent = `(${fmtSize(size)})`;
            }
            if (mine.file && sizes[mine.file])
                for (const node of document.querySelectorAll('[data-download="full"] [data-download-meta]')) node.textContent = `${mine.file} · ${fmtSize(sizes[mine.file])}`;
        })
        .catch(() => { });

    /* Header */

    const topBar = $("top-bar");
    const onScroll = () => topBar.classList.toggle("stuck", scrollY > 8);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const navLinks = [...document.querySelectorAll(".top-nav a")];
    const spy = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            for (const a of navLinks) a.setAttribute("aria-current", String(a.getAttribute("href") === `#${entry.target.id}`));
        }
    }, { rootMargin: "-45% 0px -50% 0px" });
    for (const a of navLinks) {
        const target = document.querySelector(a.getAttribute("href"));
        if (target) spy.observe(target);
    }

    /* Reveal on scroll */

    if (!reduced && "IntersectionObserver" in window) {
        const items = document.querySelectorAll(".sec-head, .toy, .xgroup, .os-tabs, .log-list, .faq-list, .outro-in, .stats-in > div, .index-tools");
        const io = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                entry.target.classList.add("shown");
                io.unobserve(entry.target);
            }
        }, { rootMargin: "0px 0px -8% 0px" });
        items.forEach(node => {
            const siblings = [...node.parentElement.children].filter(n => n.matches(".toy, .xgroup, .stats-in > div"));
            const i = siblings.indexOf(node);
            if (i > 0) node.style.transitionDelay = `${(i % 3) * 70}ms`;
            node.classList.add("reveal");
            io.observe(node);
        });
    }

    /* Plugin data */

    const state = { plugins: [], byName: new Map(), query: "", tag: null, onlyRx: false, all: false };
    const PREVIEW = 24;
    let readmes = null;

    const EXTRA = {
        RenuxAI: {
            cmds: ["/ai ask", "/ai catchup", "/ai summarize", "/ai rewrite", "/ai translate"],
            note: "Right-click any message › RenuxAI to explain it, sum up from there, suggest a reply or translate it. On images it can describe them or copy the text out. It runs on your Claude Code login, so there's no API key to buy. An Anthropic API key works too."
        },
        RenuxBridge: { note: "Turn it on, press Copy command in its settings and run that once in a terminal. Then ask Claude Code for the server you want. It only listens on your own computer behind a random token, never touches DMs, and deleting stays off until you allow it." },
        ServerBlueprints: { note: "Right-click a server to copy its blueprint, paste one into a server you own, or clone the whole layout into a new server." },
        CustomPlugins: { note: "Every .js file in the Renuxcord plugins folder loads with Discord, with the same powers as the built-in plugins. The folder comes with a README and a working example. Only add plugins you wrote or trust." },
        CommandPalette: { keys: ["Ctrl+Shift+K"] },
        PanicBlur: { keys: ["Ctrl+Alt+B"], note: "Can also blur Discord whenever it loses focus. Click the blurred window to bring it back." },
        Notepad: { keys: ["Ctrl+Alt+N"], cmds: ["/notes", "/note"] },
        FocusMode: { keys: ["Ctrl+Alt+F"], cmds: ["/focus"] },
        FakeDeafen: { keys: ["Ctrl+Alt+D"], cmds: ["/fakedeafen"] },
        QuickTools: { cmds: ["/calc", "/roll", "/flip", "/choose", "/random", "/8ball", "/timestamp", "/encode", "/hash", "/password"] },
        TextFX: { cmds: ["/fx"] },
        Lookup: { cmds: ["/weather", "/define", "/urban", "/wiki"] },
        WhoIs: { cmds: ["/whois"] },
        Snipe: { cmds: ["/snipe", "/editsnipe"] },
        Bookmarks: { cmds: ["/bookmarks"] },
        MessageScheduler: { cmds: ["/schedule", "/scheduled"] },
        MessageReminders: { cmds: ["/reminders"] },
        ChatExporter: { cmds: ["/export"] },
        KeywordAlerts: { cmds: ["/keywords"] },
        ChannelWatch: { cmds: ["/watching"] },
        FriendTimes: { cmds: ["/time"] },
        LastSeen: { cmds: ["/lastseen"] },
        BirthdayReminders: { cmds: ["/birthdays"] },
        VoiceLog: { cmds: ["/voicelog"] },
        SessionStats: { cmds: ["/stats"] },
        PlaytimeTracker: { cmds: ["/playtime"] },
        Confetti: { cmds: ["/confetti"] },
        RenuxcordWelcome: { cmds: ["/renuxcord"] },
        VoiceChatUnblocker: { note: "For networks that block Discord voice, like in the UAE. Voice goes through a tiny relay inside Renuxcord that starts each connection with decoy packets and switches tricks until one gets through. No VPN, no DLLs." },
        Drover: { note: "Downloads the official Discord Drover release, checks it against pinned hashes, and installs it for you. It can also send Discord through an HTTP or SOCKS5 proxy." },
        RenuxBadges: { note: "Always on. Renuxcord adds an invisible tag to the end of your About Me so other Renuxcord users can see your badge. People without Renuxcord can't see the tag." }
    };

    const fill = (key, value) => {
        for (const node of document.querySelectorAll(`[data-count="${key}"]`)) node.textContent = String(value);
    };

    const listEl = $("plist");
    const countEl = $("count");
    const moreEl = $("more");
    const searchEl = $("search");
    const rxEl = $("only-rx");
    const tagsEl = $("tags");

    function matching() {
        return state.plugins.filter(p =>
            p.switchable &&
            (!state.onlyRx || p.exclusive) &&
            (!state.tag || p.tags.includes(state.tag)) &&
            (!state.query || p.text.includes(state.query))
        );
    }

    function card(p) {
        const li = document.createElement("li");
        li.id = `plugin-${p.name}`;
        li.innerHTML = `<button type="button"><span class="p-top"><span class="p-name">${esc(p.name)}</span>` +
            `${p.exclusive ? '<span class="p-rx"><svg aria-hidden="true"><use href="#i-spark" /></svg>Exclusive</span>' : ""}</span>` +
            `<span class="p-desc">${esc(p.description)}</span>${p.tags.length ? `<span class="p-tags">${esc(p.tags.join(" · "))}</span>` : ""}</button>`;
        li.firstElementChild.addEventListener("click", () => openPlugin(p.name));
        return li;
    }

    function renderIndex() {
        const shown = matching();
        const filtered = Boolean(state.query || state.tag || state.onlyRx);
        const rows = filtered || state.all ? shown : shown.slice(0, PREVIEW);
        listEl.replaceChildren(...rows.map(card));
        if (!shown.length) {
            const li = document.createElement("li");
            li.className = "empty";
            li.textContent = "Nothing matches that. Try another word or tag.";
            listEl.append(li);
        }
        const switchable = state.plugins.filter(p => p.switchable).length;
        countEl.textContent = filtered ? `${shown.length} of ${switchable} plugins` : `${switchable} plugins · exclusives first`;
        moreEl.hidden = rows.length >= shown.length;
        moreEl.textContent = `Show all ${shown.length}`;
    }

    function renderTags() {
        const counts = new Map();
        for (const p of state.plugins) if (p.switchable) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
        tagsEl.replaceChildren(...[...counts]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, n]) => {
                const b = document.createElement("button");
                b.className = "tag";
                b.type = "button";
                b.setAttribute("aria-pressed", String(state.tag === tag));
                b.textContent = tag;
                const num = document.createElement("span");
                num.textContent = String(n);
                b.append(num);
                b.addEventListener("click", () => {
                    state.tag = state.tag === tag ? null : tag;
                    renderTags();
                    renderIndex();
                });
                return b;
            }));
    }

    const pluginsReady = fetch("plugins.json")
        .then(r => r.json())
        .then(list => {
            const isRx = p => (p.tags ?? []).includes("Renuxcord");
            state.plugins = list
                .map(p => {
                    const tags = (p.tags ?? []).filter(t => t !== "Renuxcord");
                    return {
                        name: p.name,
                        description: p.description,
                        tags,
                        target: p.target,
                        required: Boolean(p.required),
                        switchable: !p.required && !p.name.endsWith("API"),
                        exclusive: isRx(p),
                        text: `${p.name} ${p.description} ${tags.join(" ")}`.toLowerCase()
                    };
                })
                .sort((a, b) => Number(b.exclusive) - Number(a.exclusive) || a.name.localeCompare(b.name));
            for (const p of state.plugins) state.byName.set(p.name, p);

            const switchable = state.plugins.filter(p => p.switchable);
            fill("total", list.length);
            fill("exclusive", list.filter(isRx).length);
            fill("switchable", switchable.length);
            fill("background", list.length - switchable.length);
            searchEl.placeholder = `Search ${switchable.length} plugins`;
            renderTags();
            renderIndex();
        })
        .catch(() => {
            countEl.textContent = "The plugin list couldn't load right now.";
        });

    searchEl.addEventListener("input", () => {
        state.query = searchEl.value.trim().toLowerCase();
        renderIndex();
    });
    rxEl.addEventListener("click", () => {
        state.onlyRx = !state.onlyRx;
        rxEl.setAttribute("aria-pressed", String(state.onlyRx));
        renderIndex();
    });
    moreEl.addEventListener("click", () => {
        state.all = true;
        renderIndex();
    });

    /* Plugin details drawer */

    const drawer = $("drawer");
    const drTitle = $("dr-title");
    const drKind = $("dr-kind");
    const drBody = $("dr-body");
    const drWhere = $("dr-where");
    let drawerReturn = null;
    let drawerName = null;

    const safeUrl = url => (/^https?:\/\//.test(url) ? url : "#");
    const inline = s => esc(s)
        .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy" />`)
        .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, text, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener">${text}</a>`)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");

    // Enough Markdown for the plugin READMEs: headings, lists, code blocks, links and pictures
    function markdown(src) {
        const out = [];
        let list = null;
        let code = null;
        let para = [];
        const flushPara = () => {
            if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
            para = [];
        };
        const flushList = () => {
            if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
            list = null;
        };
        for (const line of src.replace(/\r/g, "").split("\n")) {
            if (code) {
                if (/^```/.test(line)) {
                    out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
                    code = null;
                } else code.push(line);
                continue;
            }
            if (/^```/.test(line)) {
                flushPara();
                flushList();
                code = [];
                continue;
            }
            const heading = /^(#{1,4})\s+(.*)$/.exec(line);
            const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
            const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
            if (heading) {
                flushPara();
                flushList();
                out.push(`<h4>${inline(heading[2])}</h4>`);
            } else if (bullet || numbered) {
                flushPara();
                const tag = bullet ? "ul" : "ol";
                if (list?.tag !== tag) {
                    flushList();
                    list = { tag, items: [] };
                }
                list.items.push((bullet ?? numbered)[1]);
            } else if (!line.trim()) {
                flushPara();
                flushList();
            } else {
                flushList();
                para.push(line.trim());
            }
        }
        flushPara();
        flushList();
        return out.join("");
    }

    const chip = (text, cls = "") => `<span class="dr-chip${cls ? ` ${cls}` : ""}">${text}</span>`;
    const keysHtml = combo => combo.split("+").map(k => `<kbd>${esc(k)}</kbd>`).join("+");

    function trapFocus(container, e) {
        if (e.key !== "Tab") return;
        const items = [...container.querySelectorAll("button, a[href], input, [tabindex]:not([tabindex='-1'])")].filter(n => n.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    async function openPlugin(pluginName, { setHash = true } = {}) {
        await pluginsReady;
        const p = state.byName.get(pluginName);
        const staticBlurb = document.querySelector(`[data-plugin="${CSS.escape(pluginName)}"] span`)?.textContent;
        if (!p && !staticBlurb) return;

        const extra = EXTRA[pluginName] ?? {};
        const chips = [];
        if (p?.exclusive) chips.push(chip('<svg aria-hidden="true"><use href="#i-spark" /></svg>Renuxcord exclusive', "rx"));
        if (p?.required) chips.push(chip("Always on"));
        if (p?.target === "discordDesktop" || p?.target === "desktop") chips.push(chip("Desktop app only"));
        if (p?.target === "web") chips.push(chip("Browser only"));
        for (const t of p?.tags ?? []) chips.push(chip(esc(t)));

        let html = `${chips.length ? `<div class="dr-chips">${chips.join("")}</div>` : ""}<p class="dr-desc">${esc(p?.description ?? staticBlurb)}</p>`;
        if (extra.keys) html += `<div class="dr-block"><h3>Shortcut</h3><ul>${extra.keys.map(k => `<li>${keysHtml(k)}</li>`).join("")}</ul></div>`;
        if (extra.cmds) html += `<div class="dr-block"><h3>Commands</h3><ul>${extra.cmds.map(c => `<li><code>${esc(c)}</code></li>`).join("")}</ul></div>`;
        if (extra.note) html += `<div class="dr-block"><h3>Good to know</h3><p class="md">${esc(extra.note)}</p></div>`;
        html += '<div class="dr-block" id="dr-readme" hidden><h3>From the plugin’s notes</h3><div class="md"></div></div>';

        drKind.textContent = p?.exclusive || staticBlurb ? "Renuxcord exclusive" : "Plugin";
        drTitle.textContent = pluginName;
        drBody.innerHTML = html;
        drBody.scrollTop = 0;
        drWhere.textContent = p?.required ? "Always on, there's nothing to switch." : `Settings › Renuxcord › Plugins › ${pluginName}`;
        drawerName = pluginName;

        if (drawer.hidden) {
            drawerReturn = document.activeElement;
            drawer.hidden = false;
            document.body.style.overflow = "hidden";
            drawer.querySelector(".icon-btn").focus({ preventScroll: true });
        }
        if (setHash) history.replaceState(null, "", `#plugin/${encodeURIComponent(pluginName)}`);

        readmes ??= fetch("plugin-readmes.json").then(r => (r.ok ? r.json() : {})).catch(() => ({}));
        const text = (await readmes)[pluginName];
        const box = $("dr-readme");
        if (text && box && drawerName === pluginName) {
            // The first heading is the plugin's name and the first paragraph its description, both already shown
            const body = text.replace(/^#[^\n]*\n+/, "").replace(/^[^\n#]+\n+/, line => (line.trim() === p?.description?.trim() ? "" : line));
            const rendered = markdown(body);
            if (rendered) {
                box.querySelector(".md").innerHTML = rendered;
                box.hidden = false;
            }
        }
    }

    function closeDrawer() {
        if (drawer.hidden) return;
        drawer.hidden = true;
        document.body.style.overflow = "";
        drawerName = null;
        if (location.hash.startsWith("#plugin/")) history.replaceState(null, "", location.pathname + location.search);
        drawerReturn?.focus?.({ preventScroll: true });
    }

    for (const n of drawer.querySelectorAll("[data-drawer-close]")) n.addEventListener("click", closeDrawer);
    drawer.addEventListener("keydown", e => {
        if (e.key === "Escape") closeDrawer();
        else trapFocus(drawer.querySelector(".drawer-panel"), e);
    });
    $("dr-link").addEventListener("click", async () => {
        const url = `${location.origin}${location.pathname}#plugin/${encodeURIComponent(drawerName ?? "")}`;
        try {
            await navigator.clipboard.writeText(url);
            toast("Link copied");
        } catch {
            toast(url);
        }
    });

    for (const b of document.querySelectorAll("[data-plugin]")) b.addEventListener("click", () => openPlugin(b.dataset.plugin));

    function fromHash() {
        const m = /^#plugin\/(.+)$/.exec(location.hash);
        if (m) openPlugin(decodeURIComponent(m[1]), { setHash: false });
    }
    addEventListener("hashchange", fromHash);
    fromHash();

    /* Download tabs */

    const osTabs = [...document.querySelectorAll(".os-tab")];
    const installerRuns = new Set();
    let downloadSeen = false;

    function showOs(id, { focus = false } = {}) {
        for (const t of osTabs) {
            const on = t.dataset.os === id;
            t.setAttribute("aria-selected", String(on));
            t.tabIndex = on ? 0 : -1;
            if (on && focus) t.focus();
        }
        for (const p of document.querySelectorAll("[data-os-panel]")) p.hidden = p.dataset.osPanel !== id;
        // Phones only show some of the tabs at once, so bring the picked one into view
        const picked = osTabs.find(t => t.dataset.os === id);
        const strip = picked?.parentElement;
        if (strip && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = picked.offsetLeft - (strip.clientWidth - picked.offsetWidth) / 2;
        if (downloadSeen) runInstaller(id);
    }

    osTabs.forEach((t, i) => {
        t.addEventListener("click", () => showOs(t.dataset.os));
        t.addEventListener("keydown", e => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const next = osTabs[(i + (e.key === "ArrowRight" ? 1 : -1) + osTabs.length) % osTabs.length];
            showOs(next.dataset.os, { focus: true });
        });
    });

    const INSTALL_LOG = {
        windows: () => [
            `Ready to install the latest Renuxcord from github.com/${repo}`,
            `Looking up the latest release on github.com/${repo}...`,
            `Latest: ${buildName}`,
            "Downloading patcher.js", "Downloading preload.js", "Downloading renderer.js", "Downloading renderer.css",
            "Closing Discord Stable...",
            "Patched C:\\Users\\you\\AppData\\Local\\Discord\\app-1.0.9269\\resources",
            "Starting Discord Stable...",
            "Done! Discord Stable is starting with Renuxcord. It updates itself from now on."
        ],
        mac: () => [
            `Ready to install the newest Renuxcord from github.com/${repo}`,
            "Downloading Renuxcord into ~/Library/Application Support/Renuxcord/dist",
            "Closing Discord",
            "Discord in /Applications/Discord.app/Contents/Resources now loads Renuxcord",
            "Starting Discord",
            "Done. Renuxcord is in Discord: Settings › Renuxcord"
        ],
        linux: () => [
            `Ready to install the newest Renuxcord from github.com/${repo}`,
            "Downloading Renuxcord into ~/.config/Renuxcord/dist",
            "Closing Discord",
            "Discord in ~/.config/discord/app-1.0.170/resources now loads Renuxcord",
            "Starting Discord",
            "Done. Renuxcord is in Discord: Settings › Renuxcord"
        ]
    };

    async function runInstaller(id) {
        const panel = document.querySelector(`[data-os-panel="${id}"]`);
        const box = panel?.querySelector("[data-installer]");
        if (!box || installerRuns.has(id)) return;
        installerRuns.add(id);
        const log = box.querySelector("[data-inst-log]");
        const lines = INSTALL_LOG[id]();
        const add = text => {
            const p = document.createElement("p");
            p.textContent = text;
            log.append(p);
            while (log.children.length > 9) log.firstElementChild.remove();
        };
        add(lines[0]);
        if (reduced) {
            for (const l of lines.slice(1)) add(l);
            box.querySelector("[data-inst-status]").textContent = "Renuxcord is installed";
            box.querySelector("[data-inst-status]").classList.add("on");
            return;
        }
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        await sleep(900);
        const go = box.querySelector(".ib-go");
        go.classList.add("press");
        await sleep(160);
        go.classList.remove("press");
        const bar = box.querySelector("[data-inst-progress]");
        bar.classList.add("busy");
        for (const l of lines.slice(1)) {
            await sleep(l.startsWith("Downloading") ? 260 : 620);
            add(l);
        }
        bar.classList.remove("busy");
        const status = box.querySelector("[data-inst-status]");
        status.textContent = "Renuxcord is installed";
        status.classList.add("on");
    }

    showOs(os);
    new IntersectionObserver(([entry], obs) => {
        if (!entry.isIntersecting) return;
        downloadSeen = true;
        runInstaller(osTabs.find(t => t.getAttribute("aria-selected") === "true")?.dataset.os ?? os);
        obs.disconnect();
    }, { threshold: 0.35 }).observe($("download"));

    /* Copy buttons */

    for (const b of document.querySelectorAll("[data-copy]")) {
        b.addEventListener("click", async () => {
            const text = b.closest("[data-copy-wrap]").querySelector("code").textContent.trim();
            try {
                await navigator.clipboard.writeText(text);
                b.classList.add("done");
                b.querySelector("use").setAttribute("href", "#i-check");
                toast("Copied. Paste it into a terminal");
                setTimeout(() => {
                    b.classList.remove("done");
                    b.querySelector("use").setAttribute("href", "#i-copy");
                }, 1800);
            } catch {
                toast("Couldn't copy here. Select the command instead");
            }
        });
    }

    /* Changelog */

    const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

    async function loadChanges() {
        const box = $("changes");
        let list = null;
        try {
            const r = await fetch("changelog.json", { cache: "no-cache" });
            if (r.ok) list = await r.json();
        } catch { }
        if (!Array.isArray(list) || !list.length) {
            try {
                const r = await fetch(`https://api.github.com/repos/${repo}/commits?sha=main&per_page=40`);
                if (r.ok) {
                    list = (await r.json())
                        .filter(c => c.author?.login === repo.split("/")[0] && c.parents?.length === 1)
                        .map(c => ({ hash: c.sha, date: c.commit.author.date, message: c.commit.message }));
                }
            } catch { }
        }
        if (!Array.isArray(list) || !list.length) {
            box.innerHTML = '<li class="log-empty">The latest changes couldn’t load right now. They’re all on GitHub.</li>';
            return;
        }
        box.replaceChildren(...list.slice(0, 8).map(c => {
            const li = document.createElement("li");
            const when = new Date(c.date);
            const recent = Date.now() - when.getTime() < 6 * 86400000;
            li.innerHTML = `<a href="https://github.com/${repo}/commit/${esc(c.hash)}" target="_blank" rel="noopener"><time datetime="${esc(c.date)}">${recent ? timeAgo(c.date) : dateFmt.format(when)}</time>` +
                `<span class="msg-t">${esc(c.message.split("\n")[0])}</span><span class="hash">${esc(c.hash.slice(0, 7))}</span></a>`;
            return li;
        }));
    }
    loadChanges();

    /* The command palette, the same idea as the one in Discord, for this page */

    const SECTIONS = [
        ["the tour", "tour"], ["the playground", "play"], ["the exclusives", "exclusives"], ["every plugin", "plugins"],
        ["downloads", "download"], ["the changelog", "changelog"], ["the FAQ", "faq"]
    ];

    function commands() {
        const go = id => () => document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "instant" : "smooth" });
        const dl = (id, label, hint) => ({
            section: "Download",
            label,
            hint,
            run: () => {
                showOs(id);
                go("download")();
            }
        });
        const play = window.RenuxPlay;
        return [
            ...SECTIONS.map(([label, id]) => ({ section: "Page", label: `Go to ${label}`, run: go(id) })),
            dl("windows", "Renuxcord for Windows", "Installer"),
            dl("mac", "Renuxcord for macOS", "Installer"),
            dl("linux", "Renuxcord for Linux", ".deb, .rpm, .tar.gz"),
            dl("android", "Renuxcord for Android", "APK"),
            dl("ios", "Renuxcord for iPhone and iPad", "Sideload"),
            { section: "Try it", label: "Blur this page", hint: "Ctrl+Alt+B", run: () => play?.setBlur(true) },
            { section: "Try it", label: "Fire the confetti cannons", hint: "/confetti", run: () => play?.fire() },
            ...["Midnight", "Sakura", "Ocean", "Forest", "Ember", "OLED", "Renuxcord"].map(t => ({
                section: "Theme", label: `Recolour the page: ${t}`, run: () => play?.applyTheme(t)
            })),
            { section: "Links", label: "Open the source on GitHub", run: () => window.open(links.repo, "_blank", "noopener") },
            { section: "Links", label: "See every release", run: () => window.open(links.releases, "_blank", "noopener") },
            { section: "Links", label: "Report a bug", run: () => window.open(links.issues, "_blank", "noopener") },
            ...state.plugins.filter(p => !p.name.endsWith("API")).map(p => ({
                section: "Plugins",
                label: p.name,
                hint: p.exclusive ? "Exclusive" : "",
                run: () => openPlugin(p.name)
            }))
        ];
    }

    // Starts-with beats a word match beats anywhere beats letters in order
    function score(query, text) {
        if (!query) return 1;
        const t = text.toLowerCase();
        if (t.startsWith(query)) return 300 - t.length;
        const word = t.indexOf(` ${query}`);
        if (word >= 0) return 200 - word;
        const at = t.indexOf(query);
        if (at >= 0) return 100 - at;
        let i = 0;
        let gaps = 0;
        for (const ch of t) {
            if (ch === query[i]) i++;
            else if (i > 0) gaps++;
            if (i === query.length) return gaps <= query.length * 2 ? 50 - gaps : null;
        }
        return null;
    }

    const pal = { back: $("palette"), input: $("pal-input"), list: $("pal-list"), results: [], index: 0, returnTo: null };

    function palSelect(i) {
        pal.index = i;
        [...pal.list.children].forEach((item, n) => {
            item.classList.toggle("sel", n === i);
            item.setAttribute("aria-selected", String(n === i));
        });
        pal.list.children[i]?.scrollIntoView({ block: "nearest" });
        pal.input.setAttribute("aria-activedescendant", `pal-${i}`);
    }

    function renderPalette() {
        const query = pal.input.value.trim().toLowerCase();
        pal.results = commands()
            .map(c => {
                const label = score(query, c.label);
                const both = score(query, `${c.section} ${c.label}`);
                return { c, s: Math.max(label ?? -Infinity, both == null ? -Infinity : both - 5) };
            })
            .filter(r => r.s > -Infinity)
            .sort((a, b) => b.s - a.s)
            .slice(0, 60)
            .map(r => r.c);
        pal.index = Math.min(pal.index, Math.max(pal.results.length - 1, 0));
        pal.list.replaceChildren(...pal.results.map((c, i) => {
            const item = document.createElement("div");
            item.className = `pal-item${i === pal.index ? " sel" : ""}`;
            item.id = `pal-${i}`;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", String(i === pal.index));
            item.innerHTML = `<span class="pal-sec">${esc(c.section)}</span><span class="pal-label">${esc(c.label)}</span>${c.hint ? `<span class="pal-hint">${esc(c.hint)}</span>` : ""}`;
            item.addEventListener("mousemove", () => {
                if (pal.index !== i) palSelect(i);
            });
            item.addEventListener("click", () => runCommand(c));
            return item;
        }));
        if (!pal.results.length) {
            const empty = document.createElement("div");
            empty.className = "pal-empty";
            empty.textContent = `Nothing matches "${pal.input.value.trim()}"`;
            pal.list.append(empty);
        }
        pal.input.setAttribute("aria-activedescendant", pal.results.length ? `pal-${pal.index}` : "");
    }

    function closePalette() {
        // Blur first: a hidden input can keep focus and swallow the / shortcut
        pal.input.blur();
        pal.back.hidden = true;
        if (drawer.hidden) document.body.style.overflow = "";
        pal.returnTo?.focus?.({ preventScroll: true });
    }

    function openPalette() {
        if (!pal.back.hidden) return closePalette();
        pal.returnTo = document.activeElement;
        pal.back.hidden = false;
        document.body.style.overflow = "hidden";
        pal.input.value = "";
        pal.index = 0;
        renderPalette();
        pal.input.focus();
    }

    function runCommand(c) {
        closePalette();
        c.run();
    }

    pal.input.addEventListener("input", () => {
        pal.index = 0;
        renderPalette();
    });
    pal.input.addEventListener("keydown", e => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            palSelect(Math.min(pal.index + 1, pal.results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            palSelect(Math.max(pal.index - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (pal.results[pal.index]) runCommand(pal.results[pal.index]);
        } else if (e.key === "Tab") e.preventDefault();
    });
    pal.back.addEventListener("mousedown", e => {
        if (e.target === pal.back) closePalette();
    });
    for (const trigger of document.querySelectorAll("[data-palette]")) trigger.addEventListener("click", openPalette);

    const typing = () => {
        const active = document.activeElement;
        return /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName ?? "") || active?.isContentEditable;
    };

    document.addEventListener("keydown", e => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.altKey && e.code === "KeyK" && (e.shiftKey || !typing())) {
            e.preventDefault();
            openPalette();
        } else if (e.key === "Escape" && !pal.back.hidden) {
            e.preventDefault();
            closePalette();
        } else if (e.key === "/" && !mod && !e.altKey && pal.back.hidden && drawer.hidden && !typing()) {
            e.preventDefault();
            searchEl.scrollIntoView({ block: "center", behavior: reduced ? "instant" : "smooth" });
            searchEl.focus({ preventScroll: true });
        }
    });
})();
