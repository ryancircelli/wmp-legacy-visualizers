// The iOS host (CONTRACT.md v6.1): Spotify's own web player in one WKWebView, with our page
// mounted over it by observer.js. The page's bundle and observer.js are fetched at every launch; the
// last good copies are kept in Caches for launches without a network.
import AVFoundation
import MediaPlayer
import Network
import ReplayKit
import SwiftUI
import UIKit
import WebKit

@main
struct WmpSpotifyApp: App {
    // For the app's lifetime: the broadcast extension connects to it whenever a broadcast starts.

    init() {
        // .playback: the music keeps going with the screen locked, in the background
        // (UIBackgroundModes audio) and with the mute switch on.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        HostLog.shared.log("host: build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")")
        AudioServer.shared.start()
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
// the web view and the whole log on a long press, the broadcast extension's lines merged in. It
// persists in host.log in the App Group container (Application Support without one), the last 3000
// lines kept.
final class HostLog: ObservableObject {
    static let shared = HostLog()
    private static let cap = 3000
    @Published var last = ""
    @Published var lines: [String] = []  // published so the open sheet takes in new lines
    private let queue = DispatchQueue(label: "host-log")  // the file's writes, in call order
    private let path: String = groupPath("host.log") ?? {
        let dir = URL.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "host.log").path
    }()
    private lazy var file: FileHandle? = {  // on `queue`, open for the app's lifetime
        if !FileManager.default.fileExists(atPath: self.path) {
            FileManager.default.createFile(atPath: self.path, contents: nil)
        }
        return FileHandle(forWritingAtPath: self.path)
    }()
    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    /// The earlier launches' lines, the file cut back to the last 3000, then this launch's marker.
    private init() {
        let old = FileManager.default.contents(atPath: path)
            .map { String(decoding: $0, as: UTF8.self).split(whereSeparator: \.isNewline).map(String.init) } ?? []
        lines = Array(old.suffix(Self.cap))
        if old.count > Self.cap {
            try? (lines.joined(separator: "\n") + "\n").write(toFile: path, atomically: true, encoding: .utf8)
        }
        let now = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: .withInternetDateTime)
        log("---- launch \(now) ----", quiet: true)
    }

    /// From any thread; the published state changes on the main thread. A quiet line goes to the
    /// long-press list only, never the band.
    func log(_ line: String, quiet: Bool = false) {
        print(line)
        let stamped = "\(Self.clock.string(from: Date())) \(line)"
        queue.async {
            _ = try? self.file?.seekToEnd()
            try? self.file?.write(contentsOf: Data((stamped + "\n").utf8))
        }
        DispatchQueue.main.async {
            self.lines.append(stamped)
            if self.lines.count > Self.cap { self.lines.removeFirst(self.lines.count - Self.cap) }
            if !quiet { self.last = line }
        }
    }

    /// On the main thread: host.log and the list emptied.
    func clear() {
        queue.async { try? self.file?.truncate(atOffset: 0) }
        lines = []
        log("log cleared")
    }

    /// From the main thread: the lines of the extension's log of its latest broadcast (broadcast.log
    /// in the App Group container) not yet taken in, as quiet "ext: " lines. A broadcast is known by
    /// its first line, which carries its start time; a line still being written waits for the next call.
    func importExtensionLog() {
        guard let path = groupPath("broadcast.log"),
              let data = FileManager.default.contents(atPath: path) else { return }
        let ext = String(decoding: data, as: UTF8.self)
            .split(separator: "\n", omittingEmptySubsequences: false).dropLast()
        guard let first = ext.first.map({ String($0) }) else { return }
        let d = UserDefaults.standard
        let done = d.string(forKey: "extFirst") == first ? d.integer(forKey: "extCount") : 0
        guard ext.count > done else { return }
        d.set(first, forKey: "extFirst")
        d.set(ext.count, forKey: "extCount")
        for line in ext.dropFirst(done) { log("ext: \(line)", quiet: true) }
    }
}

// A file in the App Group container shared with the broadcast extension; nil without the entitlement.
func groupPath(_ name: String) -> String? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.rcircelli.wmpspotify")?
        .appendingPathComponent(name).path
}

// What the page sets of the host's window, by script message, on the main thread ("layout" and
// "showlog"). Not SwiftUI's Layout, hence the name.
final class PageLayout: ObservableObject {
    static let shared = PageLayout()
    @Published var edge = false     // the web view over the whole screen, no band
    @Published var showLog = false  // the whole log in a sheet, as the band's long press opens it
}

struct Player: View {
    @State private var script: String?
    @State private var ready = false
    @ObservedObject private var log = HostLog.shared
    @ObservedObject private var layout = PageLayout.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            // By default the web view keeps to the safe area (black bars at the notch), the host's
            // last log line under it with the broadcast picker at its right end. Edge to edge (the
            // page's "layout" message) the web view fills the screen and the band is gone; the picker
            // stays, 1x1 and all but invisible in the corner, for the tap at launch. The web view is
            // the same one in both, never rebuilt. The keyboard is left to WebKit, which scrolls the
            // focused field into view itself.
            VStack(spacing: 0) {
                if ready {
                    WebView(script: script, edge: layout.edge).ignoresSafeArea(edges: layout.edge ? .all : [])
                } else {
                    Color.clear
                }
                if !layout.edge {
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
                            .onLongPressGesture { layout.showLog = true }
                        BroadcastButton().frame(width: 44, height: 44)
                    }
                }
            }
            .ignoresSafeArea(.keyboard)
            if layout.edge { BroadcastButton().frame(width: 1, height: 1).opacity(0.01) }
        }
        .sheet(isPresented: $layout.showLog) {
            VStack(spacing: 0) {
                HStack(spacing: 24) {
                    Button("Copy") { UIPasteboard.general.string = log.lines.joined(separator: "\n") }
                    Button("Clear") { HostLog.shared.clear() }
                    Spacer()
                }
                .padding()
                // A Text per line, laid out lazily: 3000 lines in one Text would all be laid out again at
                // every new line.
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(log.lines.enumerated()), id: \.offset) { _, line in Text(line) }
                            Color.clear.frame(height: 1).id("end")
                        }
                        .font(.system(size: 10, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                    }
                    .onAppear { proxy.scrollTo("end", anchor: .bottom) }
                }
            }
            .onAppear { HostLog.shared.importExtensionLog() }
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
            // A broadcast from before the app closed reconnects within that time (the extension
            // tries every second): the sheet would only offer to stop it.
            if AudioServer.shared.connected { HostLog.shared.log("broadcast: already running, no picker"); return }
            guard let picker = WebHolder.shared.picker else { return }
            HostLog.shared.log("broadcast: picker shown")
            for case let b as UIButton in picker.subviews { b.sendActions(for: .touchUpInside) }
            // The extension's log once a broadcast has likely started (or failed to).
            try? await Task.sleep(for: .seconds(8))
            HostLog.shared.importExtensionLog()
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

// `name` from wmp.ryancircelli.com, parsed, with where it came from: "site" when it answers 200 with a
// body `parse` takes (a captive portal answers 200 too), that body then cached for launches without a
// network; else "cache", the last copy cached; nil with neither.
func siteFile<T: Sendable>(_ name: String, _ parse: @escaping @Sendable (Data) -> T?) async -> (value: T, source: String)? {
    let cache = URL.cachesDirectory.appending(path: name)
    let request = URLRequest(url: URL(string: "https://wmp.ryancircelli.com/\(name)")!,
                             cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
    if case let (data, response)? = try? await URLSession.shared.data(for: request),
       (response as? HTTPURLResponse)?.statusCode == 200, let value = parse(data) {
        try? data.write(to: cache)
        return (value, "site")
    }
    if let data = try? Data(contentsOf: cache), let value = parse(data) { return (value, "cache") }
    return nil
}

// observer.js wrapped as its header says, or nil when no bundle was ever fetched: the web player
// then shows bare, without the overlay. The observer comes from the site too (ios-observer.js, the
// same file), the copy built into the app only when neither the site nor the cache has it, so a
// change to either reaches the phone without a new build.
func userScript() async -> String? {
    async let fetchedBundle = siteFile("spotify-inject.js") { try? JSONDecoder().decode(Inject.self, from: $0) }
    async let fetchedObserver = siteFile("ios-observer.js") { data -> String? in
        // Our script, not an error page.
        guard let text = String(data: data, encoding: .utf8),
              text.contains("location.hostname !== 'open.spotify.com'") else { return nil }
        return text
    }
    let bundled = Bundle.main.url(forResource: "observer", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
    let bundle = await fetchedBundle
    let observer = await fetchedObserver ?? bundled.map { (value: $0, source: "bundled") }
    HostLog.shared.log("page: bundle from \(bundle?.source ?? "none")")
    HostLog.shared.log("page: observer from \(observer?.source ?? "none")")
    guard let inject = bundle?.value,
          let observerJS = observer?.value,
          let html = try? JSONEncoder().encode(inject.html),
          let css = try? JSONEncoder().encode(inject.css) else { return nil }
    return """
        (function (HTML, CSS, RUN) {
        \(observerJS)
        })(\(String(decoding: html, as: UTF8.self)), \(String(decoding: css, as: UTF8.self)), function () { "use strict";
        \(inject.js)
        });
        """
}

struct WebView: UIViewRepresentable {
    let script: String?
    let edge: Bool

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop
        config.userContentController.add(context.coordinator, name: "log")
        config.userContentController.add(context.coordinator, name: "volume")
        config.userContentController.add(context.coordinator, name: "open")
        config.userContentController.add(context.coordinator, name: "layout")
        config.userContentController.add(context.coordinator, name: "showlog")
        if let script {
            config.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let web = InsetWebView(frame: .zero, configuration: config)
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

    // Edge to edge, WebKit would otherwise still inset the page from the notch and the home indicator
    // (Spotify's viewport is not viewport-fit=cover); the page pads itself by window.__wmpSafeArea.
    // Left as it is by default, and once set kept: inside the safe area the insets are 0.
    func updateUIView(_ web: WKWebView, context: Context) {
        if edge { web.scrollView.contentInsetAdjustmentBehavior = .never }
    }

    // The page's messages (webkit.messageHandlers.<name>.postMessage), on the main thread:
    // log, window.alchemyLog's line; volume, window.alchemySetVolume's level, 0...100; open, an http(s)
    // URL to open outside the app; layout, "edge" or "safe" (PageLayout), the insets pushed again for
    // a page that asks after a reload; showlog, the log sheet.
    final class Coordinator: NSObject, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            switch message.name {
            case "volume":
                // A JS number arrives as an NSNumber; a numeric string is taken too.
                guard let n = (message.body as? NSNumber)?.doubleValue ?? (message.body as? String).flatMap({ Double($0) }),
                      n.isFinite else { return }
                SystemVolume.shared.set(Int(min(max(n, 0), 100).rounded()))
            case "open":
                guard let s = message.body as? String, let url = URL(string: s),
                      let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
                HostLog.shared.log("open: \(url)", quiet: true)
                UIApplication.shared.open(url)
            case "layout":
                guard let mode = message.body as? String, mode == "edge" || mode == "safe" else { return }
                HostLog.shared.log("layout: \(mode)", quiet: true)
                PageLayout.shared.edge = mode == "edge"
                // On the main thread already; assumeIsolated whichever isolation the SDK gives this method.
                if let web = message.webView as? InsetWebView { MainActor.assumeIsolated { web.pushInsets() } }
            case "showlog":
                PageLayout.shared.showLog = true
            default:
                HostLog.shared.log("page: \(message.body)")
            }
        }
    }
}

// The web view, telling the page its safe-area insets in points whenever they change and when it joins
// a window: window.__wmpSafeArea = {top, right, bottom, left}, then a "wmp-safe-area" event on window.
// Inside the safe area they are all 0; edge to edge they are the notch's and the home indicator's.
final class InsetWebView: WKWebView {
    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        pushInsets()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        pushInsets()
    }

    func pushInsets() {
        let i = safeAreaInsets
        evaluateJavaScript("window.__wmpSafeArea={top:\(i.top),right:\(i.right),bottom:\(i.bottom),left:\(i.left)};window.dispatchEvent(new Event('wmp-safe-area'))",
                           completionHandler: nil)
    }
}

// The phone's output volume, which the skin's slider and mute set: a page cannot change its own
// playback volume on iOS. An MPVolumeView's slider is the only way an app can set it, and only while
// the view is in a window, so it sits off screen under the root view. iOS shows its own volume HUD.
// The hardware buttons' changes are not read back into the skin.
final class SystemVolume {
    static let shared = SystemVolume()
    private let view = MPVolumeView(frame: CGRect(x: -1000, y: -1000, width: 1, height: 1))
    private var level: Int?  // the latest asked for

    /// On the main thread: the system volume to `pct` (0...100).
    func set(_ pct: Int) {
        if pct != level { HostLog.shared.log("volume: \(pct)", quiet: true) }
        level = pct
        if view.superview != nil { apply(); return }
        guard let root = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .first?.keyWindow?.rootViewController?.view else { return }
        view.alpha = 0.01
        view.isUserInteractionEnabled = false
        root.addSubview(view)
        // Its slider does not take a value the moment the view joins the window.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.apply() }
    }

    private func apply() {
        guard let level, let slider = view.subviews.compactMap({ $0 as? UISlider }).first else { return }
        slider.value = Float(level) / 100
    }
}

// The broadcast extension's socket (ios/WmpSpotifyBroadcast/SampleHandler.swift): a Unix socket,
// audio.sock in the App Group container, since loopback TCP from the extension never connected
// (build 9). Frames: the body's length (4 bytes, little-endian), a type byte, the body. Type 0 is
// {"rate":n} as UTF-8 JSON, type 1 interleaved stereo int16 LE; all handed to Forwarder. The latest
// connection wins. All state is on `queue`.
final class AudioServer {
    static let shared = AudioServer()
    private let queue = DispatchQueue(label: "audio-server")
    private var listener: NWListener?
    private var source: NWConnection?  // the extension's latest socket
    private(set) var connected = false // an extension is on the socket (read from any thread, roughly)

    func start() {
        guard let path = groupPath("audio.sock") else {
            HostLog.shared.log("audio: no App Group container")
            return
        }
        _ = unlink(path)  // the last launch's socket file, which would fail the bind
        let params = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        params.requiredLocalEndpoint = .unix(path: path)
        let listener: NWListener
        do {
            listener = try NWListener(using: params)
        } catch {
            HostLog.shared.log("audio: cannot listen: \(error)")
            return
        }
        listener.stateUpdateHandler = { state in
            if case .ready = state {
                HostLog.shared.log("audio: listener ready at \(path)")
            } else {
                HostLog.shared.log("audio: listener \(state)")
            }
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
                self.connected = true
                self.receive(c)
            case .failed, .cancelled:
                self.drop(c)
            default:
                break
            }
        }
        c.start(queue: queue)
    }

    // The extension's frames, one at a time: the 5-byte header, then its body. An error, the end of
    // the stream or a length out of range drops the socket.
    private func receive(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 5, maximumLength: 5) { [weak self, weak c] header, _, _, error in
            guard let self, let c else { return }
            guard error == nil, let header, header.count == 5 else {
                self.drop(c)
                return
            }
            var n: UInt32 = 0
            _ = withUnsafeMutableBytes(of: &n) { header.prefix(4).copyBytes(to: $0) }
            let length = Int(UInt32(littleEndian: n))
            let type = header[header.startIndex + 4]
            // A buffer is a few KB; anything near 1 MB is a broken stream.
            guard (1...(1 << 20)).contains(length) else {
                self.drop(c)
                return
            }
            c.receive(minimumIncompleteLength: length, maximumLength: length) { [weak self, weak c] body, _, _, error in
                guard let self, let c else { return }
                guard error == nil, let body, body.count == length else {
                    self.drop(c)
                    return
                }
                if type == 1 {
                    Forwarder.shared.pcm(body)
                } else if type == 0,
                          let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                          let rate = json["rate"] as? Int {
                    Forwarder.shared.rate(rate)
                }
                self.receive(c)
            }
        }
    }

    // Once per socket: the broadcast ended (or the extension died), so the page goes silent.
    private func drop(_ c: NWConnection) {
        connected = false
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
