/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "./constants";

/** Authors of Renuxcord's own plugins */
export const RenuxDevs = /* #__PURE__*/ Object.freeze({
    Larpbase: Devs.Larpbase,
});

const LOGO_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
    + "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#a78bfa'/><stop offset='1' stop-color='#ec4899'/></linearGradient></defs>"
    + "<rect width='64' height='64' rx='16' fill='url(#g)'/>"
    + "<path fill='#fff' fill-rule='evenodd' d='M20 48V16h14a9 9 0 0 1 2 17.8L46 48h-8.5l-9-13.5h-1V48zm7.5-20H33a3.5 3.5 0 0 0 0-7h-5.5z'/>"
    + "</svg>";

/** Renuxcord logo as an SVG data URI */
export const RENUXCORD_LOGO = "data:image/svg+xml," + encodeURIComponent(LOGO_SVG);
