/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { OptionType, PluginSettingDef } from "@utils/types";

interface Snippet { description: string; css: string; default?: boolean; }

const hide = (...selectors: string[]) => `${selectors.join(",\n")} { display: none !important; }`;

// Selectors use Discord's stable class-name prefixes, asset URLs and attributes, so they survive most Discord updates
const SNIPPETS: Record<string, Snippet> = {
    hideNitroUpsells: {
        description: "Hide Nitro, Shop and Quests tabs and upsell banners",
        default: true,
        css: hide(
            'li:has(a[href="/store"])', 'li:has(a[href="/shop"])', 'li:has(a[href="/quest-home"])',
            '[class*="upsell_"]'
        )
    },
    hideGiftButton: {
        description: "Hide the gift button in the message box",
        default: true,
        css: hide('[class*="buttons_"] [aria-label="Send a gift"]', '[class*="buttons_"] > [class*="giftButton_"]')
    },
    hideStickerButton: {
        description: "Hide the sticker button in the message box",
        css: hide('[class*="buttons_"] [aria-label="Open sticker picker"]', '[class*="buttons_"] > [class*="stickerButton_"]')
    },
    hideAppsButton: {
        description: "Hide the Apps button in the message box",
        css: hide('[class*="buttons_"] [aria-label="Apps"]', '[class*="channelAppLauncher_"]')
    },
    hideActiveNow: {
        description: "Hide the Active Now column on the Friends page",
        css: hide('[class*="nowPlayingColumn_"]')
    },
    hideAvatarDecorations: {
        description: "Hide avatar decorations",
        css: hide('img[src*="avatar-decoration-presets"]')
    },
    hideProfileEffects: {
        description: "Hide animated profile effects",
        css: hide('[class*="profileEffects_"]')
    },
    hideNameplates: {
        description: "Hide nameplates in the member and DM lists",
        css: hide('img[src*="collectibles/nameplates"]', 'video[src*="collectibles/nameplates"]')
    },
    hideServerTags: {
        description: "Hide server tags next to people's names",
        css: hide('[class*="chipletContainerInline_"]')
    },
    hideCallButtons: {
        description: "Hide the voice and video call buttons in DMs (no more accidental calls)",
        css: hide('[aria-label="Start Voice Call"]', '[aria-label="Start Video Call"]')
    },
    hideHelpButton: {
        description: "Hide the Help button in the top bar",
        css: hide('a[href*="support.discord.com"]')
    },
    hideServerListExtras: {
        description: "Hide Add a Server, Discover and Download Apps in the server list",
        css: hide(
            '[class*="listItem_"]:has([data-list-item-id="guildsnav___create-join-button"])',
            '[class*="listItem_"]:has([data-list-item-id="guildsnav___guild-discover-button"])',
            '[class*="listItem_"]:has([data-list-item-id="guildsnav___app-download-button"])'
        )
    },
    thinScrollbars: {
        description: "Thinner scrollbars",
        css: '[class*="scroller_"]::-webkit-scrollbar { width: 6px !important; height: 6px !important; }'
    },
    roundedSquareAvatars: {
        description: "Rounded-square avatars instead of circles in chat",
        css: '[class*="messageListItem_"] img[class*="avatar_"] { border-radius: 30% !important; }'
    }
};

const settings = definePluginSettings(Object.fromEntries(
    Object.entries(SNIPPETS).map(([key, s]) => [key, {
        type: OptionType.BOOLEAN,
        description: s.description,
        default: s.default ?? false,
        onChange: () => apply()
    } satisfies PluginSettingDef])
) as Record<keyof typeof SNIPPETS, { type: OptionType.BOOLEAN; description: string; default: boolean; onChange(): void; }>);

const STYLE_ID = "rx-css-snippets";

function apply() {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        document.head.appendChild(style);
    }
    const store = settings.store as Record<string, boolean>;
    style.textContent = Object.entries(SNIPPETS).filter(([key]) => store[key]).map(([, s]) => s.css).join("\n\n");
}

export default definePlugin({
    name: "CSSSnippets",
    description: "One-click Discord tweaks: hide Nitro and Shop upsells, the gift, sticker and app buttons, Active Now, avatar decorations, profile effects, nameplates, server tags, call buttons and more",
    tags: ["Renuxcord", "Appearance", "Customisation"],
    authors: [RenuxDevs.Larpbase],
    settings,

    start: apply,

    stop() {
        document.getElementById(STYLE_ID)?.remove();
    }
});
