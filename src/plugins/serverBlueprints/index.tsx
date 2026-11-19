/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { actions } from "@plugins/renuxBridge/actions";
import { applyLayout, exportLayout, ServerLayout } from "@plugins/renuxBridge/layout";
import { confirmAction, copyWithToast } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin from "@utils/types";
import { Guild } from "@vencord/discord-types";
import { Menu, Modal, openModal, PermissionsBits, PermissionStore, showToast, TextArea, useState } from "@webpack/common";

const canBuild = (guild: Guild) =>
    PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, guild) && PermissionStore.can(PermissionsBits.MANAGE_ROLES, guild);

function copyBlueprint(guild: Guild) {
    try {
        copyWithToast(JSON.stringify(exportLayout(guild.id), null, 2), "Server blueprint copied");
    } catch (err) {
        showToast({ text: `Couldn't export: ${String(err)}`, variant: "critical" });
    }
}

function openApplyModal(guild: Guild) {
    openModal(props => {
        function ApplyBlueprint() {
            const [text, setText] = useState("");
            const [wipe, setWipe] = useState(false);
            const [busy, setBusy] = useState(false);
            const [status, setStatus] = useState("");
            const [error, setError] = useState("");

            async function run() {
                let layout: ServerLayout;
                try {
                    layout = JSON.parse(text);
                } catch (err) {
                    setError(`That isn't valid JSON: ${String(err)}`);
                    return;
                }

                setBusy(true);
                setError("");
                try {
                    const res = await applyLayout(guild.id, layout, { wipe, allowDeletes: wipe, allowMessages: true, onProgress: setStatus });
                    const made = res.created.channels.length + res.created.categories.length;
                    showToast({ text: `Blueprint applied: ${made} channels and ${res.created.roles.length} roles created`, variant: "success" });
                    if (res.warnings.length) {
                        setStatus(`Done with ${res.warnings.length} warning(s): ${res.warnings.join(" · ")}`);
                    } else {
                        props.onClose();
                    }
                } catch (err) {
                    setError(String(err instanceof Error ? err.message : err));
                } finally {
                    setBusy(false);
                }
            }

            return (
                <Modal
                    {...props}
                    size="lg"
                    title={`Apply a blueprint to ${guild.name}`}
                    subtitle="Paste a blueprint copied from another server, or one your AI wrote"
                    notice={error ? { message: error, type: "critical" } : undefined}
                    actions={[
                        { text: "Cancel", variant: "secondary", onClick: props.onClose },
                        { text: "Apply", variant: wipe ? "critical-primary" : "primary", onClick: run, loading: busy, disabled: busy || !text.trim() }
                    ]}
                >
                    <TextArea value={text} onChange={setText} placeholder={'{ "roles": [...], "categories": [...] }'} rows={14} />
                    <FormSwitch
                        title="Wipe the server first"
                        description="Deletes every existing channel, and every role if the blueprint has roles. This can't be undone."
                        value={wipe}
                        onChange={setWipe}
                        hideBorder
                    />
                    {status && <Paragraph style={{ color: "var(--text-muted)" }}>{status}</Paragraph>}
                </Modal>
            );
        }
        return <ApplyBlueprint />;
    });
}

function cloneServer(guild: Guild) {
    confirmAction({
        title: `Clone ${guild.name}?`,
        subtitle: "Makes a brand new server with the same roles, categories, channels and permissions. Messages and members aren't copied.",
        confirmText: "Clone it",
        variant: "primary",
        onConfirm: async () => {
            showToast({ text: `Cloning ${guild.name}…` });
            try {
                const layout = exportLayout(guild.id);
                await actions.createServer({ name: `${guild.name} (copy)`.slice(0, 100), layout, open: true }, {
                    allowWrite: true,
                    allowDestructive: false,
                    allowMessages: false,
                    log: text => showToast({ text, variant: "success" }),
                    progress: () => { }
                });
            } catch (err) {
                showToast({ text: `Clone failed: ${String(err instanceof Error ? err.message : err)}`, variant: "critical" });
            }
        }
    });
}

const guildContext: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;

    children.push(
        <Menu.MenuGroup key="rx-blueprints">
            <Menu.MenuItem id="rx-blueprints" label="Server Blueprints">
                <Menu.MenuItem id="rx-blueprint-copy" label="Copy blueprint" action={() => copyBlueprint(guild)} />
                <Menu.MenuItem id="rx-blueprint-clone" label="Clone into a new server" action={() => cloneServer(guild)} />
                {canBuild(guild) && <Menu.MenuItem id="rx-blueprint-apply" label="Apply blueprint…" action={() => openApplyModal(guild)} />}
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "ServerBlueprints",
    description: "Copy any server's roles, channels and permissions as a blueprint, paste blueprints into your servers, or clone a server's whole layout in one click",
    tags: ["Renuxcord", "Servers", "Utility"],
    authors: [RenuxDevs.Larpbase],

    contextMenus: {
        "guild-context": guildContext,
        "guild-header-popout": guildContext
    }
});
