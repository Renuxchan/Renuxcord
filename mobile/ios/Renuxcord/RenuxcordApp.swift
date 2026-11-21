// Renuxcord for iOS
// Copyright (c) 2026 Larpbase
// SPDX-License-Identifier: GPL-3.0-or-later

import SwiftUI

@main
struct RenuxcordApp: App {
    var body: some Scene {
        WindowGroup {
            // Discord is dark by default, so the status bar area matches it instead of showing a white strip
            DiscordView().ignoresSafeArea().preferredColorScheme(.dark)
        }
    }
}

/// The web view lives in a UIKit controller: WKWebView's delegates are UIKit-shaped
struct DiscordView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}
