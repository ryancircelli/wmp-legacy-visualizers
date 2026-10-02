// The iOS host (CONTRACT.md v6.1): Spotify's own web player in one WKWebView, with our page
// mounted over it by observer.js. A launch starts at once from the page's bundle and observer.js as
// the last launch saved them, and fetches the site's behind it (userScript, PageUpdate).
import AVFoundation
import AVKit
import AudioToolbox
import CoreHaptics
import MediaPlayer
import SwiftUI
import UIKit
import UserNotifications
import WebKit

@main
struct WmpSpotifyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate

    init() {
        // .playback: the music keeps going with the screen locked, in the background
        // (UIBackgroundModes audio) and with the mute switch on.
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        HostLog.shared.log("host: build \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")")
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

// The one web view and AirPlay's route picker, used on the main thread: a tap on the log row reloads
// the web view, Forwarder feeds the page through it, and the "routepicker" message taps the picker.
final class WebHolder {
    static let shared = WebHolder()
    weak var web: WKWebView?
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
}

// The host's log. print reaches nobody on a TestFlight install, so Player shows the last line under
// the web view and the whole log on a long press. It persists in host.log in the App Group container
// (Application Support without one), the last 3000 lines kept.
/// A log line's kind for the sheet's filter: the word after the time ("librespot", "scene"), the page's lines
/// split one further ("page: spotify", "page: perf"); nil for the launch markers.
func logKind(_ line: String) -> String? {
    let body = line.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
    guard body.count == 2, !body[1].hasPrefix("----") else { return nil }
    let parts = body[1].split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
    guard parts.count >= 2 else { return String(body[1]) }
    let first = parts[0].trimmingCharacters(in: .whitespaces)
    if first == "page", parts.count == 3 { return "page: " + parts[1].trimmingCharacters(in: .whitespaces) }
    return first
}

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
}

// The app's window scene (it has one).
func windowScene() -> UIWindowScene? {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
}

// A file in the App Group container; nil without the entitlement. The group was made for the broadcast
// extension, gone since 2026-10-02, and stays: host.log lives in its container, so moving it would lose
// the log at the update, and the App ID's provisioning already carries the group.
func groupPath(_ name: String) -> String? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.rcircelli.wmpspotify")?
        .appendingPathComponent(name).path
}

// What the page sets of the host's window, by script message, on the main thread ("layout",
// "showlog", "statusbar", "homeindicator", "orientation", "band", "background", "keyboard"). Not
// SwiftUI's Layout, hence the name. All but "showlog" shape the first frame, so they are kept in
// UserDefaults and applied again when the app starts, before the web view first shows: a relaunch
// starts in the page's last layout instead of the default one until the page sends them again.
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

    private static let kept = ["layout", "statusbar", "homeindicator", "band", "orientation", "background", "keyboard"]
    private static let masks: [String: UIInterfaceOrientationMask] =
        ["portrait": .portrait, "landscape": .landscape, "any": .allButUpsideDown]

    /// The last launch's layout, from the first use (Player's first frame, or AppDelegate's first ask).
    private init() {
        for name in Self.kept {
            if let s = UserDefaults.standard.string(forKey: "page.\(name)") { apply(name, s) }
        }
    }

    /// On the main thread: one of the kept messages from the page, applied, logged and kept for the
    /// next launch; false (and dropped) when `s` is none of its values.
    @discardableResult
    func set(_ name: String, _ s: String) -> Bool {
        guard apply(name, s) else { return false }
        HostLog.shared.log("\(name): \(s)", quiet: true)
        UserDefaults.standard.set(s, forKey: "page.\(name)")
        return true
    }

    @discardableResult
    private func apply(_ name: String, _ s: String) -> Bool {
        switch (name, s) {
        case ("layout", "edge"), ("layout", "safe"): edge = s == "edge"
        case ("statusbar", "hidden"), ("statusbar", "shown"): statusBarHidden = s == "hidden"
        case ("homeindicator", "hidden"), ("homeindicator", "shown"): homeIndicatorHidden = s == "hidden"
        case ("band", "hidden"), ("band", "shown"): bandHidden = s == "hidden"
        case ("keyboard", "ignore"), ("keyboard", "avoid"): keyboardAvoid = s == "avoid"
        case ("orientation", _):
            guard let mask = Self.masks[s] else { return false }
            orientations = mask
        case ("background", _):
            guard let color = hexColor(s) else { return false }
            background = color
        default:
            return false
        }
        return true
    }
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
    /// screen's most), voiceOver, viewport}, then every report and the speaker: what a page asks for
    /// once at load.
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
        Librespot.shared.push()
    }
}

struct Player: View {
    @State private var hiddenKinds: Set<String> = []
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
            // "background" color, black by default), the host's last log line under it, 44 pt high
            // (the height it had with the broadcast picker at its right end, so the page's size is
            // unchanged). Edge to edge (the page's "layout" message) the web view fills the screen and
            // the band is gone, as it is when the page's "band" message hides it. The web view is the
            // same one in all of these, never rebuilt. The keyboard covers the page and moves nothing
            // (on Spotify's player with the page's scrolling off, not even WebKit's scroll to the
            // focused field: InsetWebView.watchKeyboard), unless the page's "keyboard" message has set
            // "avoid": the layout then shrinks to above the keyboard (the web view ignores only the
            // container's safe area edge to edge, never the keyboard's).
            VStack(spacing: 0) {
                if ready {
                    WebView(script: script, background: layout.background)
                        .ignoresSafeArea(.container, edges: layout.edge ? .all : [])
                } else {
                    Color.clear
                }
                if band {
                    Text(log.last)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.gray)
                        .lineLimit(1)
                        .truncationMode(.head)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .frame(height: 44)
                        .contentShape(Rectangle())
                        .onTapGesture { reload() }
                        .onLongPressGesture { layout.showLog = true }
                }
            }
            .ignoresSafeArea(layout.keyboardAvoid ? [] : .keyboard)
            RoutePicker().frame(width: 1, height: 1).opacity(0.01)
        }
        .statusBarHidden(layout.statusBarHidden)
        .persistentSystemOverlays(layout.homeIndicatorHidden ? .hidden : .automatic)
        .sheet(isPresented: $layout.showLog) {
            // The lines a kind at a time (the owner: "filter log types so i can copy subsets"): a chip per kind
            // seen (the word after the time, "page: spotify" and the like split one further), tapped off and
            // on; Copy and Copy All take the kinds shown. The launch markers always show.
            let kinds = Array(Set(log.lines.compactMap(logKind))).sorted()
            let shown = log.lines.filter { line in logKind(line).map { !hiddenKinds.contains($0) } ?? true }
            VStack(spacing: 0) {
                HStack(spacing: 24) {
                    // Copy: this launch's lines (from its "---- launch" marker), what a report needs; Copy All: the file.
                    Button("Copy") {
                        let from = shown.lastIndex { $0.contains("---- launch ") } ?? shown.startIndex
                        UIPasteboard.general.string = shown[from...].joined(separator: "\n")
                    }
                    Button("Copy All") { UIPasteboard.general.string = shown.joined(separator: "\n") }
                    Button("Clear") { HostLog.shared.clear() }
                    Spacer()
                }
                .padding()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(kinds, id: \.self) { kind in
                            let on = !hiddenKinds.contains(kind)
                            Button(kind) { if on { hiddenKinds.insert(kind) } else { hiddenKinds.remove(kind) } }
                                .font(.system(size: 12))
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(on ? Color.accentColor.opacity(0.2) : Color.gray.opacity(0.15), in: Capsule())
                                .foregroundStyle(on ? Color.accentColor : .gray)
                        }
                        if !hiddenKinds.isEmpty { Button("all") { hiddenKinds = [] }.font(.system(size: 12)) }
                    }
                    .padding(.horizontal)
                }
                .padding(.bottom, 8)
                // A Text per line, laid out lazily: 3000 lines in one Text would all be laid out again at
                // every new line.
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(shown.enumerated()), id: \.offset) { _, line in Text(line) }
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
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            HostLog.shared.log("scene: \(phase)", quiet: true)
            DeviceState.shared.scene = phase == .active ? "active" : phase == .background ? "background" : "inactive"
        }
        .task {
            script = await userScript()
            ready = true
        }
    }

    // The page again from the top: its overlay, its stand-in audio socket, Spotify's own state.
    private func reload() {
        HostLog.shared.log("reload: the page")
        WebHolder.shared.web?.reload()
    }
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

// The page's two files on wmp.ryancircelli.com (the observer is dist/ios-observer.js, the same file as
// observer.js), each taken only when it parses, since a captive portal answers 200 too: the bundle
// when its JSON decodes, the observer when it is our script and not an error page.
let bundleFile = "spotify-inject.js", observerFile = "ios-observer.js"
func parseBundle(_ data: Data) -> Inject? { try? JSONDecoder().decode(Inject.self, from: data) }
func parseObserver(_ data: Data) -> String? {
    guard let text = String(data: data, encoding: .utf8),
          text.contains("location.hostname !== 'open.spotify.com'") else { return nil }
    return text
}

// The last copy of `name` fetched from the site, kept in Application Support; the builds before kept it
// in Caches, read when there is none, so the first launch after the update starts at once too.
func savedFile(_ name: String) -> Data? {
    (try? Data(contentsOf: URL.applicationSupportDirectory.appending(path: name)))
        ?? (try? Data(contentsOf: URL.cachesDirectory.appending(path: name)))
}

// `name` from wmp.ryancircelli.com when it answers 200 with a body `parse` takes, that body then saved
// for the next launch (savedFile); nil when it does not (offline, an error page).
func siteFile<T: Sendable>(_ name: String, _ parse: @escaping @Sendable (Data) -> T?) async -> (data: Data, value: T)? {
    let request = URLRequest(url: URL(string: "https://wmp.ryancircelli.com/\(name)")!,
                             cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
    guard case let (data, response)? = try? await URLSession.shared.data(for: request),
          (response as? HTTPURLResponse)?.statusCode == 200, let value = parse(data) else { return nil }
    let dir = URL.applicationSupportDirectory
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try? data.write(to: dir.appending(path: name), options: .atomic)
    return (data, value)
}

// observer.js wrapped round the bundle as its header says: the user script.
func wrap(_ inject: Inject, _ observer: String) -> String? {
    guard let html = try? JSONEncoder().encode(inject.html),
          let css = try? JSONEncoder().encode(inject.css) else { return nil }
    return """
        (function (HTML, CSS, RUN) {
        \(observer)
        })(\(String(decoding: html, as: UTF8.self)), \(String(decoding: css, as: UTF8.self)), function () { "use strict";
        \(inject.js)
        });
        """
}

// This launch's user script, or nil without a bundle: the web player then shows bare, without the
// overlay. From the copies the last launch saved when there are any, at once, with no network wait
// (the observer built into the app standing in for one never saved), the site's then fetched behind
// it (PageUpdate). With no bundle saved (the first launch), the site's, waited for, the built-in
// observer the fallback. The log says where each came from.
func userScript() async -> String? {
    let bundled = Bundle.main.url(forResource: "observer", withExtension: "js")
        .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
    if let data = savedFile(bundleFile), let inject = parseBundle(data) {
        let saved = savedFile(observerFile).flatMap(parseObserver)
        HostLog.shared.log("page: bundle from cache")
        HostLog.shared.log("page: observer from \(saved == nil ? "bundled" : "cache")")
        guard let observer = saved ?? bundled else { return nil }
        Task.detached { await PageUpdate.shared.check(bundle: data, observer: observer) }
        return wrap(inject, observer)
    }
    async let fetchedBundle = siteFile(bundleFile, parseBundle)
    async let fetchedObserver = siteFile(observerFile, parseObserver)
    let site = await fetchedBundle?.value, fetched = await fetchedObserver?.value
    HostLog.shared.log("page: bundle from \(site == nil ? "none" : "site")")
    HostLog.shared.log("page: observer from \(fetched != nil ? "site" : bundled != nil ? "bundled" : "none")")
    guard let inject = site, let observer = fetched ?? bundled else { return nil }
    return wrap(inject, observer)
}

// The site's copies of the page, fetched behind a launch that started from the saved ones
// (userScript); each that parses is saved for the next launch (siteFile). One that differs from what
// this launch runs goes into the web view's user script, so the page's next load (a reload) runs it,
// but only once the page has mounted: sooner, it could reach the document this launch is still
// loading, which would then be refreshed for nothing. A new bundle also refreshes the mounted page in
// place (observer.js's alchemyRestart: it fetches the bundle again and remounts the page without
// stopping the music). A new observer cannot be swapped into a live document: it runs from the next load.
final class PageUpdate {
    static let shared = PageUpdate()
    private var mounted = false  // on the main thread: an overlay has mounted
    private var update: (script: String, refresh: Bool)?  // on the main thread: waiting for the mount

    /// Behind the launch: `bundle` and `observer` are what this launch runs.
    func check(bundle: Data, observer: String) async {
        async let fetchedBundle = siteFile(bundleFile, parseBundle)
        async let fetchedObserver = siteFile(observerFile, parseObserver)
        let site = await fetchedBundle, siteObserver = await fetchedObserver?.value
        let newBundle: Inject? = site.flatMap { $0.data == bundle ? nil : $0.value }
        let newObserver: String? = siteObserver == observer ? nil : siteObserver
        HostLog.shared.log("page: bundle on site \(site == nil ? "not fetched" : newBundle == nil ? "unchanged" : "updated")", quiet: true)
        HostLog.shared.log("page: observer on site \(siteObserver == nil ? "not fetched" : newObserver == nil ? "unchanged" : "updated")", quiet: true)
        if newObserver != nil { HostLog.shared.log("page: observer updated from site: runs from the next load") }
        guard newBundle != nil || newObserver != nil,
              let inject = newBundle ?? parseBundle(bundle),
              let script = wrap(inject, newObserver ?? observer) else { return }
        DispatchQueue.main.async {
            self.update = (script, newBundle != nil)
            self.apply()
        }
    }

    /// On the main thread: an overlay mounted (observer.js's "overlay mounted" log line).
    func pageMounted() {
        mounted = true
        apply()
    }

    private func apply() {
        guard mounted, let update, let web = WebHolder.shared.web else { return }
        self.update = nil
        let scripts = web.configuration.userContentController
        scripts.removeAllUserScripts()
        scripts.addUserScript(WKUserScript(source: update.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        guard update.refresh else { return }
        HostLog.shared.log("page: bundle updated from site: refreshing in place")
        // Not at "overlay mounted" itself: the bundle has only begun mounting then (window.Alchemy, its
        // unmount, comes after its first render) and starts its adapter a frame after that render
        // (src/app/mount.tsx), so a refresh any sooner would leave the old page running behind the new
        // one. ponytail: half a second's margin past window.Alchemy, not a signal from the page.
        WebHolder.shared.run("""
            (function go(n) { if (window.Alchemy) setTimeout(function () { window.alchemyRestart && window.alchemyRestart(); }, 500);
            else if (n) setTimeout(go, 100, n - 1); })(100)
            """)
    }
}

struct WebView: UIViewRepresentable {
    let script: String?
    let background: Color

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop
        // No "broadcast" (the retired broadcast sheet): observer.js still posts it once for builds that
        // have the sheet, and here that post throws in the page and is swallowed.
        for name in ["log", "volume", "open", "layout", "showlog", "haptic", "awake", "statusbar", "orientation",
                     "brightness", "share", "homeindicator", "host", "reset", "viewport", "proximity",
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
        // No automatic content insets. Edge to edge, WebKit would otherwise still inset the page from
        // the notch and the home indicator (Spotify's viewport is not viewport-fit=cover); the page pads
        // itself by window.__wmpSafeArea. Inside the safe area they would be 0 anyway, but for the
        // keyboard, which SwiftUI counts in the safe area and which "ignore" leaves over the page.
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.navigationDelegate = context.coordinator  // the viewport, before the first load
        web.uiDelegate = context.coordinator  // window.prompt as a native alert (the skins have no text field)
        // Held still for the keyboard (held): WebKit forwards its scroll view's delegate calls to this
        // one alongside its own.
        web.scrollView.delegate = context.coordinator
        web.watchKeyboard()
        web.load(URLRequest(url: URL(string: "https://open.spotify.com/")!))
        WebHolder.shared.web = web
        return web
    }

    // The page's background color, behind its content and in the bars.
    func updateUIView(_ web: WKWebView, context: Context) {
        let color = UIColor(background)
        web.backgroundColor = color
        web.scrollView.backgroundColor = color
    }

    // The page's messages (webkit.messageHandlers.<name>.postMessage), on the main thread:
    // log, window.alchemyLog's line; volume, window.alchemySetVolume's level, 0...100; open, an http(s)
    // URL to open outside the app; layout, "edge" or "safe" (PageLayout), the insets pushed again for
    // a page that asks after a reload; showlog, the log sheet. For a phone skin: haptic, a kind for
    // Haptics; awake, "on" or "off", the screen kept from sleeping; statusbar, "hidden" or "shown";
    // orientation, "portrait", "landscape" or "any", the window turned to it and kept there; brightness,
    // 0...1 (a number or its string) or "state"; share, a text or URL for the share sheet; homeindicator,
    // "hidden" or "shown"; host, everything DeviceState pushes; reset, the website data cleared and
    // the page reloaded (Spotify signed out). open also takes "settings", the app's page in Settings.
    // viewport, "mobile" or "desktop", kept and the page reloaded when it changes; hapticpattern, JSON for
    // HapticPatterns; sound, a system sound id; routepicker, AirPlay's picker; audiosession, "solo", "mix"
    // or "duck"; notify, JSON for notify(_:) or "cancel:<id>"; appearance, "light", "dark" or "auto";
    // clipboard, a text copied; band, "hidden" or "shown"; background, "#rrggbb" or "#rgb"; keyboard,
    // "ignore" or "avoid"; scroll, "on" or "off", the web view's own scrolling and bounce.
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate {
        /// The web view's scroll view moved: back at rest while it is held (keepAtRest).
        func scrollViewDidScroll(_ scrollView: UIScrollView) { keepAtRest(scrollView) }

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
            case "log":
                let line = "\(message.body)"
                HostLog.shared.log("page: \(line)")
                if line == "spotify: overlay mounted" { PageUpdate.shared.pageMounted() }
            case "layout":
                guard let mode = message.body as? String, PageLayout.shared.set("layout", mode) else { return }
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
            case "statusbar", "homeindicator", "band", "background", "keyboard":
                guard let s = message.body as? String else { return }
                PageLayout.shared.set(message.name, s)
            case "orientation":
                guard let s = message.body as? String, PageLayout.shared.set("orientation", s) else { return }
                // iOS asks AppDelegate again, then turns the window if it is outside the new mask; a
                // refused turn (an iPad in Split View, say) is left be.
                let scene = windowScene()
                scene?.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                scene?.requestGeometryUpdate(UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: PageLayout.shared.orientations))
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
// They are the window's, where the web view overlaps them, and never the keyboard's: SwiftUI counts
// the keyboard in a hosted view's own safeAreaInsets while it shows, and the page would pad itself by it.
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
        guard let window else { return }
        let f = convert(bounds, to: window), s = window.safeAreaInsets, w = window.bounds
        let top = max(0, s.top - f.minY), left = max(0, s.left - f.minX)
        let bottom = max(0, f.maxY - (w.maxY - s.bottom)), right = max(0, f.maxX - (w.maxX - s.right))
        evaluateJavaScript("window.__wmpSafeArea={top:\(top),right:\(right),bottom:\(bottom),left:\(left)};window.dispatchEvent(new Event('wmp-safe-area'))",
                           completionHandler: nil)
    }

    // The keyboard in "ignore" (PageLayout.keyboardAvoid off: the default, and the iPod's) covers the
    // page and moves nothing. WebKit scrolls its scroll view to reveal the focused field (held off as
    // it happens: keepAtRest) and adds the keyboard to the scroll view's bottom inset, which it did not
    // always take back as the keyboard went (seen with the iPod's search: the page short of the
    // screen's bottom by about 26 pt after). The inset is WebKit's own while the keyboard shows; as it
    // hides, after WebKit's handler (a main-actor task runs after the notification's observers), a held
    // scroll view gets back the inset it had before, none (nothing else sets one), and its rest, and the
    // web view is laid out again. The keyboard's showing and hiding are logged, quietly.
    func watchKeyboard() {
        let center = NotificationCenter.default
        center.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { note in
            let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
            HostLog.shared.log("keyboard: shown, \(Int(frame?.height ?? 0)) pt", quiet: true)
        }
        for name in [UIResponder.keyboardWillHideNotification, UIResponder.keyboardDidHideNotification] {
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                if name == UIResponder.keyboardDidHideNotification { HostLog.shared.log("keyboard: hidden", quiet: true) }
                guard let self else { return }
                Task { @MainActor in self.settle() }
            }
        }
    }

    private func settle() {
        guard held(scrollView) else { return }
        if scrollView.contentInset != .zero { scrollView.contentInset = .zero }
        keepAtRest(scrollView)
        setNeedsLayout()
    }
}

// The web view's scroll view is held still for the keyboard: "ignore" (PageLayout.keyboardAvoid off),
// with the page's own scrolling off ("scroll"), on Spotify's player. Spotify's login page (another host)
// keeps WebKit's scroll to its fields, which the keyboard could otherwise cover.
func held(_ scrollView: UIScrollView) -> Bool {
    !PageLayout.shared.keyboardAvoid && !scrollView.isScrollEnabled
        && (scrollView.superview as? WKWebView)?.url?.host() == "open.spotify.com"
}

// A held scroll view back at rest, its content's top left at its own: WebKit's scroll to a focused
// field undone as it happens (Coordinator's scrollViewDidScroll), so the page does not jump as the
// keyboard opens.
func keepAtRest(_ scrollView: UIScrollView) {
    let rest = CGPoint(x: -scrollView.adjustedContentInset.left, y: -scrollView.adjustedContentInset.top)
    if held(scrollView), scrollView.contentOffset != rest { scrollView.contentOffset = rest }
}

// The phone's output volume, which the skin's slider and mute set: a page cannot change its own
// playback volume on iOS. An MPVolumeView's slider is the only way an app can set it, and only while
// the view is in a window, so it sits off screen under the root view. iOS shows its own volume HUD.
// Every change, the hardware buttons' included, goes back to the page as __wmpVolume (DeviceState).
final class SystemVolume {
    static let shared = SystemVolume()
    // In the window, off screen and all but invisible. Its size and touch matter: a 1 x 1 view with
    // touch disabled was found and driven and the system did not follow ("asked 12, the system is at
    // 10", build 37); at this size it did at the first set (build 39). A hidden or fully clear one
    // the system ignores too.
    private let view = MPVolumeView(frame: CGRect(x: -300, y: -300, width: 160, height: 40))
    private var level: Int?  // the latest asked for

    /// On the main thread: the system volume to `pct` (0...100). There is no API for it: apps drive
    /// MPVolumeView's slider.
    func set(_ pct: Int) {
        level = pct
        if view.superview != nil { apply(); return }
        guard let root = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .first?.keyWindow?.rootViewController?.view else { return }
        view.alpha = 0.02
        root.addSubview(view)
        // Its slider does not take a value the moment the view joins the window.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.apply() }
    }

    /// The slider wherever MPVolumeView keeps it (a direct subview once, nested on later systems).
    private func slider(in v: UIView) -> UISlider? {
        if let s = v as? UISlider { return s }
        for sub in v.subviews { if let s = slider(in: sub) { return s } }
        return nil
    }

    private func apply() {
        guard let level else { return }
        guard let s = slider(in: view) else {
            HostLog.shared.logOnce("volume: no slider in MPVolumeView: the system volume cannot be set")
            return
        }
        s.setValue(Float(level) / 100, animated: false)
        s.sendActions(for: .valueChanged)
    }
}

// The audio into the page by evaluateJavaScript (WebKit refuses ws:// from Spotify's https page), to
// the stand-in socket observer.js puts in its place: __wmpAudio.rate(n) once librespot's rate is known,
// then every 100 ms __wmpAudio.pcm(<base64 interleaved stereo int16 LE>, n) with all that was heard
// since, so evaluateJavaScript runs 10 times a second and not once per buffer. The rate rides along
// for a stand-in opened later (a reload). The one source is Librespot, each buffer as it is played.
// All state is on `queue`.
final class Forwarder {
    static let shared = Forwarder()
    private let queue = DispatchQueue(label: "audio-forwarder")
    private var sampleRate = 0
    private var pending = Data()
    private var timer: DispatchSourceTimer?
    // Between started() and stopped(): a buffer whose played-back callback lands after the stop
    // (stopping the player node calls back for what it had queued) is dropped, so the page stays dark.
    private var playing = false

    func rate(_ n: Int) {
        queue.async {
            self.sampleRate = n
            WebHolder.shared.run("__wmpAudio.rate(\(n))")
        }
    }

    /// librespot started playing: its buffers reach the page again.
    func started() {
        queue.async { self.playing = true }
    }

    func pcm(_ data: Data) {
        queue.async {
            guard self.playing else { return }
            self.pending.append(data)
            guard self.timer == nil else { return }
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
            timer.setEventHandler { self.flush() }
            timer.resume()
            self.timer = timer
        }
    }

    /// librespot stopped (a pause, a stop): what is left, then 4096 frames of silence so the
    /// visualizers go dark instead of holding the last spectrum. No __wmpAudio.close(): the page opens
    /// its stand-in once, and the next song carries on in it.
    func stopped() {
        queue.async {
            guard self.playing else { return }
            self.playing = false
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

// The app as a Spotify Connect receiver (ios/librespot, ios/README.md "Librespot"): librespot
// shows the app to the Spotify app on the network as "WMP Spotify", takes the credentials it hands over
// the first time it is picked (cached in Application Support/librespot, so later launches connect at
// once), and hands its PCM here on its player thread. That plays through an AVAudioEngine in the app's
// own .playback session and goes to the page's visualizers through Forwarder. The callback blocks
// while half a second is queued: that is what paces librespot's decoding.
final class Librespot {
    static let shared = Librespot()
    private static let cache = URL.applicationSupportDirectory.appending(path: "librespot")
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    private let room = NSCondition()  // guards `queued`
    private var queued = 0            // frames scheduled and not yet played
    private var playing = false       // on librespot's player thread only

    private var lastToken = ""  // on the main thread
    private var deviceId: String?  // on the main thread: librespot's Connect device id while its session is up
    private var art: (url: String, image: MPMediaItemArtwork?) = ("", nil)  // on the main thread: the last cover

    /// On the main thread (WmpSpotifyApp.init is the first to use `shared`): Control Center's and the lock
    /// screen's buttons go to librespot's session (wmp_ls_command); the ones it has no command for are off.
    private init() {
        let center = MPRemoteCommandCenter.shared()
        let commands = [(center.playCommand, "play"), (center.pauseCommand, "pause"),
                        (center.togglePlayPauseCommand, "toggle"), (center.nextTrackCommand, "next"),
                        (center.previousTrackCommand, "prev")]
        for (command, name) in commands {
            command.isEnabled = true
            command.addTarget { _ in
                HostLog.shared.log("remote: \(name)", quiet: true)
                wmp_ls_command(name)
                return .success
            }
        }
        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            wmp_ls_command("seek:\(Int(event.positionTime * 1000))")
            return .success
        }
        let off: [MPRemoteCommand] = [center.stopCommand, center.skipForwardCommand, center.skipBackwardCommand,
                                      center.seekForwardCommand, center.seekBackwardCommand,
                                      center.changeRepeatModeCommand, center.changeShuffleModeCommand,
                                      center.changePlaybackRateCommand, center.ratingCommand, center.likeCommand,
                                      center.dislikeCommand, center.bookmarkCommand]
        for command in off { command.isEnabled = false }
    }

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
        Forwarder.shared.rate(44100)
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
        }, { _, json in
            guard let json else { return }
            let s = String(cString: json)
            DispatchQueue.main.async { Librespot.shared.nowPlaying(s) }
        }, nil)
        if started != 0 { HostLog.shared.log("librespot: not started") }
    }

    private struct NowPlaying: Decodable {
        let playing: Bool
        let position, duration: Double  // ms
        let title, artist, album, art, uri: String
    }

    /// On the main thread: librespot's now-playing message (wmp_librespot.h) to Control Center and the
    /// lock screen; a stop (no uri) clears them. The cover is fetched once per url and added when it lands.
    private func nowPlaying(_ json: String) {
        guard let np = try? JSONDecoder().decode(NowPlaying.self, from: Data(json.utf8)) else { return }
        // The same facts to the page (window.__wmpSpeakerTrack, 'wmp-speaker-track'): librespot reports only
        // the track's uri to Spotify, so the page's state has no title, cover or duration of its own.
        WebHolder.shared.run("window.__wmpSpeakerTrack=\(json);window.dispatchEvent(new Event('wmp-speaker-track'))")
        let center = MPNowPlayingInfoCenter.default()
        guard !np.uri.isEmpty else {
            center.nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: np.title,
            MPMediaItemPropertyArtist: np.artist,
            MPMediaItemPropertyAlbumTitle: np.album,
            MPMediaItemPropertyPlaybackDuration: np.duration / 1000,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: np.position / 1000,
            MPNowPlayingInfoPropertyPlaybackRate: np.playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if np.art != art.url {
            art = (np.art, nil)
            if let url = URL(string: np.art) {
                URLSession.shared.dataTask(with: url) { data, _, _ in
                    let artwork = data.flatMap(UIImage.init(data:)).map { image in
                        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                    }
                    DispatchQueue.main.async {
                        guard self.art.url == np.art else { return }  // a later cover's
                        guard let artwork else {
                            self.art.url = ""  // failed: the next message tries again
                            return
                        }
                        self.art.image = artwork
                        guard var info = center.nowPlayingInfo else { return }
                        info[MPMediaItemPropertyArtwork] = artwork
                        center.nowPlayingInfo = info
                    }
                }.resume()
            }
        }
        if let image = art.image { info[MPMediaItemPropertyArtwork] = image }
        center.nowPlayingInfo = info
        HostLog.shared.log("nowplaying: \(np.playing ? "playing" : "paused") at \(np.position / 1000) s", quiet: true)
    }

    // ponytail: the engine runs from launch to the end, rendering silence between songs, which keeps the
    // app and its Connect session awake in the background at some battery cost; stop it on a long
    // pause if that matters. Started again here after an interruption or a route change stopped it.
    private func output() {
        guard !engine.isRunning else { return }
        do {
            // Another app's audio (a call, Spotify's own app) leaves the session inactive, and the engine
            // cannot start on an inactive session ('what', 2003329396, a burst of them each time, seen
            // 2026-10-02): the speaker is being played to, so the session is taken back first.
            try AVAudioSession.sharedInstance().setActive(true)
            try engine.start()
            node.play()
            if outputFailed {
                outputFailed = false
                HostLog.shared.log("librespot: output back")
            }
        } catch {
            if !outputFailed {  // once per outage, not once per packet
                outputFailed = true
                HostLog.shared.log("librespot: output failed: \(error.localizedDescription)")
            }
        }
    }
    private var outputFailed = false  // on librespot's player thread, but for the first start

    // librespot's player thread. No samples: the sink stopped (a pause, a stop), so what is queued is
    // dropped and the page goes dark.
    private func take(_ samples: UnsafePointer<Float>?, _ frames: Int) {
        guard let samples, frames > 0 else {
            playing = false
            node.stop()
            if engine.isRunning { node.play() }
            Forwarder.shared.stopped()
            return
        }
        if !playing {
            playing = true
            Forwarder.shared.started()
        }
        output()
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
              let channels = buffer.floatChannelData else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        // The page's int16: clamped first, so the product fits (NaN comes out as 1).
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
            Forwarder.shared.pcm(data)
            self.room.lock()
            self.queued -= frames
            self.room.signal()
            self.room.unlock()
        }
    }
}
