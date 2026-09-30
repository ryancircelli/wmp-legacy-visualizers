// The iOS host (CONTRACT.md v6.1): Spotify's own web player in one WKWebView, with our page
// mounted over it by observer.js. The page's bundle is fetched at every launch; the last good copy
// is kept in Caches for launches without a network.
import AVFoundation
import SwiftUI
import WebKit

@main
struct WmpSpotifyApp: App {
    init() {
        // .playAndRecord, since the page takes the microphone for the visualizers (ios/README.md:
        // nothing else on iOS hears the web view): WebKit would switch a .playback session to it
        // anyway, and on its own that routes sound to the earpiece. The music keeps going with the
        // screen locked (UIBackgroundModes audio) and with the mute switch on, as under .playback.
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetoothA2DP, .allowAirPlay])
        try? AVAudioSession.sharedInstance().setActive(true)
        HostLog.shared.log("host: build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")")
    }

    var body: some Scene {
        WindowGroup { Player() }
    }
}

// The one web view: a tap on the log row reloads it.
final class WebHolder {
    static let shared = WebHolder()
    weak var web: WKWebView?
}

// The host's log. print reaches nobody on a TestFlight install, so Player shows the last line under
// the web view and the last 20 on a long press.
final class HostLog: ObservableObject {
    static let shared = HostLog()
    @Published var last = ""
    var lines: [String] = []

    /// From any thread; the published state changes on the main thread. A quiet line goes to the
    /// long-press list only, never the band.
    func log(_ line: String, quiet: Bool = false) {
        print(line)
        DispatchQueue.main.async {
            self.lines.append(line)
            if self.lines.count > 20 { self.lines.removeFirst() }
            if !quiet { self.last = line }
        }
    }
}

struct Player: View {
    @State private var script: String?
    @State private var ready = false
    @State private var showLog = false
    @ObservedObject private var log = HostLog.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            // The web view keeps to the safe area (black bars at the notch), the host's last log
            // line under it. The keyboard is left to WebKit, which scrolls the focused field into
            // view itself.
            VStack(spacing: 0) {
                if ready { WebView(script: script) } else { Color.clear }
                Text(log.last)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.gray)
                    .lineLimit(1)
                    .truncationMode(.head)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                    .onTapGesture { reload() }
                    .onLongPressGesture { showLog = true }
            }
            .ignoresSafeArea(.keyboard)
        }
        .sheet(isPresented: $showLog) {
            ScrollView {
                Text(log.lines.joined(separator: "\n"))
                    .font(.system(size: 10, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            HostLog.shared.log("scene: \(phase)", quiet: true)
        }
        .task {
            script = await userScript()
            ready = true
        }
    }

    // The page again from the top: its overlay, its socket-less audio, Spotify's own state.
    private func reload() {
        HostLog.shared.log("reload: the page")
        WebHolder.shared.web?.reload()
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
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        // The overlay is position:fixed and its panes scroll themselves.
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.load(URLRequest(url: URL(string: "https://open.spotify.com/")!))
        WebHolder.shared.web = web
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    // window.alchemyLog from the page (observer.js posts to webkit.messageHandlers.log).
    final class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate {
        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            HostLog.shared.log("page: \(message.body)")
        }

        // The microphone, granted once by iOS (NSMicrophoneUsageDescription): without this WebKit
        // asks its own "open.spotify.com would like to use your microphone" at every launch.
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(type == .microphone ? .grant : .deny)
        }
    }
}
