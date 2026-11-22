/*
 * Renuxcord, a Vencord-based Discord client mod
 * Copyright (c) 2026 Larpbase
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Based on Vendroid's page script (https://github.com/Vencord/Vendroid), by Vendicated and contributors

!(() => {
    // ---- Discord's message notifications, as real Android notifications ----
    const notifications = new Map();
    const tagIds = new Map();
    const permissionWaiters = [];
    let nextNotificationId = 1;

    class RenuxcordNotification extends EventTarget {
        static get permission() {
            return RenuxcordNative.notificationPermission();
        }

        static requestPermission(callback) {
            return new Promise(resolve => {
                permissionWaiters.push(permission => {
                    try {
                        callback?.(permission);
                    } finally {
                        resolve(permission);
                    }
                });
                RenuxcordNative.requestNotificationPermission();
            });
        }

        constructor(title, options = {}) {
            super();
            this.title = String(title ?? "");
            this.body = String(options.body ?? "");
            this.tag = String(options.tag ?? "");
            this.icon = String(options.icon ?? "");
            this.data = options.data ?? null;
            this.silent = !!options.silent;
            this.onclick = this.onshow = this.onclose = this.onerror = null;

            // A notification with the same tag replaces the last one, like in browsers
            this.id = (this.tag && tagIds.get(this.tag)) || nextNotificationId++;
            if (this.tag) tagIds.set(this.tag, this.id);
            notifications.set(this.id, this);

            if (RenuxcordNotification.permission !== "granted") {
                setTimeout(() => this._fire("error"));
                return;
            }
            RenuxcordNative.showNotification(this.id, this.title, this.body, this.icon);
            setTimeout(() => this._fire("show"));
        }

        close() {
            if (notifications.get(this.id) !== this) return;
            RenuxcordNative.closeNotification(this.id);
            this._forget();
            this._fire("close");
        }

        _forget() {
            notifications.delete(this.id);
            if (this.tag && tagIds.get(this.tag) === this.id) tagIds.delete(this.tag);
        }

        _fire(type) {
            const event = new Event(type, { cancelable: true });
            try {
                this["on" + type]?.call(this, event);
            } catch (err) {
                console.error("[RenuxcordMobile] Notification handler failed", err);
            }
            this.dispatchEvent(event);
        }
    }
    Object.defineProperty(window, "Notification", { value: RenuxcordNotification, configurable: true, writable: true });

    // What the app calls into. onBackPress gets its real version once Renuxcord is up
    window.RenuxcordMobile = {
        onBackPress: () => false,

        // The app tells the page what Android said about notifications
        notificationPermissionChanged(permission) {
            for (const resolve of permissionWaiters.splice(0)) resolve(permission);
        },

        // Someone tapped one of our notifications: Discord opens the chat it came from
        notificationClicked(id) {
            const notification = notifications.get(id);
            if (!notification) return;
            notification._forget();
            window.focus();
            notification._fire("click");
        }
    };

    // ---- files the page saves itself (blob: and data: links), which Android's download manager can't fetch ----
    const MAX_SAVE = 50 * 1024 * 1024;

    function saveFromPage(href, name) {
        // Started right away: Renuxcord's exporters let go of the link as soon as the click returns
        const response = fetch(href);
        void (async () => {
            try {
                const blob = await (await response).blob();
                if (blob.size > MAX_SAVE) throw new Error("Too big to save from the page");
                const data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const url = String(reader.result);
                        resolve(url.slice(url.indexOf(",") + 1));
                    };
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
                RenuxcordNative.saveFile(name || "download", blob.type || "application/octet-stream", data);
            } catch (err) {
                console.error("[RenuxcordMobile] Couldn't save the file", err);
                RenuxcordNative.toast("Couldn’t save that file");
            }
        })();
    }

    const isPageFile = a => a instanceof HTMLAnchorElement && a.hasAttribute("download") && /^(blob|data):/i.test(a.href);
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (isPageFile(this)) return saveFromPage(this.href, this.download);
        return anchorClick.call(this);
    };
    document.addEventListener("click", e => {
        const a = e.target instanceof Element ? e.target.closest("a") : null;
        if (!isPageFile(a)) return;
        e.preventDefault();
        saveFromPage(a.href, a.download);
    }, true);

    // ---- feels like an app: no grey tap flashes, no rubber-banding, no double-tap zoom ----
    const POLISH_CSS = `
        html, body { overscroll-behavior: none; }
        html { touch-action: manipulation; -webkit-text-size-adjust: 100%; }
        * { -webkit-tap-highlight-color: transparent; }
        [class*="scroller"] { overscroll-behavior: contain; }
    `;

    document.addEventListener("DOMContentLoaded", () => {
        for (const css of [POLISH_CSS, RenuxcordNative.getRenuxcordCss()]) {
            document.documentElement.appendChild(Object.assign(document.createElement("style"), { textContent: css }));
        }
    }, { once: true });

    // ---- Renuxcord itself ----
    if (typeof Vencord === "undefined") {
        console.error("[RenuxcordMobile] Renuxcord didn't load");
        return;
    }

    const {
        Webpack: {
            findLazy,
            onceReady,
            Common
        },
        Components: { Button, Flex, WebsiteIcon },
        Plugins: {
            plugins: { Settings: SettingsPlugin }
        }
    } = Vencord;

    const ModalEscapeHandler = findLazy(m => m.binds?.length === 1 && m.binds[0] === "esc");

    let isSidebarOpen = false;

    function AppSettings() {
        const { React } = Common;

        return React.createElement(
            Flex,
            { flexDirection: "column" },
            React.createElement(
                Button,
                { onClick: () => RenuxcordNative.openAppSettings() },
                "App settings"
            ),
            React.createElement(
                Button,
                { onClick: () => RenuxcordNative.openBundleUpdater() },
                "Open Updater"
            )
        );
    }
    SettingsPlugin.customEntries.push({
        key: "app_settings",
        title: "Renuxcord app",
        Icon: WebsiteIcon,
        Component: AppSettings,
    });

    onceReady.then(() => {
        const { FluxDispatcher } = Common;

        FluxDispatcher.subscribe("MOBILE_WEB_SIDEBAR_OPEN", () => {
            isSidebarOpen = true;
        });
        FluxDispatcher.subscribe("MOBILE_WEB_SIDEBAR_CLOSE", () => {
            isSidebarOpen = false;
        });

        // Tells the app once Discord has drawn something, so it swaps its loading screen for the page then and not
        // while the page is still blank
        const started = Date.now();
        const drawn = () => {
            const mount = document.getElementById("app-mount");
            if ((mount && mount.childElementCount > 0) || Date.now() - started > 8000) RenuxcordNative.discordDrawn();
            else setTimeout(drawn, 100);
        };
        drawn();
    });

    // ---- swipe right for the server and channel list, left to close it, like Discord's own app ----
    function scrollsSideways(el) {
        for (; el instanceof Element && el !== document.body; el = el.parentElement) {
            if (el.scrollWidth > el.clientWidth + 4) {
                const overflow = getComputedStyle(el).overflowX;
                if (overflow === "auto" || overflow === "scroll") return true;
            }
        }
        return false;
    }

    // In Discord's full app the PhoneMode plugin handles swipes and back; these are for Discord's own phone site
    const phoneLayout = () => Boolean(window.RenuxcordPhone?.active);

    let swipe = null;
    document.addEventListener("touchstart", e => {
        swipe = null;
        if (phoneLayout() || e.touches.length !== 1 || scrollsSideways(e.target) || document.querySelector("[role=dialog]")) return;
        const t = e.touches[0];
        swipe = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true, capture: true });

    document.addEventListener("touchend", e => {
        const start = swipe;
        swipe = null;
        if (!start || e.changedTouches.length !== 1) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Date.now() - start.time > 700 || Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2) return;

        const open = dx > 0;
        if (open === isSidebarOpen) return;
        const before = isSidebarOpen;
        // If Discord moved the sidebar itself, leave it be
        setTimeout(() => {
            if (isSidebarOpen !== before) return;
            Common.FluxDispatcher.dispatch({ type: open ? "MOBILE_WEB_SIDEBAR_OPEN" : "MOBILE_WEB_SIDEBAR_CLOSE" });
        }, 60);
    }, { passive: true, capture: true });

    // returns true if an action was taken, false if the java side should handle the back press
    window.RenuxcordMobile.onBackPress = () => {
        // false means modal closed (no further action required)
        if (ModalEscapeHandler.action() === false) return true;

        // try to close quick css window if open
        const quickCssWin = window.__VENCORD_MONACO_WIN__?.deref();
        if (quickCssWin && !quickCssWin.closed) {
            quickCssWin.close();
            delete window.__VENCORD_MONACO_WIN__;
            return true;
        }

        if (phoneLayout()) return window.RenuxcordPhone.back();

        if (!isSidebarOpen) {
            Common.FluxDispatcher.dispatch({ type: "MOBILE_WEB_SIDEBAR_OPEN" });
            return true;
        }

        return false;
    };

    // CI looks for this line to know Renuxcord made it into the page
    console.info("[RenuxcordMobile] Renuxcord loaded");
})();
