/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { showToast, useEffect, useState } from "@webpack/common";

import { installVoiceHook, isVoiceGateway } from "./hook";
import type { RelayInfo } from "./relay";
import { Trick, TRICK_NAMES } from "./tricks";

const Native = VencordNative.pluginHelpers.VoiceChatUnblocker as PluginNative<typeof import("./native")>;
const logger = new Logger("VoiceChatUnblocker");

const settings = definePluginSettings({
    trick: {
        type: OptionType.SELECT,
        description: "How the relay disguises the start of each voice connection",
        options: [
            { label: "Automatic: try each trick until one gets through (remembers what worked)", value: "auto", default: true },
            ...(Object.entries(TRICK_NAMES) as [Trick, string][]).map(([value, label]) => ({ label, value }))
        ]
    },
    lowTtl: {
        type: OptionType.NUMBER,
        description: "Hops the \"never reach Discord\" fakes live for. Raise it if those tricks don't help, lower it if voice breaks",
        default: 4
    },
    panel: { type: OptionType.COMPONENT, component: () => <Panel /> }
});

let uninstall: (() => void) | null = null;
let toldWorked = false;
let toldFailed = false;

// A few seconds after a relay opens, say once whether voice got through
function checkSoon() {
    setTimeout(async () => {
        const { relays } = await Native.status();
        if (relays.some(r => r.answered) && !toldWorked) {
            toldWorked = true;
            const r = relays.find(x => x.answered)!;
            showToast({ text: `Voice is going through Renuxcord's relay (${TRICK_NAMES[r.trick ?? "none"]})`, variant: "success" });
        } else if (relays.length && relays.every(r => r.failed) && !toldFailed) {
            toldFailed = true;
            showNotification({
                title: "Voice Chat Unblocker couldn't get voice through",
                body: "None of the tricks worked on this network, so it probably blocks Discord's voice servers by address. A VPN, or a proxy (the Drover plugin can use one), gets around that.",
                noPersist: true
            });
        }
    }, 8000);
}

function Panel() {
    const [state, setState] = useState<{ relays: RelayInfo[]; preferred: Trick | null; lastFailure: string | null; } | null>(null);

    useEffect(() => {
        let alive = true;
        const tick = () => Native.status().then(s => alive && setState(s)).catch(() => { });
        tick();
        const id = setInterval(tick, 1000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, []);

    const muted = { color: "var(--text-muted)" };
    return (
        <div>
            <Paragraph style={muted}>
                Join a voice channel and the voice connection shows up here. Works on Windows, macOS and Linux. If the Drover plugin is on too, turn one of them off.
            </Paragraph>
            {state?.preferred && <Paragraph style={{ marginTop: 8 }}>Last trick that got through: {TRICK_NAMES[state.preferred]}</Paragraph>}
            {state?.lastFailure && <Paragraph style={{ marginTop: 8, color: "var(--text-feedback-critical)" }}>{state.lastFailure}</Paragraph>}
            {state?.relays.map(r => (
                <Paragraph key={r.id} style={{ marginTop: 8 }}>
                    {r.server} via 127.0.0.1:{r.port} ·{" "}
                    {r.answered ? `connected with "${TRICK_NAMES[r.trick ?? "none"]}"` : r.failed ? "no answer from the server" : `trying trick ${r.attempts}`}
                    {" "}· sent {r.up}, received {r.down}, decoys {r.decoys}
                </Paragraph>
            ))}
        </div>
    );
}

export default definePlugin({
    name: "VoiceChatUnblocker",
    description: "Voice chat unblocker: gets Discord voice through networks that block it (like the UAE). Voice goes through a tiny relay inside Renuxcord that starts every connection with decoy packets and switches tricks until one gets through. No DLLs, works on Windows, macOS and Linux",
    tags: ["Renuxcord", "Voice", "Utility"],
    authors: [RenuxDevs.Larpbase],
    settings,

    start() {
        uninstall = installVoiceHook(window, {
            isVoiceUrl: isVoiceGateway,
            openRelay: async (owner, ip, port) => {
                const relay = await Native.openRelay(owner, ip, port, { trick: settings.store.trick as "auto" | Trick, lowTtl: settings.store.lowTtl });
                checkSoon();
                return relay;
            },
            closeOwner: owner => void Native.closeOwner(owner),
            log: (text, err) => (err ? logger.error(text, err) : logger.info(text))
        });
    },

    stop() {
        uninstall?.();
        uninstall = null;
        void Native.closeAll();
    }
});
