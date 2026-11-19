/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessageObject } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType } from "@utils/types";
import { ConfirmModal, openModal } from "@webpack/common";

import { Finding, findSecrets } from "./detect";

const settings = definePluginSettings({
    ips: {
        type: OptionType.BOOLEAN,
        description: "Also warn about public IP addresses",
        default: false
    },
    emails: {
        type: OptionType.BOOLEAN,
        description: "Also warn about email addresses",
        default: false
    },
    phones: {
        type: OptionType.BOOLEAN,
        description: "Also warn about phone numbers",
        default: false
    }
});

function confirmSend(findings: Finding[]) {
    return new Promise<boolean>(resolve => {
        let decided = false;
        const decide = (send: boolean) => {
            if (decided) return;
            decided = true;
            resolve(send);
        };

        openModal(props => (
            <ConfirmModal
                {...props}
                title="🛡️ Hold on, that looks secret"
                subtitle={`Your message seems to contain ${findings.map(f => f.kind).join(", ")}. Anyone who sees it can use it.`}
                confirmText="Send anyway"
                cancelText="Don't send"
                variant="critical-primary"
                onConfirm={() => decide(true)}
                onCancel={() => decide(false)}
            >
                <div style={{ fontFamily: "var(--font-code)", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                    {findings.map(f => <span key={f.kind}>{f.kind}: {f.sample}</span>)}
                </div>
            </ConfirmModal>
        ), { onCloseCallback: () => decide(false) });
    });
}

export default definePlugin({
    name: "SecretGuard",
    description: "Stops you from leaking things by accident: asks before sending a message with a Discord token, Roblox cookie, API key, private key, password or card number (optionally IPs, emails and phone numbers too)",
    tags: ["Renuxcord", "Privacy", "Chat"],
    authors: [RenuxDevs.Larpbase],
    settings,

    async onBeforeMessageSend(_channelId: string, msg: MessageObject) {
        const findings = findSecrets(msg.content ?? "", settings.store);
        if (!findings.length) return;
        return (await confirmSend(findings)) ? undefined : { cancel: true };
    },

    async onBeforeMessageEdit(_channelId: string, _messageId: string, msg: MessageObject) {
        const findings = findSecrets(msg.content ?? "", settings.store);
        if (!findings.length) return;
        return (await confirmSend(findings)) ? undefined : { cancel: true };
    }
});
