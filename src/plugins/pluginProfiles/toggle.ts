/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, pluginRequiresRestart, plugins, startDependenciesRecursive, startPlugin, stopPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";

export type ToggleResult = "ok" | "unchanged" | "restart" | "failed";

/** Turns a plugin on or off the same way the plugin settings card does */
export function setPluginEnabled(name: string, enabled: boolean): ToggleResult {
    const plugin = plugins[name];
    if (!plugin || plugin.required) return "failed";

    const settings = Settings.plugins[name];
    const wasEnabled = isPluginEnabled(name);
    if (wasEnabled === enabled) return "unchanged";

    if (enabled) {
        const { restartNeeded, failures } = startDependenciesRecursive(plugin);
        if (failures.length) return "failed";
        if (restartNeeded) {
            settings.enabled = true;
            return "restart";
        }
    }

    if (pluginRequiresRestart(plugin)) {
        settings.enabled = enabled;
        return "restart";
    }

    if (wasEnabled && !plugin.started) {
        settings.enabled = false;
        return "ok";
    }

    if (!(enabled ? startPlugin(plugin) : stopPlugin(plugin))) {
        settings.enabled = false;
        return "failed";
    }

    settings.enabled = enabled;
    return "ok";
}

/** Plugins a user can switch on and off */
export function toggleablePlugins() {
    return Object.values(plugins)
        .filter(p => !p.required && !p.hidden)
        .sort((a, b) => a.name.localeCompare(b.name));
}
