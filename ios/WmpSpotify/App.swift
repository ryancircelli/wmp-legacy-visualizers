// The iOS host (CONTRACT.md v6.1): Spotify's own web player in one WKWebView, with our page
// mounted over it by observer.js. The page's bundle is fetched at every launch; the last good copy
// is kept in Caches for launches without a network.
import AVFoundation
import CoreMedia
import Network
import ReplayKit
import SwiftUI
import WebKit

@main
struct WmpSpotifyApp: App {
    // Both live as long as the app.
    private let server: AudioServer
    private let capture: AppAudioCapture

    init() {
        // .playAndRecord, since the page takes the microphone when the app's own audio does not
        // reach it: WebKit would switch a .playback session to it anyway, and on its own that routes
        // sound to the earpiece. The music keeps going with the screen locked (UIBackgroundModes
        // audio) and with the mute switch on, as under .playback.
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.defaultToSpeaker, .allowBluetoothA2DP, .allowAirPlay])
        try? AVAudioSession.sharedInstance().setActive(true)
        let server = AudioServer()
        let capture = AppAudioCapture(server: server)
        self.server = server
        self.capture = capture
        server.start()
        // A second in, so the web view is already loading behind ReplayKit's consent alert.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { capture.start() }
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
        web.uiDelegate = context.coordinator
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
    final class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate {
        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            print("page: \(message.body)")
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

// ws://127.0.0.1:47831/audio for the page (observer.js hands it the URL), in the Windows host's
// format (tauri/src/audio/mod.rs): {"rate":n} once, then binary interleaved stereo f32. The page's
// own messages (lyricsPref, wake, mediaCmd) are read and dropped. All state is on `queue`.
// ponytail: no send backpressure (the Windows host caps unsent bytes); add one if a stalled page
// ever shows up as memory growth.
final class AudioServer {
    private let queue = DispatchQueue(label: "audio-server")
    private var listener: NWListener?
    private var page: NWConnection?  // the latest socket
    private var ready = false        // its handshake is done
    private var rate: Double?

    func start() {
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        let params = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        // Loopback only: nothing off the phone reaches it. (No key, unlike the Windows host's: only
        // the foreground app runs, and this is only the app's own sound.)
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: 47831)
        params.allowLocalEndpointReuse = true
        let listener: NWListener
        do {
            listener = try NWListener(using: params)
        } catch {
            print("audio: cannot listen: \(error)")
            return
        }
        listener.stateUpdateHandler = { [weak listener] state in
            print("audio: listener \(state), port \(listener?.port?.rawValue ?? 0)")
        }
        listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
        self.listener = listener
        listener.start(queue: queue)
    }

    /// The capture's sample rate, before its first samples: sent now if the page is connected, else
    /// as soon as it is.
    func sendRate(_ rate: Double) {
        queue.async {
            self.rate = rate
            self.sendRateFrame(rate)
        }
    }

    func sendPCM(_ data: Data) {
        queue.async { self.send(data, .binary) }
    }

    /// For good: the socket and the listener, so a page that reconnects gets no socket and keeps
    /// the microphone.
    func close() {
        queue.async {
            self.listener?.cancel()
            self.listener = nil
            self.page?.cancel()
            self.page = nil
            print("audio: server closed")
        }
    }

    private func accept(_ c: NWConnection) {
        page?.cancel()
        page = c
        ready = false
        c.stateUpdateHandler = { [weak self, weak c] state in
            guard let self, let c, c === self.page else { return }
            switch state {
            case .ready:
                print("audio: page connected")
                self.ready = true
                self.receive(c)
                if let rate = self.rate { self.sendRateFrame(rate) }
            case .failed(let error):
                print("audio: socket failed: \(error)")
                self.page = nil
            case .cancelled:
                print("audio: socket closed")
                self.page = nil
            default:
                break
            }
        }
        c.start(queue: queue)
    }

    // Drains the page's messages, which this host has no use for.
    private func receive(_ c: NWConnection) {
        c.receiveMessage { [weak self, weak c] _, context, _, error in
            guard let self, let c else { return }
            let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
                as? NWProtocolWebSocket.Metadata
            // An error, a close frame or the end of the stream: done with this socket.
            guard error == nil, let meta, meta.opcode != .close else {
                c.cancel()
                return
            }
            self.receive(c)
        }
    }

    private func sendRateFrame(_ rate: Double) {
        send(Data("{\"rate\":\(Int(rate))}".utf8), .text)
    }

    private func send(_ data: Data, _ opcode: NWProtocolWebSocket.Opcode) {
        guard ready, let page else { return }
        let context = NWConnection.ContentContext(identifier: "audio",
                                                  metadata: [NWProtocolWebSocket.Metadata(opcode: opcode)])
        page.send(content: data, contentContext: context, isComplete: true,
                  completion: .contentProcessed { error in
                      if let error { print("audio: send failed: \(error)") }
                  })
    }
}

// The app's own output for the visualizers, by ReplayKit's in-app capture. An experiment: iOS gives
// an app no way to hear another app, Spotify's DRM playback cannot be routed through Web Audio, and
// Apple Music is silenced in screen recordings; whether Spotify's web player is too is what this
// finds out. The first buffer that is not silent sends the rate, and every buffer from then on goes
// to the page. 30 s of nothing but silence, or a refusal or failure, stops the capture and closes
// the server for good: the page then falls back to the microphone. All state is on `queue`.
final class AppAudioCapture {
    private let server: AudioServer
    private let queue = DispatchQueue(label: "replaykit-audio")
    private var attached = false
    private var done = false
    private var buffers = 0
    private var described = false  // the first buffer's format was logged
    private var skipped = false    // a buffer this cannot read was logged
    private var timeout: DispatchWorkItem?

    init(server: AudioServer) { self.server = server }

    /// On the main thread. startCapture brings up iOS's own consent alert ("Allow screen recording
    /// in WMP Spotify?"); that is expected for this experiment. Declining it is a refusal.
    func start() {
        let recorder = RPScreenRecorder.shared()
        recorder.isMicrophoneEnabled = false
        print("replaykit: starting in-app capture (available: \(recorder.isAvailable))")
        recorder.startCapture(handler: { [weak self] buffer, type, error in
            guard let self else { return }
            if let error {
                self.queue.async { self.giveUp("capture failed (\(error.localizedDescription))") }
            } else if type == .audioApp {
                self.queue.async { self.take(buffer) }
            }
        }, completionHandler: { [weak self] error in
            guard let self else { return }
            self.queue.async {
                if let error {
                    self.giveUp("capture refused or failed (\(error.localizedDescription))")
                    return
                }
                print("replaykit: capture started, waiting up to 30 s for app audio that is not silent")
                // From here and not from startCapture, so the time the consent alert is up does not count.
                let timeout = DispatchWorkItem { [weak self] in
                    guard let self, !self.attached else { return }
                    print("replaykit: \(self.buffers) app audio buffers in 30 s, none with sound")
                    self.giveUp("30 s of silence")
                }
                self.timeout = timeout
                self.queue.asyncAfter(deadline: .now() + 30, execute: timeout)
            }
        })
    }

    private func take(_ buffer: CMSampleBuffer) {
        guard !done else { return }
        buffers += 1
        guard let s = stereo(buffer) else { return }
        if !attached {
            guard s.peak > 0 else { return }
            attached = true
            timeout?.cancel()
            print("replaykit: app audio after \(buffers) buffers (peak \(s.peak)), \(Int(s.rate)) Hz: sending it to the page")
            server.sendRate(s.rate)
        }
        server.sendPCM(s.pcm)
    }

    private func giveUp(_ why: String) {
        guard !done else { return }
        done = true
        timeout?.cancel()
        print("replaykit: \(why), giving the page the microphone")
        server.close()
        DispatchQueue.main.async {
            RPScreenRecorder.shared().stopCapture { error in
                if let error { print("replaykit: stopCapture: \(error.localizedDescription)") }
            }
        }
    }

    /// The buffer as interleaved stereo little-endian f32 (mono doubled), with its peak and rate: from
    /// 16-bit integer or 32-bit float, interleaved or not, either byte order (ReplayKit's app audio
    /// has been reported big-endian). nil for anything else, logged once.
    private func stereo(_ buffer: CMSampleBuffer) -> (pcm: Data, peak: Float, rate: Double)? {
        guard let desc = CMSampleBufferGetFormatDescription(buffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc)?.pointee else { return nil }
        if !described {
            described = true
            print("replaykit: first app audio buffer: \(asbd)")
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
        var out = [Float](repeating: 0, count: frames * 2)
        var peak: Float = 0
        withExtendedLifetime(block) {
            for c in 0..<2 {
                let from = min(c, channels - 1)
                guard let p = abl[planar ? from : 0].mData else { continue }
                let step = planar ? 1 : channels
                let offset = planar ? 0 : from
                for i in 0..<frames {
                    let at = (i * step + offset) * size
                    let v: Float
                    if isFloat {
                        let u = p.load(fromByteOffset: at, as: UInt32.self)
                        v = Float(bitPattern: big ? u.byteSwapped : u)
                    } else {
                        let u = p.load(fromByteOffset: at, as: UInt16.self)
                        v = Float(Int16(bitPattern: big ? u.byteSwapped : u)) / 32768
                    }
                    out[i * 2 + c] = v
                    peak = max(peak, abs(v))
                }
            }
        }
        return (out.withUnsafeBufferPointer { Data(buffer: $0) }, peak, asbd.mSampleRate)
    }

    private func skip(_ why: String) {
        if skipped { return }
        skipped = true
        print("replaykit: skipping app audio buffers: \(why)")
    }
}
