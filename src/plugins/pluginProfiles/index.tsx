/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { promptToRestart } from "@utils/promptToRestart";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, Modal, openModal, showToast, TextInput, useState } from "@webpack/common";

import { setPluginEnabled, toggleablePlugins } from "./toggle";

type Profiles = Record<string, string[]>;

const SAFE_MODE_BACKUP = "Before safe mode";

export const settings = definePluginSettings({
    profiles: {
        type: OptionType.CUSTOM,
        default: {} as Profiles
    },
    manager: {
        type: OptionType.COMPONENT,
        component: () => <ProfileManager />
    }
});

export function getProfiles(): Profiles {
    return settings.store.profiles ?? {};
}

function enabledNow() {
    return toggleablePlugins().filter(p => isPluginEnabled(p.name)).map(p => p.name);
}

export function saveProfile(name: string, list = enabledNow()) {
    settings.store.profiles = { ...getProfiles(), [name]: list };
    showToast({ text: `Saved profile "${name}" (${list.length} plugins)`, variant: "success" });
}

function deleteProfile(name: string) {
    const { [name]: _, ...rest } = getProfiles();
    settings.store.profiles = rest;
}

export function applyProfile(name: string, list = getProfiles()[name]) {
    if (!list) return showToast({ text: `No profile called "${name}"`, variant: "critical" });

    const wanted = new Set(list);
    // Keep this plugin on so the profile can always be switched back
    wanted.add("PluginProfiles");

    let changed = 0;
    let restart = false;
    const failed: string[] = [];

    for (const p of toggleablePlugins()) {
        const res = setPluginEnabled(p.name, wanted.has(p.name));
        if (res === "unchanged") continue;
        if (res === "failed") failed.push(p.name);
        else changed++;
        if (res === "restart") restart = true;
    }

    showToast({
        text: `Profile "${name}": ${changed} plugin${changed === 1 ? "" : "s"} switched${failed.length ? `, ${failed.length} failed` : ""}`,
        variant: failed.length ? "critical" : "success"
    });

    if (restart) promptToRestart("reload", { subtitle: "Some plugins in this profile only switch over after a reload" });
}

export function enterSafeMode() {
    saveProfile(SAFE_MODE_BACKUP);
    applyProfile("Safe mode", ["PluginProfiles"]);
}

function openSaveModal() {
    openModal(props => {
        function SaveModal() {
            const [name, setName] = useState("");
            const save = () => {
                saveProfile(name.trim());
                props.onClose();
            };
            return (
                <Modal
                    {...props}
                    title="Save plugin profile"
                    subtitle="Remembers which plugins are switched on right now"
                    actions={[
                        { text: "Cancel", variant: "secondary", onClick: props.onClose },
                        { text: "Save", variant: "primary", onClick: save, disabled: !name.trim() }
                    ]}
                >
                    <TextInput value={name} onChange={setName} placeholder="Gaming, Minimal, Streaming…" autoFocus />
                </Modal>
            );
        }
        return <SaveModal />;
    });
}

function ProfileManager() {
    const { profiles } = settings.use(["profiles"]);
    const [name, setName] = useState("");
    const names = Object.keys(profiles ?? {});

    return (
        <Flex flexDirection="column" gap={12}>
            <Paragraph>
                Save which plugins are on as a profile and flip between setups in one click.
                Profiles also show up in the Renuxcord Toolbox and the Command Palette.
            </Paragraph>

            <Flex gap={8} alignItems="center">
                <div style={{ flex: 1 }}>
                    <TextInput value={name} onChange={setName} placeholder="New profile name" />
                </div>
                <Button disabled={!name.trim()} onClick={() => { saveProfile(name.trim()); setName(""); }}>
                    Save current
                </Button>
            </Flex>

            {names.length === 0
                ? <Paragraph style={{ color: "var(--text-muted)" }}>No profiles yet.</Paragraph>
                : names.map(n => (
                    <Flex key={n} alignItems="center" justifyContent="space-between" gap={8}>
                        <Paragraph><b>{n}</b> · {profiles[n].length} plugins</Paragraph>
                        <Flex gap={8}>
                            <Button size="small" onClick={() => applyProfile(n)}>Apply</Button>
                            <Button size="small" variant="secondary" onClick={() => saveProfile(n)}>Overwrite</Button>
                            <Button size="small" variant="dangerSecondary" onClick={() => deleteProfile(n)}>Delete</Button>
                        </Flex>
                    </Flex>
                ))}

            <Flex gap={8}>
                <Button variant="dangerSecondary" onClick={enterSafeMode}>Safe mode (all plugins off)</Button>
            </Flex>
        </Flex>
    );
}

export default definePlugin({
    name: "PluginProfiles",
    description: "Save sets of enabled plugins as profiles (Gaming, Minimal, Streaming…) and switch between them in one click, plus a safe mode for troubleshooting",
    tags: ["Renuxcord", "Organisation", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    toolboxActions() {
        const { profiles } = settings.use(["profiles"]);
        return [
            ...Object.keys(profiles ?? {}).map(n => (
                <Menu.MenuItem id={`rx-profile-${n}`} key={n} label={`Switch to "${n}"`} action={() => applyProfile(n)} />
            )),
            <Menu.MenuItem id="rx-profile-save" key="rx-save" label="Save current as profile…" action={openSaveModal} />
        ];
    }
});
