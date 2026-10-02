// The iOS host (CONTRACT.md v6.1): Spotify's own web player in one WKWebView, with our page
// mounted over it by observer.js. The page's bundle and observer.js are fetched at every launch; the
// last good copies are kept in Caches for launches without a network.
import AVFoundation
import AVKit
import AudioToolbox
import CoreHaptics
import MediaPlayer
import Network
import ReplayKit
import SwiftUI
import UIKit
import UserNotifications
import WebKit

@main
struct WmpSpotifyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    // For the app's lifetime: the broadcast extension connects to it whenever a broadcast starts.

    init() {
        // .playback: the music keeps going with the screen locked, in the background
        // (UIBackgroundModes audio) and with the mute switch on.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        HostLog.shared.log("host: build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")")
        AudioServer.shared.start()
        Librespot.shared.start()
        DeviceState.shared.start()
    }

    var body: some Scene {
        WindowGroup { Player() }
    }
}

// The app's orientations, which iOS asks for at every rotation: the page's "orientation" message
// (PageLayout.orientations). Implemented, this stands in for the Info.plist's lists.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        PageLayout.shared.orientations
    }
}

// The one web view and the broadcast picker, used on the main thread: a tap on the log row reloads
// the web view, Forwarder feeds the page through it, and Player opens the picker at launch.
final class WebHolder {
    static let shared = WebHolder()
    weak var web: WKWebView?
    weak var picker: RPSystemBroadcastPickerView?
    weak var routePicker: AVRoutePickerView?
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

    /// From any thread: window.<global> = `value` as JSON (a number, a Bool, or a dictionary of them and
    /// strings), then an `event` Event on window.
    func push(_ global: String, _ event: String, _ value: Any) {
        guard let json = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed) else { return }
        run("window.\(global)=\(String(decoding: json, as: UTF8.self));window.dispatchEvent(new Event('\(event)'))")
    }

    /// On the main thread: iOS's broadcast sheet, by a tap sent to the picker's own button, the widely
    /// used way to open it from code (ReplayKit has no call for it). The user still taps Start
    /// Broadcast, or Stop while one runs; iOS requires that tap. False without a picker.
    @discardableResult
    func showPicker() -> Bool {
        guard let picker else { return false }
        HostLog.shared.log("broadcast: picker shown")
        for case let b as UIButton in picker.subviews { b.sendActions(for: .touchUpInside) }
        return true
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

    private var once = Set<String>()  // logOnce's lines, on the main thread

    /// On the main thread: `line`, quiet, the first time only (a haptic or a sound at click-wheel speed).
    func logOnce(_ line: String) {
        if once.insert(line).inserted { log(line, quiet: true) }
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

// The app's window scene (it has one).
func windowScene() -> UIWindowScene? {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
}

// A file in the App Group container shared with the broadcast extension; nil without the entitlement.
func groupPath(_ name: String) -> String? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.rcircelli.wmpspotify")?
        .appendingPathComponent(name).path
}

// What the page sets of the host's window, by script message, on the main thread ("layout",
// "showlog", "statusbar", "homeindicator", "orientation", "band", "background", "keyboard"). Not
// SwiftUI's Layout, hence the name.
final class PageLayout: ObservableObject {
    static let shared = PageLayout()
    @Published var edge = false     // the web view over the whole screen, no band
    @Published var bandHidden = false  // no band in the safe layout either
    @Published var background = Color.black  // behind the web view and in it, the bars included
    @Published var keyboardAvoid = false  // the layout shrinks above the keyboard, not under it
    @Published var showLog = false  // the whole log in a sheet, as the band's long press opens it
    @Published var statusBarHidden = false
    @Published var homeIndicatorHidden = false
    @Published var orientations: UIInterfaceOrientationMask = .allButUpsideDown  // AppDelegate's answer
    // "viewport": "mobile" or "desktop" (the default), the content mode WebView asks for at each
    // navigation; kept across launches.
    static var viewport: String { UserDefaults.standard.string(forKey: "viewport") ?? "desktop" }
}

// A CSS hex color, "#rrggbb" or "#rgb", as a Color; nil for anything else.
func hexColor(_ s: String) -> Color? {
    guard s.hasPrefix("#") else { return nil }
    var hex = String(s.dropFirst())
    if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
    guard hex.count == 6, hex.allSatisfy(\.isHexDigit), let n = UInt32(hex, radix: 16) else { return nil }
    return Color(red: Double(n >> 16 & 0xff) / 255, green: Double(n >> 8 & 0xff) / 255, blue: Double(n & 0xff) / 255)
}

// The page's taps on the Taptic Engine ("haptic" message), on the main thread: one generator per kind,
// kept for the app's lifetime and prepared again after each use, so the next click-wheel tick comes
// without the engine's spin-up. Each kind is logged the first time only: a wheel ticks too fast to log.
final class Haptics {
    static let shared = Haptics()
    private static let styles: [String: UIImpactFeedbackGenerator.FeedbackStyle] =
        ["light": .light, "medium": .medium, "heavy": .heavy, "rigid": .rigid, "soft": .soft]
    private static let types: [String: UINotificationFeedbackGenerator.FeedbackType] =
        ["success": .success, "warning": .warning, "error": .error]
    private let selection = UISelectionFeedbackGenerator()
    private let notification = UINotificationFeedbackGenerator()
    private var impacts: [String: UIImpactFeedbackGenerator] = [:]  // by the page's name for the style

    /// `kind` as the page names it: selection, an impact style, a notification type, or "prepare"
    /// (the selection generator readied, nothing felt). An unknown kind is dropped.
    func play(_ kind: String) {
        if kind == "selection" {
            selection.selectionChanged()
            selection.prepare()
        } else if kind == "prepare" {
            selection.prepare()
        } else if let style = Self.styles[kind] {
            let g = impacts[kind] ?? UIImpactFeedbackGenerator(style: style)
            impacts[kind] = g
            g.impactOccurred()
            g.prepare()
        } else if let type = Self.types[kind] {
            notification.notificationOccurred(type)
            notification.prepare()
        } else {
            return
        }
        HostLog.shared.logOnce("haptic: \(kind)")
    }
}

// The page's own haptic patterns ("hapticpattern" message), on the main thread, by Core Haptics: one
// engine, made at the first pattern. The first error is logged, the rest dropped.
final class HapticPatterns {
    static let shared = HapticPatterns()
    private var engine: CHHapticEngine?
    private var failed = false

    // {"events":[{"t":0,"i":1,"s":0.5,"d":0}]}: each event's start and duration in seconds (d 0 or left
    // out, a tap; else continuous), its intensity and sharpness 0...1.
    private struct Pattern: Decodable {
        struct Event: Decodable { let t, i, s: Double; let d: Double? }
        let events: [Event]
    }

    func play(_ json: String) {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        do {
            let events = try JSONDecoder().decode(Pattern.self, from: Data(json.utf8)).events.map { e in
                CHHapticEvent(eventType: (e.d ?? 0) > 0 ? .hapticContinuous : .hapticTransient,
                              parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(e.i)),
                                           CHHapticEventParameter(parameterID: .hapticSharpness, value: Float(e.s))],
                              relativeTime: e.t, duration: e.d ?? 0)
            }
            let engine = try self.engine ?? CHHapticEngine()
            self.engine = engine
            // At every pattern: the engine stops in the background and after a haptic server reset.
            try engine.start()
            try engine.makePlayer(with: CHHapticPattern(events: events, parameters: [])).start(atTime: 0)
        } catch {
            guard !failed else { return }
            failed = true
            HostLog.shared.log("hapticpattern: \(error)", quiet: true)
        }
    }
}

// The phone, told to the page (WebHolder.push): each report at its change (the brightness only when
// asked), and all of them with the host's own details on "host". On the main thread but pushVolume.
final class DeviceState {
    static let shared = DeviceState()
    private var volume: NSKeyValueObservation?  // kept: the observation ends when it is released
    var scene = "active" { didSet { pushScene() } }  // Player's scenePhase
    private var keyboard = 0.0 { didSet { pushKeyboard() } }

    /// On the main thread, once, with the audio session active. Proximity monitoring also turns the
    /// screen off while the sensor is covered, as in a call.
    func start() {
        volume = AVAudioSession.sharedInstance().observe(\.outputVolume, options: [.new]) { _, _ in self.pushVolume() }
        UIDevice.current.isBatteryMonitoringEnabled = true
        // Proximity only when the page asks ("proximity" on): on, iOS blanks the screen while the sensor is covered.
        let center = NotificationCenter.default
        let watched: [(Notification.Name, () -> Void)] = [
            (UIDevice.batteryLevelDidChangeNotification, pushBattery),
            (UIDevice.batteryStateDidChangeNotification, pushBattery),
            (AVAudioSession.routeChangeNotification, pushRoute),
            (UIDevice.proximityStateDidChangeNotification, pushProximity),
            (.NSProcessInfoPowerStateDidChange, pushLowPower),
            (ProcessInfo.thermalStateDidChangeNotification, pushThermal),
            (UIApplication.didReceiveMemoryWarningNotification, { WebHolder.shared.run("window.dispatchEvent(new Event('wmp-memory'))") }),
        ]
        for (name, push) in watched {
            center.addObserver(forName: name, object: nil, queue: .main) { _ in push() }
        }
        // The keyboard's height over the screen's bottom edge: 0 hidden.
        center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { note in
            guard let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue,
                  let screen = windowScene()?.screen else { return }
            self.keyboard = Double(max(0, screen.bounds.maxY - frame.minY))
        }
    }

    /// window.__wmpProximity: something is at the sensor.
    func pushProximity() { WebHolder.shared.push("__wmpProximity", "wmp-proximity", UIDevice.current.proximityState) }

    /// window.__wmpLowPower: Low Power Mode is on.
    func pushLowPower() { WebHolder.shared.push("__wmpLowPower", "wmp-lowpower", ProcessInfo.processInfo.isLowPowerModeEnabled) }

    /// window.__wmpThermal: "nominal", "fair", "serious" or "critical".
    func pushThermal() {
        let names: [ProcessInfo.ThermalState: String] = [.nominal: "nominal", .fair: "fair", .serious: "serious", .critical: "critical"]
        WebHolder.shared.push("__wmpThermal", "wmp-thermal", names[ProcessInfo.processInfo.thermalState] ?? "nominal")
    }

    /// window.__wmpScene: "active", "inactive" or "background".
    func pushScene() { WebHolder.shared.push("__wmpScene", "wmp-scene", scene) }

    /// window.__wmpKeyboard: the keyboard's height in points, 0 hidden.
    func pushKeyboard() { WebHolder.shared.push("__wmpKeyboard", "wmp-keyboard", keyboard) }

    /// window.__wmpVolume, 0...100: the system volume, the hardware buttons' changes included.
    func pushVolume() {
        WebHolder.shared.push("__wmpVolume", "wmp-volume", Int((AVAudioSession.sharedInstance().outputVolume * 100).rounded()))
    }

    /// window.__wmpBattery = {level: 0...100 or -1 unknown, charging: plugged in (charging or full)}.
    func pushBattery() {
        let d = UIDevice.current
        let level = d.batteryLevel < 0 ? -1 : Int((d.batteryLevel * 100).rounded())
        let charging = d.batteryState == .charging || d.batteryState == .full
        WebHolder.shared.push("__wmpBattery", "wmp-battery", ["level": level, "charging": charging] as [String: Any])
    }

    /// window.__wmpRoute = {name, type}: the first output's port name ("Ryan's AirPods") and type
    /// ("BluetoothA2DPOutput", "Speaker").
    func pushRoute() {
        let out = AVAudioSession.sharedInstance().currentRoute.outputs.first
        WebHolder.shared.push("__wmpRoute", "wmp-route", ["name": out?.portName ?? "", "type": out?.portType.rawValue ?? ""])
    }

    /// window.__wmpBrightness, 0...1.
    func pushBrightness() {
        guard let screen = windowScene()?.screen else { return }
        WebHolder.shared.push("__wmpBrightness", "wmp-brightness", Double(screen.brightness))
    }

    /// window.__wmpHost = {build, version, ios, model ("iPhone16,1"), scale (pixels per point), fps (the
    /// screen's most), voiceOver, viewport}, then every report and the broadcast state: what a page asks
    /// for once at load.
    func pushAll() {
        var u = utsname()
        _ = uname(&u)
        let model = withUnsafeBytes(of: u.machine) { bytes in String(decoding: bytes.prefix(while: { $0 != 0 }), as: UTF8.self) }
        let info = Bundle.main.infoDictionary
        let screen = windowScene()?.screen
        WebHolder.shared.push("__wmpHost", "wmp-host", [
            "build": info?["CFBundleVersion"] as? String ?? "",
            "version": info?["CFBundleShortVersionString"] as? String ?? "",
            "ios": UIDevice.current.systemVersion,
            "model": model,
            "scale": Double(screen?.scale ?? 0),
            "fps": screen?.maximumFramesPerSecond ?? 0,
            "voiceOver": UIAccessibility.isVoiceOverRunning,
            "viewport": PageLayout.viewport,
        ] as [String: Any])
        pushVolume()
        pushBattery()
        pushRoute()
        pushBrightness()
        pushProximity()
        pushLowPower()
        pushThermal()
        pushScene()
        pushKeyboard()
        AudioServer.shared.pushState()
        Librespot.shared.push()
    }
}

struct Player: View {
    @State private var script: String?
    @State private var ready = false
    @ObservedObject private var log = HostLog.shared
    @ObservedObject private var layout = PageLayout.shared
    @Environment(\.scenePhase) private var scenePhase

    // The log band under the web view: in the safe layout, unless the page's "band" message hid it.
    private var band: Bool { !layout.edge && !layout.bandHidden }

    var body: some View {
        ZStack(alignment: .topLeading) {
            layout.background.ignoresSafeArea()
            // By default the web view keeps to the safe area (bars at the notch, in the page's
            // "background" color, black by default), the host's last log line under it with the
            // broadcast picker at its right end. Edge to edge (the page's "layout" message) the web
            // view fills the screen and the band is gone; the picker stays, 1x1 and all but invisible
            // in the corner, for the tap at launch, as it does when the page's "band" message hides the
            // band. The web view is the same one in all of these, never rebuilt. The keyboard is left
            // to WebKit, which scrolls the focused field into view itself, unless the page's
            // "keyboard" message has set "avoid": the layout then shrinks to above the keyboard (the
            // web view ignores only the container's safe area edge to edge, never the keyboard's).
            VStack(spacing: 0) {
                if ready {
                    WebView(script: script, edge: layout.edge, background: layout.background)
                        .ignoresSafeArea(.container, edges: layout.edge ? .all : [])
                } else {
                    Color.clear
                }
                if band {
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
            .ignoresSafeArea(layout.keyboardAvoid ? [] : .keyboard)
            if !band { BroadcastButton().frame(width: 1, height: 1).opacity(0.01) }
            RoutePicker().frame(width: 1, height: 1).opacity(0.01)
        }
        .statusBarHidden(layout.statusBarHidden)
        .persistentSystemOverlays(layout.homeIndicatorHidden ? .hidden : .automatic)
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
            DeviceState.shared.scene = phase == .active ? "active" : phase == .background ? "background" : "inactive"
        }
        .task {
            script = await userScript()
            ready = true
            // iOS's broadcast sheet 2 s after the page is up, so it need not be hunted for, unless
            // the page's "broadcast" message has set "manual" (UserDefaults broadcast.prompt).
            try? await Task.sleep(for: .seconds(2))
            // A broadcast from before the app closed reconnects within that time (the extension
            // tries every second): the sheet would only offer to stop it.
            if AudioServer.shared.connected { HostLog.shared.log("broadcast: already running, no picker"); return }
            if UserDefaults.standard.string(forKey: "broadcast.prompt") == "manual" {
                HostLog.shared.log("broadcast: manual, no picker")
                return
            }
            guard WebHolder.shared.showPicker() else { return }
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

// AirPlay's route picker, all but invisible in the corner, for the page's "routepicker" message to tap.
struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        WebHolder.shared.routePicker = picker
        return picker
    }

    func updateUIView(_ picker: AVRoutePickerView, context: Context) {}
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
    let background: Color

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop
        for name in ["log", "volume", "open", "layout", "showlog", "haptic", "awake", "statusbar", "orientation",
                     "broadcast", "brightness", "share", "homeindicator", "host", "reset", "viewport", "proximity",
                     "hapticpattern", "sound", "routepicker", "audiosession", "notify", "appearance", "clipboard",
                     "band", "background", "keyboard", "scroll", "lstoken", "speaker"] {
            config.userContentController.add(context.coordinator, name: name)
        }
        if let script {
            config.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let web = InsetWebView(frame: .zero, configuration: config)
        // Spotify serves the web player to desktop browsers only; the overlay covers the desktop
        // layout anyway.
        web.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
        web.isOpaque = false  // the background color, PageLayout's, set in updateUIView
        web.allowsLinkPreview = false  // a long press is the page's, not a link preview
        // The overlay is position:fixed and its panes scroll themselves (the page's "scroll" message
        // turns it on).
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.navigationDelegate = context.coordinator  // the viewport, before the first load
        web.uiDelegate = context.coordinator  // window.prompt as a native alert (the skins have no text field)
        web.load(URLRequest(url: URL(string: "https://open.spotify.com/")!))
        WebHolder.shared.web = web
        return web
    }

    // Edge to edge, WebKit would otherwise still inset the page from the notch and the home indicator
    // (Spotify's viewport is not viewport-fit=cover); the page pads itself by window.__wmpSafeArea.
    // Left as it is by default, and once set kept: inside the safe area the insets are 0. The page's
    // background color, behind its content and in the bars.
    func updateUIView(_ web: WKWebView, context: Context) {
        if edge { web.scrollView.contentInsetAdjustmentBehavior = .never }
        let color = UIColor(background)
        web.backgroundColor = color
        web.scrollView.backgroundColor = color
    }

    // The page's messages (webkit.messageHandlers.<name>.postMessage), on the main thread:
    // log, window.alchemyLog's line; volume, window.alchemySetVolume's level, 0...100; open, an http(s)
    // URL to open outside the app; layout, "edge" or "safe" (PageLayout), the insets pushed again for
    // a page that asks after a reload; showlog, the log sheet. For a phone skin: haptic, a kind for
    // Haptics; awake, "on" or "off", the screen kept from sleeping; statusbar, "hidden" or "shown";
    // orientation, "portrait", "landscape" or "any", the window turned to it and kept there; broadcast,
    // "picker" (the broadcast sheet, start or stop), "auto" or "manual" (the sheet at launch or not,
    // kept in UserDefaults broadcast.prompt), "state" (AudioServer.pushState now); brightness, 0...1
    // (a number or its string) or "state"; share, a text or URL for the share sheet; homeindicator,
    // "hidden" or "shown"; host, everything DeviceState pushes; reset, the website data cleared and
    // the page reloaded (Spotify signed out). open also takes "settings", the app's page in Settings.
    // viewport, "mobile" or "desktop", kept and the page reloaded when it changes; hapticpattern, JSON for
    // HapticPatterns; sound, a system sound id; routepicker, AirPlay's picker; audiosession, "solo", "mix"
    // or "duck"; notify, JSON for notify(_:) or "cancel:<id>"; appearance, "light", "dark" or "auto";
    // clipboard, a text copied; band, "hidden" or "shown"; background, "#rrggbb" or "#rgb"; keyboard,
    // "ignore" or "avoid"; scroll, "on" or "off", the web view's own scrolling and bounce.
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        /// window.prompt(text, default), as the system alert with a text field; nil on Cancel.
        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            guard var top = webView.window?.rootViewController else { completionHandler(nil); return }
            while let p = top.presentedViewController { top = p }
            let a = UIAlertController(title: prompt, message: nil, preferredStyle: .alert)
            a.addTextField { $0.text = defaultText }
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
            top.present(a, animated: true)
        }

        // Each navigation in the stored viewport's content mode; the desktop user agent stays either way.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     preferences: WKWebpagePreferences,
                     decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
            preferences.preferredContentMode = PageLayout.viewport == "mobile" ? .mobile : .desktop
            decisionHandler(.allow, preferences)
        }

        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            switch message.name {
            case "volume":
                // A JS number arrives as an NSNumber; a numeric string is taken too.
                guard let n = (message.body as? NSNumber)?.doubleValue ?? (message.body as? String).flatMap({ Double($0) }),
                      n.isFinite else { return }
                SystemVolume.shared.set(Int(min(max(n, 0), 100).rounded()))
            case "open":
                if message.body as? String == "settings" {
                    HostLog.shared.log("open: settings", quiet: true)
                    UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
                    return
                }
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
            case "haptic":
                guard let kind = message.body as? String else { return }
                Haptics.shared.play(kind)
            case "awake":
                guard let s = message.body as? String, s == "on" || s == "off" else { return }
                HostLog.shared.log("awake: \(s)", quiet: true)
                UIApplication.shared.isIdleTimerDisabled = s == "on"
            case "statusbar":
                guard let s = message.body as? String, s == "hidden" || s == "shown" else { return }
                HostLog.shared.log("statusbar: \(s)", quiet: true)
                PageLayout.shared.statusBarHidden = s == "hidden"
            case "orientation":
                let masks: [String: UIInterfaceOrientationMask] =
                    ["portrait": .portrait, "landscape": .landscape, "any": .allButUpsideDown]
                guard let s = message.body as? String, let mask = masks[s] else { return }
                HostLog.shared.log("orientation: \(s)", quiet: true)
                PageLayout.shared.orientations = mask
                // iOS asks AppDelegate again, then turns the window if it is outside the new mask; a
                // refused turn (an iPad in Split View, say) is left be.
                let scene = windowScene()
                scene?.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                scene?.requestGeometryUpdate(UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: mask))
            case "broadcast":
                guard let s = message.body as? String else { return }
                switch s {
                case "picker":
                    // Paired, the visualizers hear librespot instead: no sheet (the band's button still
                    // opens it).
                    if Librespot.shared.paired {
                        HostLog.shared.log("broadcast: librespot paired, no picker")
                    } else {
                        WebHolder.shared.showPicker()
                    }
                case "auto", "manual":
                    HostLog.shared.log("broadcast: \(s)", quiet: true)
                    UserDefaults.standard.set(s, forKey: "broadcast.prompt")
                case "state":
                    AudioServer.shared.pushState()
                default:
                    break
                }
            case "proximity":
                let on = (message.body as? String) == "on"
                UIDevice.current.isProximityMonitoringEnabled = on
                HostLog.shared.log("proximity: \(on ? "on" : "off")", quiet: true)
            case "brightness":
                // observer.js posts the level as a string.
                if let n = (message.body as? NSNumber)?.doubleValue ?? (message.body as? String).flatMap({ Double($0) }),
                   n.isFinite, let screen = windowScene()?.screen {
                    HostLog.shared.log("brightness: \(n)", quiet: true)
                    screen.brightness = CGFloat(min(max(n, 0), 1))
                } else if message.body as? String == "state" {
                    DeviceState.shared.pushBrightness()
                }
            case "share":
                guard let s = message.body as? String, !s.isEmpty,
                      let root = windowScene()?.keyWindow?.rootViewController else { return }
                HostLog.shared.log("share: \(s.prefix(80))", quiet: true)
                let sheet = UIActivityViewController(activityItems: [s], applicationActivities: nil)
                // An iPad shows it as a popover, centered with no arrow; an iPhone ignores this.
                if let popover = sheet.popoverPresentationController {
                    popover.sourceView = root.view
                    popover.sourceRect = CGRect(x: root.view.bounds.midX, y: root.view.bounds.midY, width: 0, height: 0)
                    popover.permittedArrowDirections = []
                }
                root.present(sheet, animated: true)
            case "homeindicator":
                guard let s = message.body as? String, s == "hidden" || s == "shown" else { return }
                HostLog.shared.log("homeindicator: \(s)", quiet: true)
                PageLayout.shared.homeIndicatorHidden = s == "hidden"
            case "host":
                DeviceState.shared.pushAll()
            case "reset":
                WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
                                                        modifiedSince: .distantPast) {
                    HostLog.shared.log("reset: website data cleared", quiet: true)
                    WebHolder.shared.web?.reload()
                }
            case "viewport":
                // Only a change reloads: a page that sends its viewport at every load would loop.
                guard let s = message.body as? String, s == "mobile" || s == "desktop", s != PageLayout.viewport else { return }
                HostLog.shared.log("viewport: \(s)", quiet: true)
                UserDefaults.standard.set(s, forKey: "viewport")
                WebHolder.shared.web?.reload()
            case "hapticpattern":
                guard let json = message.body as? String else { return }
                HapticPatterns.shared.play(json)
            case "sound":
                // observer.js posts the id as a string.
                guard let id = (message.body as? NSNumber)?.uint32Value ?? (message.body as? String).flatMap({ UInt32($0) })
                else { return }
                HostLog.shared.logOnce("sound: \(id)")
                AudioServicesPlaySystemSound(SystemSoundID(id))
            case "routepicker":
                HostLog.shared.log("routepicker: shown", quiet: true)
                let views = WebHolder.shared.routePicker?.subviews ?? []
                for case let b as UIButton in views { b.sendActions(for: .touchUpInside) }
            case "audiosession":
                let options: [String: AVAudioSession.CategoryOptions] = ["solo": [], "mix": [.mixWithOthers], "duck": [.duckOthers]]
                guard let s = message.body as? String, let o = options[s] else { return }
                HostLog.shared.log("audiosession: \(s)", quiet: true)
                try? AVAudioSession.sharedInstance().setCategory(.playback, options: o)
                try? AVAudioSession.sharedInstance().setActive(true)
            case "notify":
                guard let s = message.body as? String else { return }
                notify(s)
            case "appearance":
                let styles: [String: UIUserInterfaceStyle] = ["light": .light, "dark": .dark, "auto": .unspecified]
                guard let s = message.body as? String, let style = styles[s] else { return }
                HostLog.shared.log("appearance: \(s)", quiet: true)
                windowScene()?.keyWindow?.overrideUserInterfaceStyle = style
            case "clipboard":
                guard let s = message.body as? String else { return }
                HostLog.shared.log("clipboard: \(s.count) characters", quiet: true)
                UIPasteboard.general.string = s
            case "band":
                guard let s = message.body as? String, s == "hidden" || s == "shown" else { return }
                HostLog.shared.log("band: \(s)", quiet: true)
                PageLayout.shared.bandHidden = s == "hidden"
            case "background":
                guard let s = message.body as? String, let color = hexColor(s) else { return }
                HostLog.shared.log("background: \(s)", quiet: true)
                PageLayout.shared.background = color
            case "keyboard":
                guard let s = message.body as? String, s == "ignore" || s == "avoid" else { return }
                HostLog.shared.log("keyboard: \(s)", quiet: true)
                PageLayout.shared.keyboardAvoid = s == "avoid"
            case "scroll":
                guard let s = message.body as? String, s == "on" || s == "off",
                      let scroll = WebHolder.shared.web?.scrollView else { return }
                HostLog.shared.log("scroll: \(s)", quiet: true)
                scroll.isScrollEnabled = s == "on"
                scroll.bounces = s == "on"
            case "lstoken":
                guard let s = message.body as? String, !s.isEmpty else { return }
                Librespot.shared.token(s)
            case "speaker":
                guard let s = message.body as? String, !s.isEmpty else { return }
                Librespot.shared.rename(s)
            default:
                HostLog.shared.log("page: \(message.body)")
            }
        }
    }
}

// The page's local notification ("notify" message): {"title","body","seconds","id"}, shown that many
// seconds on (1 at least), a later one with the same id replacing it; "cancel:<id>" drops it before it
// shows. iOS asks the user to allow notifications the first time only. While the app is in front a
// notification is not shown (no UNUserNotificationCenterDelegate).
func notify(_ body: String) {
    let center = UNUserNotificationCenter.current()
    if body.hasPrefix("cancel:") {
        let id = String(body.dropFirst("cancel:".count))
        HostLog.shared.log("notify: cancel \(id)", quiet: true)
        center.removePendingNotificationRequests(withIdentifiers: [id])
        return
    }
    struct Note: Decodable { let title, body: String; let seconds: Double; let id: String }
    guard let note = try? JSONDecoder().decode(Note.self, from: Data(body.utf8)), note.seconds.isFinite else { return }
    HostLog.shared.log("notify: \(note.id) in \(max(note.seconds, 1)) s", quiet: true)
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
        guard granted else { HostLog.shared.log("notify: not allowed", quiet: true); return }
        let content = UNMutableNotificationContent()
        content.title = note.title
        content.body = note.body
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(note.seconds, 1), repeats: false)
        center.add(UNNotificationRequest(identifier: note.id, content: content, trigger: trigger))
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
        // The first responder, so that a shake reaches motionEnded (WebKit hands this on to its
        // content view, which passes the motion up to here).
        if window != nil { becomeFirstResponder() }
    }

    override var canBecomeFirstResponder: Bool { true }

    // A shake: a "wmp-shake" event on window.
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { evaluateJavaScript("window.dispatchEvent(new Event('wmp-shake'))", completionHandler: nil) }
        super.motionEnded(motion, with: event)
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
// Every change, the hardware buttons' included, goes back to the page as __wmpVolume (DeviceState).
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
                self.pushState()
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

    // Once per socket: the broadcast ended (or the extension died), so the page goes silent. A socket
    // already replaced changes nothing, `connected` included: it is the newer socket's.
    private func drop(_ c: NWConnection) {
        guard c === source else { return }
        connected = false
        source = nil
        c.cancel()
        HostLog.shared.log("audio: extension disconnected")
        pushState()
        Forwarder.shared.stopped()
    }

    /// From any thread: whether a broadcast is running, to the page as window.__wmpBroadcast =
    /// {running}, then a "wmp-broadcast" event on window. At each change and on the page's "state".
    func pushState() {
        WebHolder.shared.push("__wmpBroadcast", "wmp-broadcast", ["running": connected])
    }
}

// The audio into the page by evaluateJavaScript (WebKit refuses ws:// from Spotify's https page), to
// the stand-in socket observer.js puts in its place: __wmpAudio.rate(n) when the source says it, then
// every 100 ms __wmpAudio.pcm(<base64 interleaved stereo int16 LE>, n) with all that came in since, so
// evaluateJavaScript runs 10 times a second and not once per buffer (43). The rate rides along for a
// stand-in opened later (a reload). Two sources: the broadcast extension (AudioServer) and librespot
// (Librespot); while librespot plays the page gets its audio only, the broadcast's dropped. All state
// is on `queue`.
final class Forwarder {
    static let shared = Forwarder()
    enum Source { case broadcast, librespot }
    private let queue = DispatchQueue(label: "audio-forwarder")
    private var sampleRate = 0
    private var pending = Data()
    private var timer: DispatchSourceTimer?
    private var live = Source.broadcast  // whose audio the page gets
    private var rates: [Source: Int] = [:]  // each source's latest rate

    func rate(_ n: Int, from source: Source = .broadcast) {
        queue.async {
            self.rates[source] = n
            guard source == self.live else { return }
            self.sampleRate = n
            WebHolder.shared.run("__wmpAudio.rate(\(n))")
        }
    }

    func pcm(_ data: Data, from source: Source = .broadcast) {
        queue.async {
            guard source == self.live else { return }
            self.pending.append(data)
            guard self.timer == nil else { return }
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
            timer.setEventHandler { self.flush() }
            timer.resume()
            self.timer = timer
        }
    }

    /// The source stopped: what is left, then 4096 frames of silence so the visualizers go dark
    /// instead of holding the last spectrum. No __wmpAudio.close(): the page opens its stand-in once,
    /// and the next broadcast carries on in it.
    func stopped(from source: Source = .broadcast) {
        queue.async {
            guard source == self.live else { return }
            self.timer?.cancel()
            self.timer = nil
            self.flush()
            self.pending = Data(count: 4096 * 2 * 2)
            self.flush()
        }
    }

    /// librespot started or stopped playing: the page takes its audio, or the broadcast's again (at
    /// the broadcast's rate, when one has said it).
    func prefer(librespot: Bool) {
        queue.async {
            let source: Source = librespot ? .librespot : .broadcast
            guard source != self.live else { return }
            self.live = source
            self.pending.removeAll()
            guard let n = self.rates[source] else { return }
            self.sampleRate = n
            WebHolder.shared.run("__wmpAudio.rate(\(n))")
        }
    }

    private func flush() {
        defer { pending.removeAll(keepingCapacity: true) }
        guard !pending.isEmpty, sampleRate > 0 else { return }
        WebHolder.shared.run("__wmpAudio.pcm('\(pending.base64EncodedString())', \(sampleRate))")
    }
}

// The app as a Spotify Connect receiver (ios/librespot, ios/README.md "Librespot (branch)"): librespot
// shows the app to the Spotify app on the network as "WMP Spotify", takes the credentials it hands over
// the first time it is picked (cached in Application Support/librespot, so later launches connect at
// once), and hands its PCM here on its player thread. That plays through an AVAudioEngine in the app's
// own .playback session and goes to the page's visualizers through Forwarder, in place of the
// broadcast's while it plays. The callback blocks while half a second is queued: that is what paces
// librespot's decoding.
final class Librespot {
    static let shared = Librespot()
    private static let cache = URL.applicationSupportDirectory.appending(path: "librespot")
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    private let room = NSCondition()  // guards `queued`
    private var queued = 0            // frames scheduled and not yet played
    private var playing = false       // on librespot's player thread only

    /// Credentials cached by an earlier pick in the Spotify app.
    var paired: Bool { FileManager.default.fileExists(atPath: Self.cache.appending(path: "credentials.json").path) }

    private var lastToken = ""  // on the main thread
    private var deviceId: String?  // on the main thread: librespot's Connect device id while its session is up

    /// The speaker's name in Spotify's pickers, the page's to set (alchemySpeakerName). The phone's own
    /// name is "iPhone" or "iPad" to apps since iOS 16 without an entitlement Apple grants on request.
    var name: String { UserDefaults.standard.string(forKey: "speaker.name") ?? "WMP Spotify (iOS)" }

    /// window.__wmpSpeaker = {id, name} and 'wmp-speaker', to the page.
    func push() {
        WebHolder.shared.push("__wmpSpeaker", "wmp-speaker", ["id": deviceId ?? NSNull(), "name": name] as [String: Any])
    }

    /// On the main thread: a new name from the page, kept; the receiver restarts under it (its device
    /// id, from the install, stays).
    func rename(_ n: String) {
        guard n != name else { return }
        UserDefaults.standard.set(n, forKey: "speaker.name")
        HostLog.shared.log("speaker: renamed to \(n)")
        deviceId = nil
        push()
        wmp_ls_stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.start() }
    }

    /// On the main thread: the web player's access token (the "lstoken" message,
    /// "<clientId> <clientToken> <token>"), which librespot serves to Spotify's services in place of
    /// its own, logs in with when it has no session, and keeps for its next reconnect when it has one
    /// (wmp_librespot.h). Never logged.
    func token(_ body: String) {
        guard body != lastToken else { return }  // the page repeats the same token
        lastToken = body
        let parts = body.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        let (client, clientToken, t) = parts.count == 3 ? (parts[0], parts[1], parts[2]) : ("", "", parts.last ?? body)
        HostLog.shared.log("librespot: token received (client id \(client.isEmpty ? "none" : client), client token \(clientToken.isEmpty ? "none" : "\(clientToken.count) chars"))")
        wmp_ls_token(t, client, clientToken)
    }

    /// On the main thread, once, with the audio session active.
    func start() {
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        output()
        Forwarder.shared.rate(44100, from: .librespot)
        try? FileManager.default.createDirectory(at: Self.cache, withIntermediateDirectories: true)
        let id = UIDevice.current.identifierForVendor?.uuidString ?? name
        let started = wmp_ls_start(name, id, Self.cache.path, { _, samples, frames in
            Librespot.shared.take(samples, frames)
        }, { _, line in
            if let line { HostLog.shared.log(String(cString: line)) }
        }, { _, id in
            let s = id.map { String(cString: $0) }
            DispatchQueue.main.async {
                Librespot.shared.deviceId = s
                Librespot.shared.push()
            }
        }, nil)
        if started != 0 { HostLog.shared.log("librespot: not started") }
    }

    // ponytail: the engine runs from launch to the end, rendering silence between songs, which keeps the
    // app and its Connect session awake in the background at some battery cost; stop it on a long
    // pause if that matters. Started again here after an interruption or a route change stopped it.
    private func output() {
        guard !engine.isRunning else { return }
        do {
            try engine.start()
            node.play()
        } catch {
            HostLog.shared.log("librespot: output failed: \(error.localizedDescription)")
        }
    }

    // librespot's player thread. No samples: the sink stopped (a pause, a stop), so what is queued is
    // dropped and the page goes back to the broadcast, dark until one runs.
    private func take(_ samples: UnsafePointer<Float>?, _ frames: Int) {
        guard let samples, frames > 0 else {
            playing = false
            node.stop()
            if engine.isRunning { node.play() }
            Forwarder.shared.stopped(from: .librespot)
            Forwarder.shared.prefer(librespot: false)
            return
        }
        if !playing {
            playing = true
            Forwarder.shared.prefer(librespot: true)
        }
        output()
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
              let channels = buffer.floatChannelData else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        // The page's int16 the way SampleHandler.stereo makes it: clamped first, so the product fits
        // (NaN comes out as 1).
        var pcm = [Int16](repeating: 0, count: frames * 2)
        for i in 0..<frames {
            for c in 0..<2 {
                let f = samples[i * 2 + c]
                channels[c][i] = f
                pcm[i * 2 + c] = Int16(max(-1, min(1, f)) * 32767)
            }
        }
        let data = pcm.withUnsafeBufferPointer { Data(buffer: $0) }
        // Half a second queued at most; a second's wait at most, in case the engine stopped (output()
        // starts it again at the next packet).
        room.lock()
        while queued > 22050, room.wait(until: Date() + 1) {}
        queued += frames
        room.unlock()
        // To the page as it is heard, so the visualizers keep time with the speaker.
        node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { _ in
            Forwarder.shared.pcm(data, from: .librespot)
            self.room.lock()
            self.queued -= frames
            self.room.signal()
            self.room.unlock()
        }
    }
}
