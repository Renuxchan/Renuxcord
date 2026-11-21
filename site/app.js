/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const { repo } = document.body.dataset;
const links = {
    repo: `https://github.com/${repo}`,
    releases: `https://github.com/${repo}/releases`,
    license: `https://github.com/${repo}/blob/main/LICENSE`,
    installer: `https://github.com/${repo}/releases/latest/download/RenuxcordInstaller.exe`,
};

for (const a of document.querySelectorAll("[data-link]")) a.href = links[a.dataset.link];

const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
};

function timeAgo(iso) {
    const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
    const units = [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
    ];
    for (const [name, secs] of units) {
        const n = Math.floor(s / secs);
        if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
    return "just now";
}

// The rolling release keeps the date it was first published, so the newest upload is when this build landed
fetch(`https://api.github.com/repos/${repo}/releases/latest`)
    .then(r => (r.ok ? r.json() : null))
    .then(release => {
        if (!release) return;
        const hash = (release.name ?? "").split(" ").pop();
        const uploads = (release.assets ?? [])
            .map(a => a.updated_at)
            .filter(Boolean)
            .sort();
        const builtAt = uploads.at(-1) ?? release.published_at;
        for (const node of document.querySelectorAll("[data-build]"))
            node.textContent = `Build ${hash} · updated ${timeAgo(builtAt)}`;

        const exe = release.assets?.find(a => a.name === "RenuxcordInstaller.exe");
        if (exe)
            document.getElementById("size").textContent =
                `Free · ${Math.max(1, Math.round(exe.size / 1024))} KB installer · also on macOS, Linux, Android and iOS`;
    })
    .catch(() => {});

// Friend Groups shots: click a folder to fold it, like the real sidebar
for (const head of document.querySelectorAll(".fg-head")) {
    head.addEventListener("click", () => {
        const folded = head.classList.toggle("folded");
        for (const row of head.parentElement.querySelectorAll(
            `.fg-row[data-g="${head.dataset.g}"]`,
        ))
            row.hidden = folded;
    });
}

/* Plugin index */

const state = { plugins: [], query: "", tag: null, onlyRx: false, all: false };
const PREVIEW = 24;
const listEl = document.getElementById("plist");
const countEl = document.getElementById("count");
const moreEl = document.getElementById("more");
const searchEl = document.getElementById("search");
const rxEl = document.getElementById("only-rx");
const tagsEl = document.getElementById("tags");

const fill = (key, value) => {
    for (const node of document.querySelectorAll(`[data-count="${key}"]`))
        node.textContent = String(value);
};

function matching() {
    return state.plugins.filter(
        p =>
            (!state.onlyRx || p.exclusive) &&
            (!state.tag || p.tags.includes(state.tag)) &&
            (!state.query || p.text.includes(state.query)),
    );
}

function pluginRow(p) {
    const li = el("li");
    li.id = `plugin-${p.name}`;
    const top = el("div", "top-line");
    top.append(el("span", "name", p.name));
    if (p.exclusive) top.append(el("span", "rx", "Renuxcord"));
    li.append(top, el("p", "desc", p.description));
    if (p.tags.length) li.append(el("p", "ptags", p.tags.join(" · ")));
    return li;
}

function renderIndex() {
    const shown = matching();
    const filtered = Boolean(state.query || state.tag || state.onlyRx);
    const rows = filtered || state.all ? shown : shown.slice(0, PREVIEW);

    listEl.replaceChildren(...rows.map(pluginRow));
    if (!shown.length)
        listEl.append(el("li", "empty", "Nothing matches that. Try another word or tag."));

    countEl.textContent = filtered
        ? `${shown.length} of ${state.plugins.length} plugins`
        : `${state.plugins.length} plugins · Renuxcord exclusives first`;
    moreEl.hidden = rows.length >= shown.length;
    moreEl.textContent = `Show all ${shown.length}`;
}

function renderTags() {
    const counts = new Map();
    for (const p of state.plugins) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);

    tagsEl.replaceChildren(
        ...[...counts]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, n]) => {
                const button = el("button", "tag", tag);
                button.type = "button";
                button.setAttribute("aria-pressed", String(state.tag === tag));
                button.append(el("span", null, String(n)));
                button.addEventListener("click", () => {
                    state.tag = state.tag === tag ? null : tag;
                    renderTags();
                    renderIndex();
                });
                return button;
            }),
    );
}

fetch("plugins.json")
    .then(r => r.json())
    .then(list => {
        const isRx = p => (p.tags ?? []).includes("Renuxcord");
        state.plugins = list
            .filter(p => !p.required && !p.name.endsWith("API"))
            .map(p => {
                const tags = (p.tags ?? []).filter(t => t !== "Renuxcord");
                return {
                    name: p.name,
                    description: p.description,
                    tags,
                    exclusive: isRx(p),
                    text: `${p.name} ${p.description} ${tags.join(" ")}`.toLowerCase(),
                };
            })
            .sort(
                (a, b) => Number(b.exclusive) - Number(a.exclusive) || a.name.localeCompare(b.name),
            );

        fill("total", list.length);
        fill("exclusive", list.filter(isRx).length);
        fill("switchable", state.plugins.length);
        fill("switchable-exclusive", state.plugins.filter(p => p.exclusive).length);
        fill("background", list.length - state.plugins.length);
        searchEl.placeholder = `Search ${state.plugins.length} plugins`;

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

function showPlugin(name) {
    Object.assign(state, { query: "", tag: null, onlyRx: false, all: true });
    searchEl.value = "";
    rxEl.setAttribute("aria-pressed", "false");
    renderTags();
    renderIndex();

    const row = document.getElementById(`plugin-${name}`);
    if (!row) return;
    // Jump straight there, like the palette in Discord, so the highlight is still showing on arrival
    row.scrollIntoView({ block: "center", behavior: "instant" });
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
}

/* Command palette: the same idea as the one in Discord, for this page */

const SECTIONS = [
    ["Friend Groups", "friend-groups"],
    ["Command Palette", "palette-feature"],
    ["RenuxAI", "renuxai"],
    ["LinkSafety and SecretGuard", "safety"],
    ["RenuxBridge", "bridge"],
    ["Custom plugins", "custom"],
    ["the plugin index", "plugins"],
    ["Install", "install"],
    ["FAQ", "faq"],
];

function commands() {
    const go = id => () => document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
    return [
        ...SECTIONS.map(([label, id]) => ({
            section: "Page",
            label: `Go to ${label}`,
            run: go(id),
        })),
        {
            section: "Renuxcord",
            label: "Download the installer",
            hint: "Windows",
            run: () => {
                location.href = links.installer;
            },
        },
        {
            section: "Renuxcord",
            label: "Open the source on GitHub",
            run: () => window.open(links.repo, "_blank", "noopener"),
        },
        {
            section: "Renuxcord",
            label: "See every release",
            run: () => window.open(links.releases, "_blank", "noopener"),
        },
        ...state.plugins.map(p => ({
            section: "Plugins",
            label: p.name,
            hint: p.exclusive ? "Renuxcord" : "",
            run: () => showPlugin(p.name),
        })),
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

    // Letters in order count only when they sit fairly close together, so "fgr" finds FriendGroups without noise
    let i = 0;
    let gaps = 0;
    for (const ch of t) {
        if (ch === query[i]) i++;
        else if (i > 0) gaps++;
        if (i === query.length) return gaps <= query.length * 2 ? 50 - gaps : null;
    }
    return null;
}

const pal = {
    back: document.getElementById("palette"),
    input: document.getElementById("pal-input"),
    list: document.getElementById("pal-list"),
    results: [],
    index: 0,
    returnTo: null,
};

function select(i) {
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

    pal.list.replaceChildren(
        ...pal.results.map((c, i) => {
            const item = el("div", `pal-item${i === pal.index ? " sel" : ""}`);
            item.id = `pal-${i}`;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", String(i === pal.index));
            item.append(el("span", "pal-sec", c.section), el("span", "pal-label", c.label));
            if (c.hint) item.append(el("span", "pal-hint", c.hint));
            item.addEventListener("mousemove", () => {
                if (pal.index !== i) select(i);
            });
            item.addEventListener("click", () => run(c));
            return item;
        }),
    );

    if (!pal.results.length)
        pal.list.append(el("div", "pal-empty", `Nothing matches "${pal.input.value.trim()}"`));
    pal.input.setAttribute("aria-activedescendant", pal.results.length ? `pal-${pal.index}` : "");
}

function closePalette() {
    // Blur first: a hidden input can keep focus and swallow the / shortcut
    pal.input.blur();
    pal.back.hidden = true;
    document.body.style.overflow = "";
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

function run(command) {
    closePalette();
    command.run();
}

pal.input.addEventListener("input", () => {
    pal.index = 0;
    renderPalette();
});

pal.input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") {
        e.preventDefault();
        select(Math.min(pal.index + 1, pal.results.length - 1));
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        select(Math.max(pal.index - 1, 0));
    } else if (e.key === "Enter") {
        e.preventDefault();
        if (pal.results[pal.index]) run(pal.results[pal.index]);
    } else if (e.key === "Tab") {
        e.preventDefault();
    }
});

pal.back.addEventListener("mousedown", e => {
    if (e.target === pal.back) closePalette();
});

for (const trigger of document.querySelectorAll("[data-palette]"))
    trigger.addEventListener("click", openPalette);

const typing = () => {
    const active = document.activeElement;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName ?? "") || active?.isContentEditable;
};

document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
    } else if (e.key === "Escape" && !pal.back.hidden) {
        e.preventDefault();
        closePalette();
    } else if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        pal.back.hidden &&
        !typing()
    ) {
        e.preventDefault();
        searchEl.scrollIntoView({ block: "center" });
        searchEl.focus({ preventScroll: true });
    }
});
