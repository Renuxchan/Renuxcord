/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { applyProfile, getProfiles } from "@plugins/pluginProfiles";
import { setPluginEnabled, toggleablePlugins } from "@plugins/pluginProfiles/toggle";
import { classNameFactory } from "@utils/css";
import { relaunch } from "@utils/native";
import { promptToRestart } from "@utils/promptToRestart";
import { RenuxDevs } from "@utils/renuxcord";
import { matchesHotkey } from "@utils/renuxcordHotkeys";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, closeModal, GuildStore, Modal, NavigationRouter, openModal, SelectedGuildStore, SettingsRouter, showToast, useEffect, useMemo, useRef, UserStore,useState } from "@webpack/common";

const cl = classNameFactory("rx-palette-");

interface PaletteCommand {
    section: string;
    label: string;
    hint?: string;
    run(): unknown;
}

const settings = definePluginSettings({
    hotkey: {
        type: OptionType.STRING,
        description: "Shortcut that opens the palette, e.g. ctrl+shift+k or alt+space (Discord already uses ctrl+shift+p)",
        default: "ctrl+shift+k"
    },
    includeServers: {
        type: OptionType.BOOLEAN,
        description: "List your servers so you can jump to them",
        default: true
    },
    includeChannels: {
        type: OptionType.BOOLEAN,
        description: "List your recent DMs and the current server's channels",
        default: true
    }
});

const openSettings = (key: string) => () => SettingsRouter.openUserSettings(`${key}_panel`);

function togglePlugin(name: string) {
    const enable = !isPluginEnabled(name);
    const res = setPluginEnabled(name, enable);
    if (res === "failed") return showToast({ text: `Couldn't ${enable ? "enable" : "disable"} ${name}`, variant: "critical" });
    showToast({ text: `${name} ${enable ? "enabled" : "disabled"}`, variant: "success" });
    if (res === "restart") promptToRestart("reload");
}

function gatherCommands(): PaletteCommand[] {
    const commands: PaletteCommand[] = [
        { section: "Renuxcord", label: "Open Renuxcord settings", run: openSettings("vencord_main") },
        { section: "Renuxcord", label: "Open plugins", run: openSettings("vencord_plugins") },
        { section: "Renuxcord", label: "Open themes", run: openSettings("vencord_themes") },
        { section: "Renuxcord", label: "Check for updates", run: openSettings("vencord_updater") },
        { section: "Renuxcord", label: "Edit QuickCSS", run: () => VencordNative.quickCss.openEditor() },
        { section: "Renuxcord", label: "Reload Discord", hint: "Ctrl+R", run: () => location.reload() }
    ];

    if (!IS_WEB) {
        commands.push(
            { section: "Renuxcord", label: "Relaunch Discord", run: relaunch },
            { section: "Renuxcord", label: "Open settings folder", run: () => VencordNative.settings.openFolder() }
        );
    }

    if (isPluginEnabled("PluginProfiles")) {
        for (const name of Object.keys(getProfiles()))
            commands.push({ section: "Profiles", label: `Switch to profile "${name}"`, run: () => applyProfile(name) });
    }

    for (const p of Object.values(plugins)) {
        if (!p.toolboxActions || typeof p.toolboxActions === "function" || !isPluginEnabled(p.name)) continue;
        for (const [label, action] of Object.entries(p.toolboxActions))
            commands.push({ section: p.name, label, run: action });
    }

    for (const p of toggleablePlugins()) {
        const on = isPluginEnabled(p.name);
        commands.push({
            section: "Plugins",
            label: `${on ? "Disable" : "Enable"} ${p.name}`,
            hint: p.description,
            run: () => togglePlugin(p.name)
        });
    }

    if (settings.store.includeChannels) {
        const guildId = SelectedGuildStore.getGuildId();
        if (guildId) {
            const guild = GuildStore.getGuild(guildId);
            for (const c of Object.values(ChannelStore.getMutableGuildChannelsForGuild(guildId) ?? {}))
                if (TEXT_LIKE.has(c.type))
                    commands.push({ section: guild?.name ?? "This server", label: `Go to #${c.name}`, run: () => NavigationRouter.transitionTo(`/channels/${guildId}/${c.id}`) });
        }

        for (const c of ChannelStore.getSortedPrivateChannels().slice(0, 50)) {
            const name = c.name || c.recipients.map(id => { const u = UserStore.getUser(id); return u?.globalName || u?.username || "someone"; }).join(", ");
            commands.push({ section: "DMs", label: `Message ${name}`, run: () => NavigationRouter.transitionTo(`/channels/@me/${c.id}`) });
        }
    }

    if (settings.store.includeServers) {
        for (const g of GuildStore.getGuildsArray())
            commands.push({ section: "Servers", label: `Go to ${g.name}`, run: () => NavigationRouter.transitionToGuild(g.id) });
    }

    return commands;
}

// Text, announcement, forum and media channels
const TEXT_LIKE = new Set([0, 5, 15, 16]);

function score(query: string, text: string) {
    if (!query) return 1;
    const q = query.toLowerCase();
    const t = text.toLowerCase();

    const at = t.indexOf(q);
    if (at !== -1) return 1000 - at * 3 - (t.length - q.length) * 0.05;

    let from = 0;
    let streak = 0;
    let total = 0;
    for (const ch of q) {
        if (ch === " ") continue;
        const found = t.indexOf(ch, from);
        if (found === -1) return -1;
        streak = found === from ? streak + 1 : 0;
        total += 1 + streak * 3 - Math.min(found - from, 10) * 0.2;
        from = found + 1;
    }
    return total;
}

function rank(commands: PaletteCommand[], query: string) {
    return commands
        .map(c => ({ c, s: Math.max(score(query, c.label), score(query, `${c.section} ${c.label}`) - 5) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 60)
        .map(x => x.c);
}

let openKey: string | null = null;

function Palette({ modalProps }: { modalProps: any; }) {
    const commands = useMemo(gatherCommands, []);
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const results = useMemo(() => rank(commands, query), [query]);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => setIndex(0), [query]);
    useEffect(() => {
        listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
    }, [index]);

    const run = (cmd?: PaletteCommand) => {
        if (!cmd) return;
        modalProps.onClose();
        setTimeout(() => {
            try {
                cmd.run();
            } catch (err) {
                showToast({ text: `Failed: ${String(err)}`, variant: "critical" });
            }
        }, 50);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex(i => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex(i => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            run(results[index]);
        }
    };

    return (
        <Modal {...modalProps} size="md" title="Command Palette" subtitle="Plugins, settings, profiles, servers and quick actions">
            <input
                className={cl("input")}
                autoFocus
                value={query}
                placeholder="Type to search…"
                onChange={e => setQuery(e.currentTarget.value)}
                onKeyDown={onKeyDown}
            />
            <div className={cl("list")} ref={listRef}>
                {results.length === 0 && <div className={cl("empty")}>Nothing matches "{query}"</div>}
                {results.map((c, i) => (
                    <div
                        key={`${c.section}:${c.label}`}
                        data-index={i}
                        className={cl("item", i === index && "selected")}
                        onMouseMove={() => i !== index && setIndex(i)}
                        onClick={() => run(c)}
                    >
                        <span className={cl("section")}>{c.section}</span>
                        <span className={cl("label")}>{c.label}</span>
                        {c.hint && <span className={cl("hint")}>{c.hint}</span>}
                    </div>
                ))}
            </div>
        </Modal>
    );
}

export function openPalette() {
    if (openKey) {
        closeModal(openKey);
        openKey = null;
        return;
    }
    openKey = openModal(props => <Palette modalProps={props} />, { onCloseCallback: () => { openKey = null; } });
}

function onKeyDown(e: KeyboardEvent) {
    if (!matchesHotkey(settings.store.hotkey, e)) return;
    e.preventDefault();
    e.stopPropagation();
    openPalette();
}

export default definePlugin({
    name: "CommandPalette",
    description: "Ctrl+Shift+K command palette: toggle any plugin, switch plugin profiles, run toolbox actions, open settings and jump to servers",
    tags: ["Renuxcord", "Shortcuts", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    toolboxActions: {
        "Open Command Palette": openPalette
    },

    start() {
        window.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
    }
});
