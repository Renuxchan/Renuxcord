// Renuxcord for iOS
// Copyright (c) 2026 Larpbase
// SPDX-License-Identifier: GPL-3.0-or-later

import UIKit
import WebKit

/// Discord's web app with Renuxcord injected before any of Discord's own code runs
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private static let home = URL(string: "https://discord.com/channels/@me")!
    // Looks like Safari, so Discord treats it as a normal phone browser
    private static let safariName = "Version/18.0 Mobile/15E148 Safari/604.1"
    private static let desktopAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

    private let store = BundleStore.shared
    private var webView: WKWebView?
    private let spinner = UIActivityIndicatorView(style: .large)
    private let message = UILabel()
    private let retryButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.1, green: 0.1, blue: 0.118, alpha: 1) : .white }

        spinner.translatesAutoresizingMaskIntoConstraints = false
        message.translatesAutoresizingMaskIntoConstraints = false
        message.numberOfLines = 0
        message.textAlignment = .center
        message.textColor = .secondaryLabel
        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.setTitle("Try again", for: .normal)
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
        spinner.startAnimating()

        if !store.isInstalled {
            message.text = "Downloading Renuxcord…"
            do {
                try await store.update()
            } catch {
                spinner.stopAnimating()
                message.text = "Couldn't download Renuxcord. Check your connection.\n\(error.localizedDescription)"
                retryButton.isHidden = false
                return
            }
        } else if store.autoUpdate {
            // A newer build loads right away when it's quick to get, otherwise next time
            _ = try? await store.update()
        }

        message.text = nil
        showDiscord()
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
        if store.desktopLayout { web.customUserAgent = Self.desktopAgent }
        if #available(iOS 16.4, *) { web.isInspectable = true }

        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        webView = web
        web.load(URLRequest(url: Self.home))
    }

    /// Adds Renuxcord's CSS, a "Renuxcord app" page in Discord's settings, and tells the app Renuxcord loaded
    private static func mobileScript(css: String) -> String {
        let cssLiteral = String(data: (try? JSONSerialization.data(withJSONObject: [css])) ?? Data("[\"\"]".utf8), encoding: .utf8) ?? "[\"\"]"
        return """
        (() => {
            const post = msg => window.webkit?.messageHandlers?.renuxcord?.postMessage(msg);
            const css = \(cssLiteral)[0];
            const addCss = () => document.documentElement.appendChild(Object.assign(document.createElement("style"), { textContent: css }));
            if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addCss, { once: true });
            else addCss();

            const R = window.Vencord;
            if (!R) return post({ type: "missing" });

            const { Webpack: { Common }, Components: { Button, Flex, WebsiteIcon }, Plugins: { plugins: { Settings } } } = R;
            function AppSettings() {
                const { React } = Common;
                return React.createElement(Flex, { flexDirection: "column" },
                    React.createElement(Button, { onClick: () => post({ type: "update" }) }, "Check for Renuxcord updates"),
                    React.createElement(Button, { onClick: () => post({ type: "layout" }) }, "Switch between phone and desktop layout"));
            }
            Settings.customEntries.push({ key: "renuxcord_app", title: "Renuxcord app", Icon: WebsiteIcon, Component: AppSettings });
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

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        // Frames (captchas, embeds) and Discord itself stay in the app, other links open in Safari
        if action.targetFrame?.isMainFrame == false || Self.isDiscord(url) || ["about", "blob", "data"].contains(url.scheme ?? "") {
            return decisionHandler(.allow)
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if Self.isDiscord(url) { webView.load(action.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
    }

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
