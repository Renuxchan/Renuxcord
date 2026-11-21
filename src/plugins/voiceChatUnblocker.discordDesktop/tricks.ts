/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Shared by the settings page and the relay (no Node modules in here, the settings page runs in Discord's window)

export type Trick = "junk" | "junk-lowttl" | "bigjunk" | "lowttl" | "none";

/** The order "auto" tries them in. Small junk first: the simplest trick, and the one known to work in the UAE */
export const AUTO_TRICKS: Trick[] = ["junk", "junk-lowttl", "bigjunk", "lowttl", "none"];

export const TRICK_NAMES: Record<Trick, string> = {
    junk: "Small junk packets first",
    "junk-lowttl": "Junk plus fakes that never reach Discord",
    bigjunk: "Bigger junk packets first",
    lowttl: "Fakes that never reach Discord",
    none: "No tricks (plain relay)"
};
