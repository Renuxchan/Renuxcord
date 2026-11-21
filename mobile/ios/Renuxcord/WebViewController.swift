// Renuxcord for iOS
// Copyright (c) 2026 Larpbase
// SPDX-License-Identifier: GPL-3.0-or-later

import UIKit
import WebKit

/// Discord's web app with Renuxcord injected before any of Discord's own code runs
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate, UIScrollViewDelegate {
    private static let home = URL(string: "https://discord.com/channels/@me")!
    // Looks like Safari, so Discord treats it as a normal phone browser
    private static let safariName = "Version/18.0 Mobile/15E148 Safari/604.1"
    private static let desktopAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    // Discord's dark background, so the strip under the status bar matches it
    private static let background = UIColor(red: 0.1, green: 0.1, blue: 0.118, alpha: 1)
    private static let accent = UIColor(red: 1, green: 90 / 255, blue: 44 / 255, alpha: 1)

    private let store = BundleStore.shared
    private var webView: WKWebView?
    private let spinner = UIActivityIndicatorView(style: .large)
    private let message = UILabel()
    private let retryButton = UIButton(type: .system)
    private var downloads: [WKDownload: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.background

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.color = Self.accent
        message.translatesAutoresizingMaskIntoConstraints = false
        message.numberOfLines = 0
        message.textAlignment = .center
        message.textColor = .secondaryLabel
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.setTitle("Try again", for: .normal)
        retryButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        retryButton.tintColor = Self.accent
        retryButton.addTarget(self, action: #selector(retry), for: .touchUpInside)
        retryButton.isHidden = true

        view.addSubview(spinner)
        view.addSubview(message)
        view.addSubview(retryButton)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            message.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 16),
            message.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            message.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            retryButton.topAnchor.constraint(equalTo: message.bottomAnchor, constant: 12),
            retryButton.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])

        Task { await start() }
    }

    @objc private func retry() {
        Task { await start() }
    }

    private func start() async {
        retryButton.isHidden = true
        message.text = nil
        spinner.startAnimating()

        var justInstalled = false
        if !store.isInstalled {
            message.text = "Downloading Renuxcord…"
            do {
                try await store.update()
                justInstalled = true
            } catch {
                showProblem("Couldn't download Renuxcord. Check your internet connection, then try again.")
                return
            }
        }

        message.text = nil
        showDiscord()

        // Discord opens right away; a newer Renuxcord downloads meanwhile and loads the next time the app opens
        if !justInstalled && store.autoUpdate {
            Task {
                if let release = try? await self.store.update() { self.log("Downloaded \(release.title) for next time") }
            }
        }
    }

    private func showProblem(_ text: String) {
        spinner.stopAnimating()
        webView?.isHidden = true
        message.text = text
        retryButton.isHidden = false
    }

    private func showDiscord() {
        webView?.removeFromSuperview()

        let content = WKUserContentController()
        content.add(WeakHandler(self), name: "renuxcord")
        content.addUserScript(WKUserScript(source: store.js ?? "", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Self.mobileScript(css: store.css), injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = Self.safariName

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        // Feels like an app, not a web page: no rubber-banding, no link preview pop-ups
        web.allowsLinkPreview = false
        web.scrollView.bounces = false
        web.scrollView.delegate = self
        if store.desktopLayout { web.customUserAgent = Self.desktopAgent }
        if #available(iOS 16.4, *) { web.isInspectable = true }

        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            // Shrinks above the keyboard, so the message box is never hidden behind it
            web.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        webView = web
        web.load(URLRequest(url: Self.home))
    }

    /// Adds Renuxcord's CSS and the phone tweaks, a "Renuxcord app" page in Discord's settings, and tells the app
    /// Renuxcord loaded
    private static func mobileScript(css: String) -> String {
        let cssLiteral = String(data: (try? JSONSerialization.data(withJSONObject: [css])) ?? Data("[\"\"]".utf8), encoding: .utf8) ?? "[\"\"]"
        return """
        (() => {
            const post = msg => window.webkit?.messageHandlers?.renuxcord?.postMessage(msg);
            const css = \(cssLiteral)[0];
            // No grey tap flashes, no rubber-banding, no double-tap zoom
            const polish = `
                html, body { overscroll-behavior: none; }
                html { touch-action: manipulation; -webkit-text-size-adjust: 100%; }
                * { -webkit-tap-highlight-color: transparent; }
                [class*="scroller"] { overscroll-behavior: contain; }
            `;
            // iOS zooms into any text box smaller than 16px when you tap it; this keeps the page at its size
            const VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
            const fixViewport = () => {
                let meta = document.querySelector('meta[name="viewport"]');
                if (!meta && document.head) {
                    meta = document.createElement("meta");
                    meta.name = "viewport";
                    document.head.appendChild(meta);
                }
                if (meta && meta.content !== VIEWPORT) meta.content = VIEWPORT;
                return meta?.content;
            };
            const setUp = () => {
                for (const text of [polish, css]) {
                    document.documentElement.appendChild(Object.assign(document.createElement("style"), { textContent: text }));
                }
                post({ type: "viewport", content: fixViewport() ?? "" });
                new MutationObserver(fixViewport).observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
            };
            if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setUp, { once: true });
            else setUp();

            const R = window.Vencord;
            if (!R) return post({ type: "missing" });

            const { Webpack: { Common, onceReady }, Components: { Button, Flex, WebsiteIcon }, Plugins: { plugins: { Settings } } } = R;
            function AppSettings() {
                const { React } = Common;
                return React.createElement(Flex, { flexDirection: "column" },
                    React.createElement(Button, { onClick: () => post({ type: "update" }) }, "Check for Renuxcord updates"),
                    React.createElement(Button, { onClick: () => post({ type: "layout" }) }, "Switch between phone and desktop layout"));
            }
            Settings.customEntries.push({ key: "renuxcord_app", title: "Renuxcord app", Icon: WebsiteIcon, Component: AppSettings });

            // Swipe right for the server and channel list, left to close it, like Discord's own app
            let sidebarOpen = false;
            onceReady.then(() => {
                Common.FluxDispatcher.subscribe("MOBILE_WEB_SIDEBAR_OPEN", () => { sidebarOpen = true; });
                Common.FluxDispatcher.subscribe("MOBILE_WEB_SIDEBAR_CLOSE", () => { sidebarOpen = false; });
            });
            const scrollsSideways = el => {
                for (; el instanceof Element && el !== document.body; el = el.parentElement) {
                    if (el.scrollWidth > el.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
                }
                return false;
            };
            let swipe = null;
            document.addEventListener("touchstart", e => {
                swipe = null;
                if (e.touches.length !== 1 || scrollsSideways(e.target) || document.querySelector("[role=dialog]")) return;
                swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
            }, { passive: true, capture: true });
            document.addEventListener("touchend", e => {
                const start = swipe;
                swipe = null;
                if (!start || e.changedTouches.length !== 1) return;
                const dx = e.changedTouches[0].clientX - start.x;
                const dy = e.changedTouches[0].clientY - start.y;
                if (Date.now() - start.time > 700 || Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2) return;
                const open = dx > 0;
                if (open === sidebarOpen) return;
                const before = sidebarOpen;
                // If Discord moved the sidebar itself, leave it be
                setTimeout(() => {
                    if (sidebarOpen !== before) return;
                    Common.FluxDispatcher.dispatch({ type: open ? "MOBILE_WEB_SIDEBAR_OPEN" : "MOBILE_WEB_SIDEBAR_CLOSE" });
                }, 60);
            }, { passive: true, capture: true });

            post({ type: "loaded" });
        })();
        """
    }

    // MARK: - Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let body = msg.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "loaded":
            log("Renuxcord loaded in the page")
        case "missing":
            log("Renuxcord didn't load in the page")
        case "viewport":
            log("Viewport: \(body["content"] as? String ?? "")")
        case "update":
            Task { await checkForUpdates() }
        case "layout":
            store.desktopLayout.toggle()
            webView?.customUserAgent = store.desktopLayout ? Self.desktopAgent : nil
            webView?.reload()
        default:
            break
        }
    }

    private func checkForUpdates() async {
        do {
            if let release = try await store.update() {
                alert("Updated to \(release.title)", "Renuxcord reloads now.") { self.showDiscord() }
            } else {
                alert("Renuxcord is up to date", store.installedHash.map { "Build \($0)" })
            }
        } catch {
            alert("Couldn't check for updates", error.localizedDescription)
        }
    }

    private func log(_ text: String) {
        // CI reads this from the simulator
        print("[Renuxcord] \(text)")
        NSLog("[Renuxcord] %@", text)
    }

    private func alert(_ title: String, _ text: String?, then: (() -> Void)? = nil) {
        let a = UIAlertController(title: title, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in then?() })
        present(a, animated: true)
    }

    // MARK: - Navigation

    private static func isDiscord(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return ["discord.com", "discordapp.com"].contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    /// A file someone sent in a chat
    private static func isAttachment(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
        return (host == "cdn.discordapp.com" || host == "media.discordapp.net") && url.path.hasPrefix("/attachments/")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        // Saved files and chat attachments go to the share sheet (Save to Files, Save Image) instead of replacing Discord
        let mainFrame = action.targetFrame?.isMainFrame != false
        if mainFrame && (Self.isAttachment(url) || ["blob", "data"].contains(url.scheme ?? "")) && action.targetFrame == nil {
            // Opening in a new window: there's no frame to turn into a download, so start one
            webView.startDownload(using: action.request) { $0.delegate = self }
            return decisionHandler(.cancel)
        }
        if action.shouldPerformDownload || (mainFrame && (Self.isAttachment(url) || ["blob", "data"].contains(url.scheme ?? ""))) {
            return decisionHandler(.download)
        }
        // Frames (captchas, embeds) and Discord itself stay in the app, other links open in Safari
        if action.targetFrame?.isMainFrame == false || Self.isDiscord(url) || ["about", "blob", "data"].contains(url.scheme ?? "") {
            return decisionHandler(.allow)
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.isForMainFrame && !response.canShowMIMEType ? .download : .allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if Self.isDiscord(url) {
                webView.load(action.request)
            } else if Self.isAttachment(url) {
                webView.startDownload(using: action.request) { $0.delegate = self }
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    private func loadFailed(_ error: Error) {
        let ns = error as NSError
        // A navigation that turned into a download or was replaced by another one isn't a failure
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && (ns.code == 102 || ns.code == 204) { return }
        log("Discord failed to load: \(ns.domain) \(ns.code)")
        showProblem("Can't reach Discord. Check your internet connection, then try again.")
    }

    // iOS ends the page's process when memory runs low (often in the background): load Discord again instead of
    // coming back to a blank screen
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log("The page's process ended, reloading")
        webView.reload()
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: - Downloads

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            return completionHandler(nil)
        }
        let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
        let file = folder.appendingPathComponent(name)
        downloads[download] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: download) else { return }
        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        share.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        }
        if let popover = share.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        (presentedViewController ?? self).present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = downloads.removeValue(forKey: download) {
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        }
        alert("Couldn't save that file", error.localizedDescription)
    }

    // MARK: - Page scrolling

    // Discord's own panes scroll; the page itself never should, but iOS shifts it up when the keyboard opens
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.contentOffset != .zero && scrollView.contentSize.height <= scrollView.bounds.height + 1
            && scrollView.contentSize.width <= scrollView.bounds.width + 1 {
            scrollView.contentOffset = .zero
        }
    }

    // MARK: - Calls and dialogs

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        // iOS still asks you once for the microphone and camera itself
        decisionHandler(origin.host.hasSuffix("discord.com") ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
}

/// WKUserContentController keeps its handlers alive, so this breaks the cycle back to the controller
@MainActor
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
