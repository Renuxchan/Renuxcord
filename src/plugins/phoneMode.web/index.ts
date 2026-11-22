/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import { Logger } from "@utils/Logger";
import { RenuxDevs } from "@utils/renuxcord";
import definePlugin, { StartAt } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

import style from "./style.css?managed";

// The Renuxcord phone apps run Discord's full app (calls, discovery, menus) by giving it a computer's user agent with
// "RenuxcordApp/1" on the end. This plugin turns that full app into a phone layout: the server and channel list on one
// screen and the chat on the next, hold-to-open menus, swipes, the back button and haptics.

const logger = new Logger("PhoneMode", "#ff5a2c");

const UA = navigator.userAgent;
const IN_APP = /\bRenuxcordApp\/\d/.test(UA);
// The apps can still show Discord's own phone site instead; then Discord does the layout and this stays out of it
const FULL_APP = IN_APP && !/Android|iPhone|iPad|iPod|Mobile/.test(UA);
const PHONE = matchMedia("(max-width: 760px)");
const LONG_PRESS_MS = 420;
const SIDE_PANELS = '[class*="membersWrap_"], [class*="profilePanel_"], [class*="userPanelOuter_"], [class*="threadSidebar_"], [class*="searchResultsWrap_"]';

const ChannelSectionStore = findStoreLazy("ChannelSectionStore");

type Mode = "nav" | "chat";

// The layout's state lives in data-rx-* attributes on <html>, not classes: Discord rewrites <html>'s class attribute
// whenever its own classes change. <html> is looked up every time because the Android app starts Renuxcord before
// the page has one
const FLAGS = ["app", "phone", "nav", "chat", "settings", "set-page"] as const;
type Flag = typeof FLAGS[number];
const flag = (name: Flag, on: boolean) => document.documentElement?.toggleAttribute(`data-rx-${name}`, on);
const hasFlag = (name: Flag) => document.documentElement?.hasAttribute(`data-rx-${name}`) ?? false;

/** Runs now if the page has its <html> element, otherwise as soon as it does */
function whenRoot(run: () => void) {
    if (document.documentElement) return void run();
    const watcher = new MutationObserver(() => {
        if (!document.documentElement) return;
        watcher.disconnect();
        run();
    });
    watcher.observe(document, { childList: true });
}

let mode: Mode = "nav";
let layoutStyle: HTMLStyleElement | null = null;
let suffix = "";
let layoutWatcher: MutationObserver | null = null;
let lastPath = "";
let lastTap = { at: 0, area: "" };
// Where the finger lifted after a long press: the click it makes there isn't a tap
let ghost = { x: 0, y: 0, until: 0 };
let press: { x: number; y: number; target: Element; timer: number; fired: boolean; } | null = null;
let swipe: { x: number; y: number; at: number; } | null = null;
let pushState: History["pushState"] | null = null;
let replaceState: History["replaceState"] | null = null;

const native = {
    get android(): any {
        return (window as any).RenuxcordNative;
    },
    get ios(): any {
        return (window as any).webkit?.messageHandlers?.renuxcord;
    },
    haptic() {
        if (typeof this.android?.haptic === "function") this.android.haptic();
        else if (this.ios) this.ios.postMessage({ type: "haptic" });
        else navigator.vibrate?.(10);
    },
    inCall(on: boolean) {
        if (typeof this.android?.setInCall === "function") this.android.setInCall(on);
        this.ios?.postMessage({ type: "call", on });
    }
};

const active = () => FULL_APP && PHONE.matches;

function setMode(next: Mode) {
    mode = next;
    flag("nav", next === "nav");
    flag("chat", next === "chat");
}

/* The layout: Discord's grid of server list, channel list and page, one pane at a time */

// The pane you're not looking at is parked off screen, not removed: that keeps the chat's scroll position (removing it
// would jump the chat to its oldest loaded message) and its layout, so switching back is instant
const PARKED = "position: fixed !important; inset: 0 !important; visibility: hidden !important; pointer-events: none !important;";

function layoutCss(s: string) {
    const c = (name: string) => `.${name}_${s}`;
    return `
html[data-rx-phone] ${c("sidebarResizeHandle")} { display: none !important; }
html[data-rx-phone][data-rx-nav] ${c("page")} { ${PARKED} transform: translateX(100%); }
html[data-rx-phone][data-rx-nav] ${c("base")} { grid-template-columns: [start] min-content [guildsEnd] minmax(0, 1fr) [channelsEnd] 0px [end] !important; }
html[data-rx-phone][data-rx-nav] ${c("sidebar")} { width: auto !important; max-width: none !important; flex: 1 1 auto !important; animation: rx-from-left .22s cubic-bezier(.2,.7,.2,1); }
html[data-rx-phone][data-rx-nav] ${c("sidebarList")} { width: auto !important; flex: 1 1 auto !important; }
html[data-rx-phone][data-rx-nav] ${c("panels")} { width: auto !important; inset-inline-end: var(--custom-panels-spacing, 8px) !important; }
html[data-rx-phone][data-rx-chat] ${c("sidebar")} { ${PARKED} transform: translateX(-100%); }
html[data-rx-phone][data-rx-chat] ${c("base")} { grid-template-columns: [start] 0px [guildsEnd] 0px [channelsEnd] minmax(0, 1fr) [end] !important; }
html[data-rx-phone][data-rx-chat] ${c("page")} { grid-column: start / end !important; animation: rx-from-right .22s cubic-bezier(.2,.7,.2,1); }
`;
}

function className(el: Element) {
    return typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "";
}

// Discord's class names carry a hash that changes between builds, so read it off the page
function findLayout() {
    const list = document.querySelector('[class*="sidebarList_"]');
    const match = list && /(?:^|\s)sidebarList_([\w-]+)/.exec(className(list));
    if (!match) return false;
    if (match[1] !== suffix) {
        suffix = match[1];
        if (layoutStyle) layoutStyle.textContent = layoutCss(CSS.escape(suffix));
        logger.info(`Phone layout on, Discord layout classes _${suffix}`);
    }
    return true;
}

function watchLayout() {
    if (findLayout()) return;
    layoutWatcher?.disconnect();
    let queued = false;
    layoutWatcher = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            if (findLayout()) {
                layoutWatcher?.disconnect();
                layoutWatcher = null;
            }
        });
    });
    layoutWatcher.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}

const inList = (el: Element) => Boolean(suffix && el.closest(`.sidebarList_${CSS.escape(suffix)}`));
const inRail = (el: Element) => Boolean(suffix && el.closest(`.guilds_${CSS.escape(suffix)}`));
const inPage = (el: Element) => Boolean(suffix && el.closest(`.page_${CSS.escape(suffix)}`));

/* Side panels (members, a DM's profile, threads, search) slide over the chat instead of squeezing it */

function closeSidePanels() {
    // Not in the middle of another dispatch
    setTimeout(() => {
        const state = ChannelSectionStore.getState?.();
        if (!state) return;
        if (state.isMembersOpen) FluxDispatcher.dispatch({ type: "CHANNEL_TOGGLE_MEMBERS_SECTION" });
        if (state.isProfileOpen) FluxDispatcher.dispatch({ type: "USER_PROFILE_SIDEBAR_TOGGLE_SECTION" });
    });
}

/* Where to be after Discord changes page */

function onRoute() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    if (!active()) return;

    const recent = Date.now() - lastTap.at < 1500;
    const channel = /^\/channels\/[^/]+\/\d+/.test(path);
    if (mode === "nav") {
        if (recent && lastTap.area === "list") setMode("chat");
        // Discovery, the shop and friends of theirs have no channel list, so go straight to them
        else if (recent && lastTap.area === "rail" && !path.startsWith("/channels/")) setMode("chat");
        // Opened from somewhere else: a notification, a link, the command palette
        else if (!recent && channel) setMode("chat");
    }
    if (mode === "chat") closeSidePanels();
}

function hookHistory() {
    pushState = history.pushState;
    replaceState = history.replaceState;
    const push = pushState;
    const replace = replaceState;
    history.pushState = function (...args: Parameters<History["pushState"]>) {
        const result = push.apply(this, args);
        onRoute();
        return result;
    };
    history.replaceState = function (...args: Parameters<History["replaceState"]>) {
        const result = replace.apply(this, args);
        onRoute();
        return result;
    };
    addEventListener("popstate", onRoute);
}

function unhookHistory() {
    if (pushState) history.pushState = pushState;
    if (replaceState) history.replaceState = replaceState;
    removeEventListener("popstate", onRoute);
}

/* Settings: the list of pages first, then the page you pick, like a phone's settings app */

function settingsOpen() {
    return document.querySelector('[class*="sidebarRegion_"]') != null;
}

function syncSettings() {
    const open = settingsOpen();
    flag("settings", open);
    if (!open) flag("set-page", false);
}

/* Taps, holds and swipes */

function onClick(e: MouseEvent) {
    if (Date.now() < ghost.until && Math.hypot(e.clientX - ghost.x, e.clientY - ghost.y) < 30) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ghost.until = 0;
        return;
    }
    if (!active() || !(e.target instanceof Element)) return;
    const { target } = e;

    if (inList(target)) {
        lastTap = { at: Date.now(), area: "list" };
        // Tapping the chat you're already in doesn't change the page, so open it directly
        const link = target.closest("a[href]") as HTMLAnchorElement | null;
        if (link && new URL(link.href, location.href).pathname === location.pathname) setTimeout(() => setMode("chat"), 60);
    } else if (inRail(target)) lastTap = { at: Date.now(), area: "rail" };

    // A tap beside an open side panel closes it
    if (mode === "chat" && inPage(target)) {
        const panel = document.querySelector(SIDE_PANELS);
        if (panel && !panel.contains(target)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeSidePanels();
        }
    }

    if (hasFlag("settings") && target.closest('[class*="sidebarRegion_"] [role="tab"], [class*="sidebarRegion_"] [role="button"]')) {
        flag("set-page", true);
    }
    requestAnimationFrame(syncSettings);
}

const editable = (el: Element) => el.closest("input, textarea, select, [contenteditable='true'], [role='slider']") != null;

function scrollsSideways(el: Element | null) {
    for (; el instanceof Element && el !== document.body; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
}

function clearPress() {
    if (press) clearTimeout(press.timer);
    press = null;
}

function firePress() {
    if (!press) return;
    press.fired = true;
    native.haptic();
    const { x, y, target } = press;
    // Discord opens the same menu it opens on right click: users, messages, channels, servers, links
    target.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 2,
        buttons: 2
    }));
}

function onTouchStart(e: TouchEvent) {
    clearPress();
    swipe = null;
    if (!FULL_APP || e.touches.length !== 1 || !(e.target instanceof Element)) return;
    const t = e.touches[0];
    if (!editable(e.target)) press = { x: t.clientX, y: t.clientY, target: e.target, fired: false, timer: window.setTimeout(firePress, LONG_PRESS_MS) };
    if (active() && !scrollsSideways(e.target) && !document.querySelector('[role="dialog"], [role="menu"]')) swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
}

function onTouchMove(e: TouchEvent) {
    if (!press || press.fired) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10) clearPress();
}

function onTouchEnd(e: TouchEvent) {
    const fired = press?.fired;
    if (fired && press) {
        e.preventDefault();
        ghost = { x: press.x, y: press.y, until: Date.now() + 450 };
    }
    clearPress();

    const start = swipe;
    swipe = null;
    if (fired || !start || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Date.now() - start.at > 650 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
    // Swipe right for the server and channel list, left back to the chat
    if (dx > 0 && mode === "chat") setMode("nav");
    else if (dx < 0 && mode === "nav") setMode("chat");
}

function onContextMenu(e: MouseEvent) {
    // Some phones fire their own after a long hold; ours already opened the menu
    if (e.isTrusted && (press || Date.now() < ghost.until + 600)) {
        e.preventDefault();
        e.stopImmediatePropagation();
    }
}

const onWidth = () => flag("phone", active());

/** What the app calls when the phone's back button is pressed. True when it handled it */
function back() {
    if (!active()) return false;
    if (hasFlag("set-page")) {
        flag("set-page", false);
        return true;
    }
    if (mode === "chat" && document.querySelector(SIDE_PANELS)) {
        closeSidePanels();
        return true;
    }
    if (mode === "chat") {
        setMode("nav");
        return true;
    }
    return false;
}

export default definePlugin({
    name: "PhoneMode",
    description: "Runs Discord's full app in the Renuxcord phone apps in a phone layout: hold anything for its menu, swipe or use back between the server list and the chat, and stay in calls",
    authors: [RenuxDevs.Larpbase],
    required: true,
    hidden: true,
    // As soon as Renuxcord runs, not after Discord connects: the layout is in place from the first frame, and the login
    // page gets hold-to-open menus too. The Android app can inject Renuxcord after the page's DOMContentLoaded has
    // already fired, so start() waits for the page itself instead of that stage
    startAt: StartAt.Init,

    patches: [
        {
            // The ☰ button that opens the server and channel list, which Discord only shows on its phone site
            find: ".HEADER_BAR_BADGE_TOP:",
            predicate: () => FULL_APP,
            replacement: {
                match: /(\i\.\i)(&&null!=(\i)\?\(0,\i\.jsx\)\(\i\.\i,\{onClick:\3,)/,
                replace: "($1||$self.showMenuButton())$2"
            }
        }
    ],

    showMenuButton: active,

    flux: {
        MOBILE_WEB_SIDEBAR_OPEN() {
            if (active()) setMode("nav");
        },
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (IN_APP) native.inCall(channelId != null);
        },
        CONNECTION_OPEN() {
            if (FULL_APP) watchLayout();
        }
    },

    start() {
        if (!FULL_APP) return;
        whenRoot(() => {
            flag("app", true);
            setMode(mode);
            onWidth();
        });
        PHONE.addEventListener("change", onWidth);
        lastPath = location.pathname;
        hookHistory();

        document.addEventListener("click", onClick, true);
        document.addEventListener("contextmenu", onContextMenu, true);
        document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
        document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
        document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
        document.addEventListener("touchcancel", clearPress, { capture: true, passive: true });

        (window as any).RenuxcordPhone = { get active() { return active(); }, back, setMode };

        // The styles and the layout watcher need the page's head and body
        const setUp = () => {
            enableStyle(style);
            layoutStyle = document.createElement("style");
            layoutStyle.id = "renuxcord-phone-layout";
            if (suffix) layoutStyle.textContent = layoutCss(CSS.escape(suffix));
            document.head.append(layoutStyle);
            watchLayout();
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setUp, { once: true });
        else setUp();
    },

    stop() {
        if (!FULL_APP) return;
        disableStyle(style);
        layoutStyle?.remove();
        layoutStyle = null;
        layoutWatcher?.disconnect();
        PHONE.removeEventListener("change", onWidth);
        unhookHistory();
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("contextmenu", onContextMenu, true);
        document.removeEventListener("touchstart", onTouchStart, true);
        document.removeEventListener("touchmove", onTouchMove, true);
        document.removeEventListener("touchend", onTouchEnd, true);
        document.removeEventListener("touchcancel", clearPress, true);
        for (const name of FLAGS) flag(name, false);
        delete (window as any).RenuxcordPhone;
    }
});
