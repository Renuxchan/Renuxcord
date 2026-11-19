/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Heading } from "@components/Heading";
import { classNameFactory } from "@utils/css";
import { Modal, openModal, TextInput, useState } from "@webpack/common";

import { COLORS, createGroup, deleteGroup, FriendGroup, ICONS, updateGroup } from "./store";

const cl = classNameFactory("rx-fg-");
const isHex = (s: string) => /^#[\da-f]{6}$/i.test(s);

/** Create a new group (no `group`) or edit an existing one */
export function openGroupEditor(group?: FriendGroup, addMember?: string) {
    openModal(props => {
        function Editor() {
            const [name, setName] = useState(group?.name ?? "");
            const [icon, setIcon] = useState(group?.icon ?? ICONS[Math.floor(Math.random() * 8)]);
            const [color, setColor] = useState(group?.color ?? COLORS[0]);
            const [customColor, setCustomColor] = useState(group && !COLORS.includes(group.color) ? group.color : "");

            const save = () => {
                const finalColor = isHex(customColor) ? customColor : color;
                if (group) updateGroup(group.id, { name: name.trim() || group.name, icon, color: finalColor });
                else createGroup(name, icon, finalColor, addMember ? [addMember] : []);
                props.onClose();
            };

            const actions = [
                { text: "Cancel", variant: "secondary", onClick: props.onClose },
                { text: group ? "Save" : "Create group", variant: "primary", onClick: save, disabled: !name.trim() }
            ];
            if (group) actions.unshift({
                text: "Delete group",
                variant: "critical-primary",
                onClick: () => {
                    deleteGroup(group.id);
                    props.onClose();
                },
                disabled: false
            });

            return (
                <Modal {...props} title={group ? `Edit ${group.name}` : "New friend group"} subtitle="Pick a name, an icon and a colour" actions={actions}>
                    <div className={cl("editor")}>
                        <div className={cl("preview")} style={{ "--rx-fg-color": isHex(customColor) ? customColor : color } as React.CSSProperties}>
                            <span className={cl("preview-icon")}>{icon}</span>
                            <span className={cl("preview-name")}>{name.trim() || "Group name"}</span>
                        </div>

                        <section>
                            <Heading tag="h5">Name</Heading>
                            <TextInput value={name} onChange={setName} placeholder="Besties, Squad, School…" autoFocus maxLength={40} />
                        </section>

                        <section>
                            <Heading tag="h5">Icon</Heading>
                            <div className={cl("icon-grid")}>
                                {ICONS.map(e => (
                                    <button key={e} className={cl("icon-option", icon === e && "selected")} onClick={() => setIcon(e)}>{e}</button>
                                ))}
                                <input
                                    className={cl("icon-custom")}
                                    value={ICONS.includes(icon) ? "" : icon}
                                    onChange={e => e.currentTarget.value && setIcon([...e.currentTarget.value].slice(0, 2).join(""))}
                                    placeholder="Any emoji"
                                    maxLength={8}
                                />
                            </div>
                        </section>

                        <section>
                            <Heading tag="h5">Colour</Heading>
                            <div className={cl("color-grid")}>
                                {COLORS.map(c => (
                                    <button
                                        key={c}
                                        aria-label={c}
                                        className={cl("color-option", color === c && !isHex(customColor) && "selected")}
                                        style={{ background: c }}
                                        onClick={() => { setColor(c); setCustomColor(""); }}
                                    />
                                ))}
                                <input
                                    className={cl("color-custom", isHex(customColor) && "selected")}
                                    value={customColor}
                                    onChange={e => setCustomColor(e.currentTarget.value.trim())}
                                    placeholder="#ff4d8d"
                                    maxLength={7}
                                />
                            </div>
                        </section>
                    </div>
                </Modal>
            );
        }
        return <Editor />;
    });
}
