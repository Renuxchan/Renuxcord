// Renuxcord for iOS
// Copyright (c) 2026 Larpbase
// SPDX-License-Identifier: GPL-3.0-or-later

import Foundation

/// Renuxcord's web build (browser.js and browser.css), downloaded from the devbuild release and kept in
/// Application Support so the app works offline and only downloads again when there's a new build
final class BundleStore {
    static let shared = BundleStore()
    static let releaseAPI = URL(string: "https://api.github.com/repos/Renuxchan/Renuxcord/releases/tags/devbuild")!

    struct Release {
        let hash: String
        let title: String
        let assets: [String: URL]
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    let dir: URL
    private let defaults = UserDefaults.standard

    private init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = base.appendingPathComponent("renuxcord", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    var installedHash: String? {
        get { defaults.string(forKey: "installedHash") }
        set { defaults.set(newValue, forKey: "installedHash") }
    }

    var autoUpdate: Bool {
        get { defaults.object(forKey: "autoUpdate") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "autoUpdate") }
    }

    /// Discord's full app (calls, discovery, menus) in Renuxcord's phone layout. Off shows Discord's own phone site
    var desktopLayout: Bool {
        get { !defaults.bool(forKey: "phoneSite") }
        set { defaults.set(!newValue, forKey: "phoneSite") }
    }

    var js: String? { try? String(contentsOf: dir.appendingPathComponent("browser.js"), encoding: .utf8) }
    var css: String { (try? String(contentsOf: dir.appendingPathComponent("browser.css"), encoding: .utf8)) ?? "" }
    var isInstalled: Bool { !(js ?? "").isEmpty }

    private func request(_ url: URL) -> URLRequest {
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.setValue("RenuxcordiOS", forHTTPHeaderField: "User-Agent")
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        return req
    }

    private func download(_ url: URL) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request(url))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Failure("Download failed (HTTP \(status)): \(url.lastPathComponent)") }
        return data
    }

    func latestRelease() async throws -> Release {
        let json = try JSONSerialization.jsonObject(with: try await download(Self.releaseAPI)) as? [String: Any] ?? [:]
        let title = (json["name"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        // "DevBuild 9ab307d3": the commit is the version
        let hash = title.split(separator: " ").last.map(String.init) ?? (json["published_at"] as? String ?? "")
        var assets: [String: URL] = [:]
        for asset in json["assets"] as? [[String: Any]] ?? [] {
            if let name = asset["name"] as? String, let url = (asset["browser_download_url"] as? String).flatMap(URL.init(string:)) {
                assets[name] = url
            }
        }
        return Release(hash: hash, title: title.isEmpty ? hash : title, assets: assets)
    }

    func install(_ release: Release) async throws {
        guard let jsURL = release.assets["browser.js"] else { throw Failure("\(release.title) has no browser.js") }
        let js = try await download(jsURL)
        var css = Data()
        if let cssURL = release.assets["browser.css"] { css = try await download(cssURL) }
        try js.write(to: dir.appendingPathComponent("browser.js"), options: .atomic)
        try css.write(to: dir.appendingPathComponent("browser.css"), options: .atomic)
        installedHash = release.hash
    }

    /// Installs the newest build if it isn't the installed one. Returns the release when it installed something
    @discardableResult
    func update() async throws -> Release? {
        let release = try await latestRelease()
        if isInstalled && release.hash == installedHash { return nil }
        try await install(release)
        return release
    }
}
