// The iOS host (CONTRACT.md v6.1): Spotify's own web player in one WKWebView, with our page
// mounted over it by observer.js. The page's bundle is fetched at every launch; the last good copy
// is kept in Caches for launches without a network.
import AVFoundation
import CoreMedia
import ReplayKit
import SwiftUI
import WebKit

@main
struct WmpSpotifyApp: App {
    init() {
        // .playAndRecord, since the page takes the microphone when the app's own audio does not
        // reach it: WebKit would switch a .playback session to it anyway, and on its own that routes
        // sound to the earpiece. The music keeps going with the screen locked (UIBackgroundModes
        // audio) and with the mute switch on, as under .playback.
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetoothA2DP, .allowAirPlay])
        try? AVAudioSession.sharedInstance().setActive(true)
        HostLog.shared.log("host: build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")")
    }

    var body: some Scene {
        WindowGroup { Player() }
    }
}

// The audio host, for the app's lifetime. Player starts the capture and tells it the scene phase;
// its log row restarts it.
final class Audio {
    static let shared = Audio()
    let capture = AppAudioCapture()
}

// The one web view, used on the main thread: the retry reloads it, the capture feeds the page
// through it.
final class WebHolder {
    static let shared = WebHolder()
    weak var web: WKWebView?
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
                    .onTapGesture { retry() }
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
            Audio.shared.capture.scene(active: phase == .active)
        }
        .task {
            script = await userScript()
            ready = true
            // Once the scene is up, so ReplayKit's consent alert has a window to come up in; the
            // web view is loading behind it.
            try? await Task.sleep(for: .seconds(2))
            Audio.shared.capture.start()
        }
    }

    // ReplayKit's consent alert again, and the page reloaded: once __wmpAudio.close() has given it
    // the microphone, only a new page takes the app's audio again.
    private func retry() {
        HostLog.shared.log("retry: restarting capture, reloading the page in 1.5 s")
        Audio.shared.capture.restart()
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            WebHolder.shared.web?.reload()
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

// The app's own output for the visualizers, by ReplayKit's in-app capture. An experiment: iOS gives
// an app no way to hear another app, Spotify's DRM playback cannot be routed through Web Audio, and
// Apple Music is silenced in screen recordings; whether Spotify's web player is too is what this
// finds out. There is no socket: WebKit refuses a ws:// connection from Spotify's https page (build
// 6's never connected), so the samples go in by evaluateJavaScript (WebHolder.run) to the stand-in
// observer.js puts in its place. The first buffer that is not silent sends __wmpAudio.rate(n), and
// every buffer from then on __wmpAudio.pcm(<base64 interleaved stereo int16 LE>, n), the rate again
// for a stand-in opened later (a reload, the login page and back). 30 s in the
// foreground of nothing but silence, or a refusal or failure, stops the capture and sends
// __wmpAudio.close() until a retry (restart()): the page then falls back to the microphone. All
// state is on `queue`.
final class AppAudioCapture {
    private let queue = DispatchQueue(label: "replaykit-audio")
    private var attached = false
    private var done = false
    private var active = true      // the scene is in the foreground
    private var buffers = 0
    private var emptyBuffers = 0   // read, but with no frames
    private var totalFrames = 0
    private var described = false  // the first buffer's format was logged
    private var measured = false   // the first read buffer's size and peak were logged
    private var skipped = false    // a buffer this cannot read was logged
    private var timeout: DispatchWorkItem?
    private var gen = 0  // which start() a ReplayKit callback belongs to; older ones are ignored

    /// On the main thread. startCapture brings up iOS's own consent alert ("Allow screen recording
    /// in WMP Spotify?"); that is expected for this experiment. Declining it is a refusal.
    func start() {
        let recorder = RPScreenRecorder.shared()
        recorder.isMicrophoneEnabled = false
        HostLog.shared.log("replaykit: starting in-app capture (available: \(recorder.isAvailable))")
        // A capture stopped by restart() may still report an error afterwards: not this attempt's.
        let g: Int = queue.sync { gen += 1; return gen }
        recorder.startCapture(handler: { [weak self] buffer, type, error in
            guard let self else { return }
            if let error {
                self.queue.async { if g == self.gen { self.giveUp("capture failed (\(error.localizedDescription))") } }
            } else if type == .audioApp {
                self.queue.async { if g == self.gen { self.take(buffer) } }
            }
        }, completionHandler: { [weak self] error in
            guard let self else { return }
            self.queue.async {
                guard g == self.gen else { return }
                if let error {
                    self.giveUp("capture refused or failed (\(error.localizedDescription))")
                    return
                }
                HostLog.shared.log("replaykit: capture started, waiting up to 30 s in the foreground for app audio that is not silent")
                // From here and not from startCapture, so the time the consent alert is up does not count.
                self.arm()
            }
        })
    }

    /// From the main thread, at each scene phase: the 30 s count only in the foreground.
    func scene(active: Bool) {
        queue.async { self.active = active }
    }

    /// The retry, from the main thread: forgets the last attempt, stops a capture still running, and
    /// starts again, consent alert and all.
    func restart() {
        queue.async {
            self.done = false
            self.attached = false
            self.buffers = 0
            self.emptyBuffers = 0
            self.totalFrames = 0
            self.described = false
            self.measured = false
            self.skipped = false
            self.timeout?.cancel()
            self.timeout = nil
            DispatchQueue.main.async {
                let recorder = RPScreenRecorder.shared()
                if recorder.isRecording {
                    recorder.stopCapture { error in
                        if let error { HostLog.shared.log("replaykit: stopCapture: \(error.localizedDescription)") }
                        DispatchQueue.main.async { self.start() }
                    }
                } else {
                    self.start()
                }
            }
        }
    }

    // 30 s, then the give-up if nothing was heard. In the background, where ReplayKit may deliver
    // nothing, another 30 s instead, the counts started over.
    private func arm() {
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, !self.attached else { return }
            guard self.active else {
                self.buffers = 0
                self.emptyBuffers = 0
                self.totalFrames = 0
                self.arm()
                return
            }
            HostLog.shared.log("replaykit: \(self.buffers) app audio buffers (\(self.emptyBuffers) empty, \(self.totalFrames) frames) in 30 s, none with sound")
            self.giveUp("30 s of silence")
        }
        self.timeout = timeout
        queue.asyncAfter(deadline: .now() + 30, execute: timeout)
    }

    private func take(_ buffer: CMSampleBuffer) {
        guard !done else { return }
        buffers += 1
        guard let s = stereo(buffer) else { return }
        if !measured {
            measured = true
            HostLog.shared.log("replaykit: first buffer \(s.frames) frames, peak \(s.peak)")
        }
        totalFrames += s.frames
        guard s.frames > 0 else {
            emptyBuffers += 1
            return
        }
        if !attached {
            guard s.peak > 0 else { return }
            attached = true
            timeout?.cancel()
            HostLog.shared.log("replaykit: app audio after \(buffers) buffers (peak \(s.peak)), \(Int(s.rate)) Hz: sending it to the page")
            WebHolder.shared.run("__wmpAudio.rate(\(Int(s.rate)))")
        }
        WebHolder.shared.run("__wmpAudio.pcm('\(s.pcm.base64EncodedString())', \(Int(s.rate)))")
    }

    private func giveUp(_ why: String) {
        guard !done else { return }
        done = true
        timeout?.cancel()
        HostLog.shared.log("replaykit: \(why), giving the page the microphone")
        WebHolder.shared.run("__wmpAudio.close()")
        DispatchQueue.main.async {
            RPScreenRecorder.shared().stopCapture { error in
                if let error { HostLog.shared.log("replaykit: stopCapture: \(error.localizedDescription)") }
            }
        }
    }

    /// The buffer as interleaved stereo little-endian int16 (mono doubled), with its peak (0...1),
    /// rate and frame count: from 16-bit integer or 32-bit float, interleaved or not, either byte
    /// order (ReplayKit's app audio is big-endian int16, measured build 6). nil for anything else,
    /// logged once.
    private func stereo(_ buffer: CMSampleBuffer) -> (pcm: Data, peak: Float, rate: Double, frames: Int)? {
        guard let desc = CMSampleBufferGetFormatDescription(buffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc)?.pointee else { return nil }
        if !described {
            described = true
            HostLog.shared.log("replaykit: first app audio buffer: \(asbd)")
        }
        let flags = asbd.mFormatFlags
        let isFloat = flags & kAudioFormatFlagIsFloat != 0
        let planar = flags & kAudioFormatFlagIsNonInterleaved != 0
        let big = flags & kAudioFormatFlagIsBigEndian != 0
        let channels = Int(asbd.mChannelsPerFrame)
        let size = isFloat ? 4 : 2
        guard asbd.mFormatID == kAudioFormatLinearPCM, channels == 1 || channels == 2,
              Int(asbd.mBitsPerChannel) == size * 8, asbd.mBytesPerFrame > 0,
              isFloat || flags & kAudioFormatFlagIsSignedInteger != 0 else {
            skip("an unsupported format")
            return nil
        }

        // The size of the AudioBufferList first, then the list itself; `block` owns the samples.
        var needed = 0
        _ = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            buffer, bufferListSizeNeededOut: &needed, bufferListOut: nil, bufferListSize: 0,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
        let raw = UnsafeMutableRawPointer.allocate(byteCount: max(needed, MemoryLayout<AudioBufferList>.size),
                                                   alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        let list = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
        var block: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            buffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: needed,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
        guard status == 0 else {
            skip("no sample data (status \(status))")
            return nil
        }
        let abl = UnsafeMutableAudioBufferListPointer(list)
        guard abl.count == (planar ? channels : 1) else {
            skip("\(abl.count) buffers for \(channels) channels")
            return nil
        }

        let frames = abl.map { Int($0.mDataByteSize) / Int(asbd.mBytesPerFrame) }.min() ?? 0
        var out = [Int16](repeating: 0, count: frames * 2)
        var peak: Float = 0
        withExtendedLifetime(block) {
            for c in 0..<2 {
                let from = min(c, channels - 1)
                guard let p = abl[planar ? from : 0].mData else { continue }
                let step = planar ? 1 : channels
                let offset = planar ? 0 : from
                for i in 0..<frames {
                    let at = (i * step + offset) * size
                    let v: Int16
                    if isFloat {
                        let u = p.load(fromByteOffset: at, as: UInt32.self)
                        let f = Float(bitPattern: big ? u.byteSwapped : u)
                        // Clamped first, so the product fits (NaN comes out as 1).
                        v = Int16(max(-1, min(1, f)) * 32767)
                    } else {
                        let u = p.load(fromByteOffset: at, as: UInt16.self)
                        v = Int16(bitPattern: big ? u.byteSwapped : u)
                    }
                    out[i * 2 + c] = v
                    // In Float: abs(Int16.min) would trap.
                    peak = max(peak, abs(Float(v)) / 32768)
                }
            }
        }
        // Every iOS device is little-endian: the samples go out as they sit in memory.
        return (out.withUnsafeBufferPointer { Data(buffer: $0) }, peak, asbd.mSampleRate, frames)
    }

    private func skip(_ why: String) {
        if skipped { return }
        skipped = true
        HostLog.shared.log("replaykit: skipping app audio buffers: \(why)")
    }
}
