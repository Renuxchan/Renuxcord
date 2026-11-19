/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { showNotification } from "@api/Notifications";
import { addPatch, isPluginEnabled, plugins, startPlugin } from "@api/PluginManager";
import { definePluginSettings, Settings, SettingsStore } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { setPluginEnabled } from "@plugins/pluginProfiles/toggle";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { promptToRestart } from "@utils/promptToRestart";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType, Plugin, PluginNative, StartAt } from "@utils/types";
import { onceReady } from "@webpack";
import { Modal, openModal, showToast, useReducer } from "@webpack/common";

import gitHash from "~git-hash";
import { PluginMeta } from "~plugins";

const Native = VencordNative.pluginHelpers.CustomPlugins as PluginNative<typeof import("./native")>;
const logger = new Logger("CustomPlugins", "#a78bfa");
const cl = classNameFactory("rx-cp-");

interface Entry {
    file: string;
    name?: string;
    error?: string;
}

const entries = new Map<string, Entry>();
const BIND_KEYS = ["onBeforeMessageEdit", "onBeforeMessageSend", "onMessageClick", "renderMemberListDecorator", "renderMessageAccessory", "renderMessageDecoration"] as const;

export const isCustomPlugin = (name: string) => PluginMeta[name]?.folderName?.startsWith("custom/") ?? false;

// What a custom plugin needs switched on, mirroring what the plugin manager does at startup
function neededPlugins(p: Plugin) {
    const needed = new Set(p.dependencies ?? []);
    if (p.commands?.length) needed.add("CommandsAPI");
    if (p.onBeforeMessageEdit || p.onBeforeMessageSend || p.onMessageClick) needed.add("MessageEventsAPI");
    if (p.chatBarButton) needed.add("ChatInputButtonAPI");
    if (p.renderMemberListDecorator) needed.add("MemberListDecoratorsAPI");
    if (p.renderMessageAccessory) needed.add("MessageAccessoriesAPI");
    if (p.renderMessageDecoration) needed.add("MessageDecorationsAPI");
    if (p.messagePopoverButton) needed.add("MessagePopoverAPI");
    if (p.userProfileBadge) needed.add("BadgeAPI");
    if (p.contextMenus) needed.add("ContextMenuAPI");
    return needed;
}

function setUp(p: Plugin) {
    if (p.settings) {
        p.settings.pluginName = p.name;
        for (const [key, def] of Object.entries(p.settings.def))
            if ((def as any).onChange) SettingsStore.addChangeListener(`plugins.${p.name}.${key}`, (def as any).onChange);
    }

    if (!isPluginEnabled(p.name)) return;

    for (const name of neededPlugins(p)) {
        const dep = plugins[name];
        if (!dep) {
            logger.warn(`${p.name} needs ${name}, which doesn't exist`);
            continue;
        }
        if (!isPluginEnabled(name)) {
            Settings.plugins[name].enabled = true;
            dep.patches?.forEach(patch => addPatch(patch, name));
        }
        dep.isDependency = true;
    }

    for (const key of BIND_KEYS) (p as any)[key] &&= (p as any)[key].bind(p);
    p.patches?.forEach(patch => addPatch(patch, p.name));

    // Everything else starts with the other plugins once Discord has loaded
    if (p.startAt === StartAt.Init) startPlugin(p);
}

const registry = {
    list: () => [...entries.values()],

    expect(files: string[]) {
        for (const file of files)
            entries.set(file, { file, error: "Didn't load. It probably has a syntax error: open DevTools (Ctrl+Shift+I) to see it" });
    },

    register(file: string, factory: (module: { exports: any; }, exports: any, api: typeof publicApi) => void) {
        try {
            const module = { exports: {} as any };
            factory(module, module.exports, publicApi);
            let def = module.exports?.default ?? module.exports;
            if (typeof def === "function") def = def(publicApi);

            if (!def || typeof def !== "object") throw new Error("set module.exports to your plugin object");
            if (typeof def.name !== "string" || !/^[\w -]{2,40}$/.test(def.name)) throw new Error("the plugin needs a name (2-40 letters, numbers, spaces)");
            if (plugins[def.name]) throw new Error(`there's already a plugin called ${def.name}`);

            def.description = typeof def.description === "string" ? def.description : "Custom plugin";
            def.authors = (Array.isArray(def.authors) && def.authors.length ? def.authors : [{ name: "Custom plugin" }])
                .map((a: any) => ({ name: String(a?.name ?? a), id: 0n }));
            def.tags = Array.isArray(def.tags) ? def.tags.filter((t: unknown) => typeof t === "string") : [];

            const plugin = def as Plugin;
            plugins[plugin.name] = plugin;
            PluginMeta[plugin.name] = { folderName: `custom/${file}`, userPlugin: true };
            setUp(plugin);

            entries.set(file, { file, name: plugin.name });
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            entries.set(file, { file, error });
            logger.error(`Custom plugin ${file} failed to load`, err);
        }
    }
};

const publicApi = {
    definePlugin: <T,>(p: T) => p,
    definePluginSettings,
    OptionType: { STRING: 0, NUMBER: 1, BIGINT: 2, BOOLEAN: 3, SELECT: 4, SLIDER: 5, COMPONENT: 6, CUSTOM: 7 },
    CommandOptionType: { SUB_COMMAND: 1, SUB_COMMAND_GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 },
    CommandInputType: { BUILT_IN: 0, BUILT_IN_TEXT: 1 },
    StartAt: { Init: "Init", DOMContentLoaded: "DOMContentLoaded", WebpackReady: "WebpackReady" },
    get Webpack() { return Vencord.Webpack; },
    get Common() { return Vencord.Webpack.Common; },
    get Api() { return Vencord.Api; },
    get Util() { return Vencord.Util; },
    get Components() { return Vencord.Components; },
    get React() { return Vencord.Webpack.Common.React; },
    showToast(text: string, variant: "default" | "success" | "critical" = "default") {
        Vencord.Webpack.Common.showToast({ text, variant });
    },
    notify(title: string, body: string) {
        showNotification({ title, body });
    },
    version: gitHash
};

function CustomPluginsManager() {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    const list = [...entries.values()];

    const toggle = (name: string) => {
        const res = setPluginEnabled(name, !isPluginEnabled(name));
        if (res === "failed") showToast({ text: `Couldn't switch ${name}`, variant: "critical" });
        if (res === "restart") promptToRestart("reload");
        rerender();
    };

    return (
        <Flex flexDirection="column" gap={12}>
            <Paragraph>
                Drop <code>.js</code> plugin files into your custom plugins folder and reload. They load before Discord does, so they can
                do anything built-in plugins can. The folder has a README and a working example to copy from.
            </Paragraph>
            <Flex gap={8}>
                <Button size="small" onClick={() => Native.openFolder()}>Open plugins folder</Button>
                <Button size="small" variant="secondary" onClick={() => location.reload()}>Reload Discord</Button>
            </Flex>

            <div className={cl("list")}>
                {!list.length && <div className={cl("empty")}>No custom plugins yet. Open the folder to get started.</div>}
                {list.map(e => (
                    <div key={e.file} className={cl("row", e.error && "row-error")}>
                        <div className={cl("row-main")}>
                            <div className={cl("name")}>{e.name ?? e.file}</div>
                            <div className={cl("meta")}>{e.error ?? `${e.file} · ${plugins[e.name!]?.description ?? ""}`}</div>
                        </div>
                        {e.name && (
                            <Button size="small" variant={isPluginEnabled(e.name) ? "secondary" : "primary"} onClick={() => toggle(e.name!)}>
                                {isPluginEnabled(e.name) ? "Turn off" : "Turn on"}
                            </Button>
                        )}
                    </div>
                ))}
            </div>

            <Paragraph className={cl("warning")}>
                Custom plugins run with full access to your Discord account. Only add files you wrote or trust.
            </Paragraph>
        </Flex>
    );
}

export function openCustomPluginsManager() {
    openModal(props => (
        <Modal {...props} size="md" title="Custom plugins" subtitle="Your own plugins, loaded from a folder" actions={[{ text: "Close", variant: "secondary", onClick: props.onClose }]}>
            <CustomPluginsManager />
        </Modal>
    ));
}

export default definePlugin({
    name: "CustomPlugins",
    description: "Loads your own plugins from %APPDATA%\\Renuxcord\\plugins (.js files) with full plugin powers: patches, commands, menus, settings",
    tags: ["Renuxcord", "Developers", "Utility"],
    authors: [RenuxDevs.Larpbase],
    required: true,
    startAt: StartAt.Init,

    settings: definePluginSettings({
        manager: {
            type: OptionType.COMPONENT,
            component: () => <CustomPluginsManager />
        }
    }),

    toolboxActions: {
        "Custom plugins…": openCustomPluginsManager,
        "Open custom plugins folder": () => void Native.openFolder()
    },

    start() {
        Object.assign(window, { RenuxcordCustomPlugins: registry, Renuxcord: publicApi });

        // Custom plugins register right after this; report broken ones once Discord is up
        onceReady.then(() => setTimeout(() => {
            const failed = [...entries.values()].filter(e => e.error);
            if (!failed.length) return;
            showNotification({
                title: `${failed.length} custom plugin${failed.length === 1 ? "" : "s"} didn't load`,
                body: failed.map(f => `${f.file}: ${f.error}`).join("\n"),
                onClick: openCustomPluginsManager
            });
        }, 3000));
    }
});
