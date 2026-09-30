// The iOS host (CONTRACT.md v6.1): Spotify's own web player in one WKWebView, with our page
// mounted over it by observer.js. The page's bundle is fetched at every launch; the last good copy
// is kept in Caches for launches without a network.
import AVFoundation
import Network
import ReplayKit
import SwiftUI
import WebKit

@main
struct WmpSpotifyApp: App {
    // For the app's lifetime: the broadcast extension connects to it whenever a broadcast starts.
    private let server = AudioServer()

    init() {
        // .playback: the music keeps going with the screen locked, in the background
        // (UIBackgroundModes audio) and with the mute switch on.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        HostLog.shared.log("host: build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")")
        server.start()
    }

    var body: some Scene {
        WindowGroup { Player() }
    }
}

// The one web view and the broadcast picker, used on the main thread: a tap on the log row reloads
// the web view, Forwarder feeds the page through it, and Player opens the picker at launch.
final class WebHolder {
    static let shared = WebHolder()
    weak var web: WKWebView?
    weak var picker: RPSystemBroadcastPickerView?
    private var failed = false  // an evaluateJavaScript error was logged

    /// From any thread: runs `js` in the page on the main thread, in call order, the result dropped.
    /// Only the first error is logged (the page without window.__wmpAudio, say). The completion
    /// handler and not the async variant, which crashes on a void result in some SDKs.
    func run(_ js: String) {
        DispatchQueue.main.async {
            self.web?.evaluateJavaScript(js) { _, error in
                guard let error, !self.failed else { return }
                self.failed = true
                HostLog.shared.log("audio: evaluateJavaScript failed: \(error.localizedDescription)")
            }
        }
    }
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
            // line under it with the broadcast picker at its right end. The keyboard is left to
            // WebKit, which scrolls the focused field into view itself.
            VStack(spacing: 0) {
                if ready { WebView(script: script) } else { Color.clear }
                HStack(spacing: 0) {
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
                    BroadcastButton().frame(width: 44, height: 44)
                }
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
            // iOS's broadcast sheet 2 s after the page is up, so it need not be hunted for: a tap
            // sent to the picker's own button, the widely used way to open it from code (ReplayKit
            // has no call for it). The user still taps Start Broadcast; iOS requires that tap.
            try? await Task.sleep(for: .seconds(2))
            guard let picker = WebHolder.shared.picker else { return }
            HostLog.shared.log("broadcast: picker shown")
            for case let b as UIButton in picker.subviews { b.sendActions(for: .touchUpInside) }
        }
    }

    // The page again from the top: its overlay, its stand-in audio socket, Spotify's own state.
    private func reload() {
        HostLog.shared.log("reload: the page")
        WebHolder.shared.web?.reload()
    }
}

// iOS's own broadcast picker, offering only our extension and no microphone button. Its button is
// tinted white for the black band.
struct BroadcastButton: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        picker.preferredExtension = "com.rcircelli.wmpspotify.broadcast"
        picker.showsMicrophoneButton = false
        for case let b as UIButton in picker.subviews { b.imageView?.tintColor = .white }
        WebHolder.shared.picker = picker
        return picker
    }

    func updateUIView(_ picker: RPSystemBroadcastPickerView, context: Context) {}
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
        WebHolder.shared.web = web
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    // window.alchemyLog from the page (observer.js posts to webkit.messageHandlers.log).
    final class Coordinator: NSObject, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            HostLog.shared.log("page: \(message.body)")
        }
    }
}

// ws://127.0.0.1:47831 for the broadcast extension (ios/WmpSpotifyBroadcast/SampleHandler.swift),
// which sends {"rate":n} as text, then binary frames of interleaved stereo int16 LE: all handed to
// Forwarder. The latest connection wins. All state is on `queue`.
final class AudioServer {
    private let queue = DispatchQueue(label: "audio-server")
    private var listener: NWListener?
    private var source: NWConnection?  // the extension's latest socket

    func start() {
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        let params = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        // Loopback only: nothing off the phone reaches it.
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: 47831)
        params.allowLocalEndpointReuse = true
        let listener: NWListener
        do {
            listener = try NWListener(using: params)
        } catch {
            HostLog.shared.log("audio: cannot listen: \(error)")
            return
        }
        listener.stateUpdateHandler = { [weak listener] state in
            HostLog.shared.log("audio: listener \(state), port \(listener?.port?.rawValue ?? 0)")
        }
        listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
        self.listener = listener
        listener.start(queue: queue)
    }

    private func accept(_ c: NWConnection) {
        source?.cancel()
        source = c
        c.stateUpdateHandler = { [weak self, weak c] state in
            guard let self, let c, c === self.source else { return }
            switch state {
            case .ready:
                HostLog.shared.log("audio: extension connected")
                self.receive(c)
            case .failed, .cancelled:
                self.drop(c)
            default:
                break
            }
        }
        c.start(queue: queue)
    }

    // The extension's frames, one at a time, until an error, a close frame or the end of the stream.
    private func receive(_ c: NWConnection) {
        c.receiveMessage { [weak self, weak c] data, context, _, error in
            guard let self, let c else { return }
            let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
                as? NWProtocolWebSocket.Metadata
            guard error == nil, let meta, meta.opcode != .close else {
                self.drop(c)
                return
            }
            if let data, meta.opcode == .binary {
                Forwarder.shared.pcm(data)
            } else if let data, meta.opcode == .text,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let rate = json["rate"] as? Int {
                Forwarder.shared.rate(rate)
            }
            self.receive(c)
        }
    }

    // Once per socket: the broadcast ended (or the extension died), so the page goes silent.
    private func drop(_ c: NWConnection) {
        guard c === source else { return }
        source = nil
        c.cancel()
        HostLog.shared.log("audio: extension disconnected")
        Forwarder.shared.stopped()
    }
}

// The extension's audio into the page by evaluateJavaScript (WebKit refuses ws:// from Spotify's
// https page), to the stand-in socket observer.js puts in its place: __wmpAudio.rate(n) when the
// extension says it, then every 100 ms __wmpAudio.pcm(<base64 interleaved stereo int16 LE>, n) with
// all that came in since, so evaluateJavaScript runs 10 times a second and not once per buffer (43).
// The rate rides along for a stand-in opened later (a reload). All state is on `queue`.
final class Forwarder {
    static let shared = Forwarder()
    private let queue = DispatchQueue(label: "audio-forwarder")
    private var sampleRate = 0
    private var pending = Data()
    private var timer: DispatchSourceTimer?

    func rate(_ n: Int) {
        queue.async {
            self.sampleRate = n
            WebHolder.shared.run("__wmpAudio.rate(\(n))")
        }
    }

    func pcm(_ data: Data) {
        queue.async {
            self.pending.append(data)
            guard self.timer == nil else { return }
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
            timer.setEventHandler { self.flush() }
            timer.resume()
            self.timer = timer
        }
    }

    /// The broadcast is over: what is left, then 4096 frames of silence so the visualizers go dark
    /// instead of holding the last spectrum. No __wmpAudio.close(): the page opens its stand-in once,
    /// and the next broadcast carries on in it.
    func stopped() {
        queue.async {
            self.timer?.cancel()
            self.timer = nil
            self.flush()
            self.pending = Data(count: 4096 * 2 * 2)
            self.flush()
        }
    }

    private func flush() {
        defer { pending.removeAll(keepingCapacity: true) }
        guard !pending.isEmpty, sampleRate > 0 else { return }
        WebHolder.shared.run("__wmpAudio.pcm('\(pending.base64EncodedString())', \(sampleRate))")
    }
}
