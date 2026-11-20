/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { actions } from "@plugins/renuxBridge/actions";
import { rest } from "@plugins/renuxBridge/discord";
import { applyLayout, exportLayout, ServerLayout } from "@plugins/renuxBridge/layout";
import { copyWithToast } from "@utils/discord";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin from "@utils/types";
import { Guild } from "@vencord/discord-types";
import { Menu, Modal, NavigationRouter, openModal, PermissionsBits, PermissionStore, showToast, TextArea, TextInput, useEffect, useRef, useState } from "@webpack/common";

type BuildResult = Awaited<ReturnType<typeof applyLayout>>;

const canBuild = (guild: Guild) =>
    PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, guild) && PermissionStore.can(PermissionsBits.MANAGE_ROLES, guild);

const errorText = (err: unknown) => String(err instanceof Error ? err.message : err);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const muted = { color: "var(--text-muted)" };

function copyBlueprint(guild: Guild) {
    try {
        const layout = exportLayout(guild.id);
        const left = layout.skipped?.length ?? 0;
        copyWithToast(
            JSON.stringify(layout, null, 2),
            left ? `Server blueprint copied. ${plural(left, "channel")} couldn't be included, see "skipped"` : "Server blueprint copied"
        );
    } catch (err) {
        showToast({ text: `Couldn't export: ${errorText(err)}`, variant: "critical" });
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
                    setError(errorText(err));
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
                    {status && <Paragraph style={muted}>{status}</Paragraph>}
                </Modal>
            );
        }
        return <ApplyBlueprint />;
    });
}

/** The icon as a PNG data URI, which is what Discord takes for a new icon */
async function iconDataUri(guild: Guild) {
    const res = await fetch(`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=512`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

interface Cloned {
    id: string;
    name: string;
    channels: number;
    roles: number;
    notes: string[];
}

const openServer = (id: string) => NavigationRouter.transitionToGuild(id);

function countLayout(layout: ServerLayout) {
    const channels = (layout.channels?.length ?? 0) + (layout.categories ?? []).reduce((n, c) => n + (c.channels?.length ?? 0), 0);
    return { roles: layout.roles?.length ?? 0, categories: layout.categories?.length ?? 0, channels };
}

function openCloneModal(guild: Guild) {
    let layout: ServerLayout;
    try {
        layout = exportLayout(guild.id);
    } catch (err) {
        showToast({ text: `Couldn't read ${guild.name}: ${errorText(err)}`, variant: "critical" });
        return;
    }

    const counts = countLayout(layout);
    const steps = counts.roles + counts.categories + counts.channels;

    openModal(props => {
        function CloneServer() {
            const [name, setName] = useState(`${guild.name} (copy)`.slice(0, 100));
            const [busy, setBusy] = useState(false);
            const [status, setStatus] = useState("");
            const [error, setError] = useState("");
            const [done, setDone] = useState<Cloned | null>(null);

            // Closing the window mid-clone doesn't stop it, so the result then comes as a notification
            const shown = useRef(true);
            useEffect(() => () => { shown.current = false; }, []);

            async function run() {
                setBusy(true);
                setError("");
                let step = 0;

                try {
                    const made = await actions.createServer({ name: name.trim(), layout, open: false }, {
                        allowWrite: true,
                        allowDestructive: false,
                        allowMessages: false,
                        log: () => { },
                        progress: text => {
                            const counted = /^(Role|Category|Channel|Voice) /.test(text);
                            if (counted) step++;
                            if (shown.current) setStatus(counted ? `${text} (${Math.min(step, steps)} of ${steps})` : text);
                        }
                    }) as { id: string; name: string; layout?: BuildResult; };

                    const built = made.layout;
                    const notes = [...built?.warnings ?? []];
                    if (guild.icon) {
                        if (shown.current) setStatus("Server icon");
                        try {
                            await rest("patch", `/guilds/${made.id}`, { icon: await iconDataUri(guild) });
                        } catch (err) {
                            notes.push(`Couldn't copy the server icon: ${errorText(err)}`);
                        }
                    }

                    const result: Cloned = {
                        id: made.id,
                        name: made.name,
                        channels: (built?.created.channels.length ?? 0) + (built?.created.categories.length ?? 0),
                        roles: built?.created.roles.length ?? 0,
                        notes
                    };

                    if (!shown.current) {
                        showNotification({
                            title: `Cloned ${guild.name}`,
                            body: `${result.name} is ready${notes.length ? `, with ${plural(notes.length, "note")}: ${notes.join(" · ")}` : ""}. Click to open it.`,
                            onClick: () => openServer(result.id)
                        });
                    } else if (notes.length) {
                        setDone(result);
                    } else {
                        showToast({ text: `Cloned ${guild.name}`, variant: "success" });
                        props.onClose();
                        openServer(result.id);
                    }
                } catch (err) {
                    if (shown.current) setError(errorText(err));
                    else showToast({ text: `Clone failed: ${errorText(err)}`, variant: "critical" });
                } finally {
                    if (shown.current) {
                        setBusy(false);
                        setStatus("");
                    }
                }
            }

            if (done) {
                return (
                    <Modal
                        {...props}
                        size="md"
                        title={`Cloned ${guild.name}`}
                        subtitle={`${done.name} has ${plural(done.channels, "channel")} and ${plural(done.roles, "role")}. A few things couldn't be copied as they are:`}
                        actions={[
                            { text: "Close", variant: "secondary", onClick: props.onClose },
                            { text: "Open server", variant: "primary", onClick: () => { props.onClose(); openServer(done.id); } }
                        ]}
                    >
                        {done.notes.map((note, i) => <Paragraph key={i} style={{ marginBottom: 6 }}>• {note}</Paragraph>)}
                    </Modal>
                );
            }

            const what = [
                plural(counts.roles, "role"),
                plural(counts.categories, "category", "categories"),
                plural(counts.channels, "channel")
            ].join(", ");

            return (
                <Modal
                    {...props}
                    size="md"
                    title={`Clone ${guild.name}`}
                    subtitle="Makes a brand new server with the same roles, categories, channels, permissions, settings and icon"
                    notice={error ? { message: error, type: "critical" } : undefined}
                    actions={[
                        { text: busy ? "Hide" : "Cancel", variant: "secondary", onClick: props.onClose },
                        { text: "Clone it", variant: "primary", onClick: run, loading: busy, disabled: busy || !name.trim() }
                    ]}
                >
                    <TextInput value={name} onChange={setName} placeholder="New server name" maxLength={100} disabled={busy} />
                    <Paragraph style={{ marginTop: 12 }}>Copies {what}. Messages, members, emojis and bots stay behind.</Paragraph>
                    {layout.skipped?.map((note, i) => <Paragraph key={i} style={{ ...muted, marginTop: 8 }}>{note}</Paragraph>)}
                    {busy && <Paragraph style={{ ...muted, marginTop: 8 }}>{status || "Creating the server"}… You can hide this, it keeps going.</Paragraph>}
                </Modal>
            );
        }
        return <CloneServer />;
    });
}

const guildContext: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;

    children.push(
        <Menu.MenuGroup key="rx-blueprints">
            <Menu.MenuItem id="rx-blueprints" label="Server Blueprints">
                <Menu.MenuItem id="rx-blueprint-copy" label="Copy blueprint" action={() => copyBlueprint(guild)} />
                <Menu.MenuItem id="rx-blueprint-clone" label="Clone into a new server…" action={() => openCloneModal(guild)} />
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
