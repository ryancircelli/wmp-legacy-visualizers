// The iOS host (CONTRACT.md v6.1): Spotify's own web player in one WKWebView, with our page
// mounted over it by observer.js. The page's bundle is fetched at every launch; the last good copy
// is kept in Caches for launches without a network.
import AVFoundation
import SwiftUI
import WebKit

@main
struct WmpSpotifyApp: App {
    init() {
        // .playback: the music keeps going with the screen locked, in the background
        // (UIBackgroundModes audio) and with the mute switch on.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    var body: some Scene {
        WindowGroup { Player() }
    }
}

struct Player: View {
    @State private var script: String?
    @State private var ready = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            // The web view keeps to the safe area (black bars at the notch). The keyboard is left
            // to WebKit, which scrolls the focused field into view itself.
            if ready { WebView(script: script).ignoresSafeArea(.keyboard) }
        }
        .task {
            script = await userScript()
            ready = true
        }
    }
}

// dist/spotify-inject.js as the site publishes it (tools/postbuild.js).
struct Inject: Decodable { let html, css, js: String }

// observer.js wrapped as its header says, or nil when no bundle was ever fetched: the web player
// then shows bare, without the overlay.
func userScript() async -> String? {
    let cache = URL.cachesDirectory.appending(path: "spotify-inject.js")
    let request = URLRequest(url: URL(string: "https://wmp.ryancircelli.com/spotify-inject.js")!,
                             cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
    func decode(_ data: Data) -> Inject? { try? JSONDecoder().decode(Inject.self, from: data) }
    var found: Inject?
    // Only a 200 that decodes replaces the cached copy: a captive portal answers 200 too.
    if case let (data, response)? = try? await URLSession.shared.data(for: request),
       (response as? HTTPURLResponse)?.statusCode == 200, let fresh = decode(data) {
        found = fresh
        try? data.write(to: cache)
    } else if let data = try? Data(contentsOf: cache) {
        found = decode(data)
    }
    guard let inject = found,
          let url = Bundle.main.url(forResource: "observer", withExtension: "js"),
          let observer = try? String(contentsOf: url, encoding: .utf8),
          let html = try? JSONEncoder().encode(inject.html),
          let css = try? JSONEncoder().encode(inject.css) else { return nil }
    return """
        (function (HTML, CSS, RUN) {
        \(observer)
        })(\(String(decoding: html, as: UTF8.self)), \(String(decoding: css, as: UTF8.self)), function () { "use strict";
        \(inject.js)
        });
        """
}

struct WebView: UIViewRepresentable {
    let script: String?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop
        config.userContentController.add(context.coordinator, name: "log")
        if let script {
            config.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let web = WKWebView(frame: .zero, configuration: config)
        // Spotify serves the web player to desktop browsers only; the overlay covers the desktop
        // layout anyway.
        web.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        // The overlay is position:fixed and its panes scroll themselves.
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.load(URLRequest(url: URL(string: "https://open.spotify.com/")!))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    // window.alchemyLog from the page (observer.js posts to webkit.messageHandlers.log).
    final class Coordinator: NSObject, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            print("page: \(message.body)")
        }
    }
}
