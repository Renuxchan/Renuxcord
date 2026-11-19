/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const { repo } = document.body.dataset;
const links = {
    repo: `https://github.com/${repo}`,
    releases: `https://github.com/${repo}/releases`,
    installer: `https://github.com/${repo}/releases/latest/download/RenuxcordInstaller.exe`
};

for (const a of document.querySelectorAll("[data-link]")) a.href = links[a.dataset.link];

function timeAgo(iso) {
    const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
    const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [name, secs] of units) {
        const n = Math.floor(s / secs);
        if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
    return "just now";
}

fetch(`https://api.github.com/repos/${repo}/releases/latest`)
    .then(r => r.ok ? r.json() : null)
    .then(release => {
        if (!release) return;
        const hash = (release.name ?? "").split(" ").pop();
        document.getElementById("build").textContent = `Build ${hash} · updated ${timeAgo(release.published_at)}`;
        const exe = release.assets?.find(a => a.name === "RenuxcordInstaller.exe");
        if (exe) document.getElementById("size").textContent = `Free · ${Math.round(exe.size / 1024)} KB installer · Windows 10/11 · Discord Stable, PTB and Canary`;
    })
    .catch(() => { });

const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
};

let plugins = [];
let filter = "all";
const listEl = document.getElementById("plugin-list");
const searchEl = document.getElementById("search");

function render() {
    const q = searchEl.value.trim().toLowerCase();
    const shown = plugins.filter(p =>
        (filter === "all" || p.exclusive)
        && (!q || `${p.name} ${p.description} ${p.tags.join(" ")}`.toLowerCase().includes(q)));

    listEl.replaceChildren(...shown.map(p => {
        const card = el("article", `plugin${p.exclusive ? " exclusive" : ""}`);
        if (p.exclusive) card.append(el("span", "badge", "✦ Renuxcord Exclusive"));
        card.append(el("h4", null, p.name), el("p", null, p.description));
        const tags = p.tags.filter(t => t !== "Renuxcord");
        if (tags.length) {
            const row = el("div", "tags");
            row.append(...tags.map(t => el("span", null, t)));
            card.append(row);
        }
        return card;
    }));

    if (!shown.length) listEl.append(el("p", "fine", "No plugins match that."));
}

fetch("plugins.json")
    .then(r => r.json())
    .then(list => {
        plugins = list
            .filter(p => !p.required && !p.name.endsWith("API"))
            .map(p => ({ name: p.name, description: p.description, tags: p.tags ?? [], exclusive: (p.tags ?? []).includes("Renuxcord") }))
            .sort((a, b) => Number(b.exclusive) - Number(a.exclusive) || a.name.localeCompare(b.name));
        const exclusives = plugins.filter(p => p.exclusive).length;
        document.getElementById("plugin-count").textContent = `${plugins.length} plugins you can switch on, ${exclusives} of them Renuxcord Exclusives.`;
        render();
    })
    .catch(() => {
        document.getElementById("plugin-count").textContent = "The plugin list couldn't load right now.";
    });

searchEl.addEventListener("input", render);
for (const chip of document.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => {
        filter = chip.dataset.filter;
        for (const c of document.querySelectorAll(".chip")) c.classList.toggle("on", c === chip);
        render();
    });
}
