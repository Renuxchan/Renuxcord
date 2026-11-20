/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotice } from "@api/Notices";
import { showNotification } from "@api/Notifications";
import { relaunch } from "@utils/native";
import { changes } from "@utils/updater";

/** How often Renuxcord looks for a new release while Discord is open */
export const UPDATE_CHECK_INTERVAL = 10 * 60_000;

// Newest commit we've told the user about, so each release is announced once
let announced = "";

function firstTimeFor() {
    // GitHub lists the commits oldest first
    const newest = changes?.at(-1)?.hash ?? "unknown";
    if (announced === newest) return false;
    announced = newest;
    return true;
}

function WhatsNew({ footer }: { footer: string; }) {
    const news = (changes ?? []).slice(-3).reverse().map(c => c.message);
    return (
        <div>
            {news.length > 0 && (
                <ul style={{ margin: "4px 0 6px", paddingLeft: 18, listStyle: "disc" }}>
                    {news.map((message, i) => <li key={i}>{message}</li>)}
                </ul>
            )}
            <b>{footer}</b>
        </div>
    );
}

/** A downloaded update is waiting: say so in a notification and in a banner that stays until Discord restarts */
export function announceUpdateReady(delay: number) {
    if (!firstTimeFor()) return;

    setTimeout(() => {
        showNotification({
            title: "Renuxcord has been updated",
            body: "Restart Discord to use the new version. Click here to restart.",
            richBody: <WhatsNew footer="Click here to restart." />,
            permanent: true,
            noPersist: true,
            onClick: relaunch
        });
        showNotice({
            message: "Renuxcord has been updated. Restart Discord to use the new version.",
            buttonText: "Restart",
            callback: relaunch
        });
    }, delay);
}

/** Auto-update is off: tell the user once per release that one is out */
export function announceUpdateAvailable(delay: number, openUpdater: () => void) {
    if (!firstTimeFor()) return;

    setTimeout(() => showNotification({
        title: "A Renuxcord update is out",
        body: "Click here to see what's new and update.",
        richBody: <WhatsNew footer="Click here to see it and update." />,
        permanent: true,
        noPersist: true,
        onClick: openUpdater
    }), delay);
}
