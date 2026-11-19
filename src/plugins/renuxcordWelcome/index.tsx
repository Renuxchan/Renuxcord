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

// Exclusives from the first releases, for people who saw the welcome screen before it remembered plugin names
const FIRST_RELEASE = [
    "RenuxBridge", "RenuxAI", "FriendGroups", "CommandPalette", "RenuxTheme", "ServerBlueprints", "LinkSafety",
    "MessageReminders", "ChatExporter", "FriendTimes", "PanicBlur", "GhostPingAlert", "KeywordAlerts", "MentionSound",
    "MessageScheduler", "Bookmarks", "FriendWatch", "VoiceLog", "SessionStats", "PluginProfiles", "RenuxBadges"
];

export const RENUXCORD_PLUGINS = [
    ...FIRST_RELEASE,
    "QuickTools", "TextFX", "QuickReplies", "TypingSounds", "Notepad", "FocusMode", "SecretGuard", "Snipe", "LastSeen",
    "WhoIs", "ChannelWatch", "SpoilerShield", "Lookup", "MediaDownloader", "PlaytimeTracker", "BirthdayReminders",
    "StatusRotator", "FakeDeafen", "Confetti", "CSSSnippets"
];

function openWelcome(onlyNew?: string[]) {
    let restartNeeded = false;
    const shown = onlyNew ?? RENUXCORD_PLUGINS;

    openModal(props => {
        function Welcome() {
            const [, rerender] = useReducer((x: number) => x + 1, 0);
            return (
                <Modal
                    {...props}
                    size="lg"
                    title={onlyNew ? "✨ New in Renuxcord" : "Welcome to Renuxcord ✨"}
                    subtitle={onlyNew
                        ? `${onlyNew.length} new Renuxcord exclusive${onlyNew.length === 1 ? "" : "s"} just landed. Switch on whatever you like:`
                        : "All 170+ classic plugins are in here too. These are the Renuxcord exclusives, switch on whatever you like:"}
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
                    {shown.filter(n => plugins[n]).map(name => (
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
            void DataStore.set(SEEN_KEY, RENUXCORD_PLUGINS);
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
        "Renuxcord welcome screen": () => openWelcome()
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
        const seen = await DataStore.get<boolean | string[]>(SEEN_KEY);
        if (!seen) return void setTimeout(() => openWelcome(), 4000);

        const known = new Set(Array.isArray(seen) ? seen : FIRST_RELEASE);
        const fresh = RENUXCORD_PLUGINS.filter(n => !known.has(n) && plugins[n]);
        if (fresh.length) setTimeout(() => openWelcome(fresh), 4000);
    }
});
