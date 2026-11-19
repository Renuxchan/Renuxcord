/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { setPluginEnabled } from "@plugins/pluginProfiles/toggle";
import { promptToRestart } from "@utils/promptToRestart";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin from "@utils/types";
import { Modal, openModal, SettingsRouter, useReducer } from "@webpack/common";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

const SEEN_KEY = "Renuxcord_welcomeSeen";

export const RENUXCORD_PLUGINS = [
    "RenuxBridge", "RenuxAI", "CommandPalette", "RenuxTheme", "ServerBlueprints", "LinkSafety", "GhostPingAlert",
    "KeywordAlerts", "MentionSound", "MessageScheduler", "Bookmarks", "FriendWatch", "VoiceLog", "SessionStats",
    "PluginProfiles", "RenuxBadges"
];

function openWelcome() {
    let restartNeeded = false;

    openModal(props => {
        function Welcome() {
            const [, rerender] = useReducer((x: number) => x + 1, 0);
            return (
                <Modal
                    {...props}
                    size="lg"
                    title="Welcome to Renuxcord ✨"
                    subtitle="All 170+ classic plugins are in here too. These are the Renuxcord exclusives, switch on whatever you like:"
                    actions={[
                        {
                            text: "All Renuxcord settings",
                            variant: "secondary",
                            onClick: () => {
                                props.onClose();
                                SettingsRouter.openUserSettings("vencord_main_panel");
                            }
                        },
                        { text: "Let's go", variant: "primary", onClick: props.onClose }
                    ]}
                >
                    {RENUXCORD_PLUGINS.filter(n => plugins[n]).map(name => (
                        <FormSwitch
                            key={name}
                            title={name}
                            description={plugins[name].description}
                            value={isPluginEnabled(name)}
                            onChange={v => {
                                if (setPluginEnabled(name, v) === "restart") restartNeeded = true;
                                rerender();
                            }}
                            hideBorder
                        />
                    ))}
                    <Paragraph style={{ color: "var(--text-muted)", marginTop: 8 }}>
                        Tip: press Ctrl+Shift+K (with CommandPalette on) to do anything from the keyboard. Run /renuxcord any time for version info.
                    </Paragraph>
                </Modal>
            );
        }
        return <Welcome />;
    }, {
        onCloseCallback: () => {
            void DataStore.set(SEEN_KEY, true);
            if (restartNeeded) promptToRestart("reload", { subtitle: "Some of the plugins you switched on need a reload" });
        }
    });
}

export default definePlugin({
    name: "RenuxcordWelcome",
    description: "Renuxcord's welcome screen on first launch and the /renuxcord info command",
    tags: ["Renuxcord"],
    authors: [RenuxDevs.Larpbase],
    required: true,

    toolboxActions: {
        "Renuxcord welcome screen": openWelcome
    },

    commands: [{
        name: "renuxcord",
        description: "Show Renuxcord version and plugin info",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_, ctx) {
            const all = Object.values(plugins);
            const enabled = all.filter(p => isPluginEnabled(p.name)).length;
            const ours = RENUXCORD_PLUGINS.filter(n => plugins[n] && isPluginEnabled(n));
            sendBotMessage(ctx.channel.id, {
                content: [
                    `**Renuxcord** \`${gitHash}\` · v${VERSION}`,
                    `Plugins: **${enabled}** of ${all.length} on · Renuxcord plugins on: ${ours.length ? ours.join(", ") : "none yet"}`,
                    `Source & updates: <https://github.com/${gitRemote}>`
                ].join("\n")
            });
        }
    }],

    async start() {
        if (await DataStore.get(SEEN_KEY)) return;
        setTimeout(openWelcome, 4000);
    }
});
