// The broadcast upload extension (ios/README.md): what a system screen recording hears, the mix of
// every app's audio (Spotify's web player in WMP Spotify among them), sent to the app's AudioServer
// over a Unix socket, audio.sock in the App Group container (loopback TCP from here never connected,
// build 9). Frames: the body's length (4 bytes, little-endian), a type byte, the body: type 0
// {"rate":n} as UTF-8 JSON first, then type 1 with each buffer as interleaved stereo int16 LE. Video
// and the microphone are dropped. No app reachable within 5 s, or the socket lost, ends the broadcast
// with "WMP Spotify is not running (<the connection's last state>)". Each broadcast's log goes to
// broadcast.log in the same container, which the app shows on a long press. Extensions get about
// 50 MB, so nothing is kept: a buffer that arrives while the last one is still unsent is dropped. All
// state is on `queue`, and log() is called only there.
import AudioToolbox
import CoreMedia
import Foundation
import Network
import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
    private let queue = DispatchQueue(label: "broadcast-audio")
    private var connection: NWConnection?
    private var lastState = "no connection"  // the connection's last state, for the log and the alert
    private var logPath: String?   // broadcast.log in the App Group container
    private var ready = false      // connected to the app
    private var done = false       // the broadcast is over, by the user or by fail()
    private var sentRate = 0.0     // the rate the app was last told
    private var unsent = 0         // frames handed to the connection and not yet processed
    private var described = false  // the first buffer's format was logged
    private var measured = false   // the first buffer's frames and peak were logged
    private var skipped = false    // a buffer this cannot read was logged
    private var sendFailed = false // a send error was logged
    private var socket = ""        // audio.sock's path
    private var lastSeen = Date()  // when the app was last connected (or the broadcast started)
    private static let giveUp: TimeInterval = 300  // without the app this long, the broadcast ends

    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        queue.sync {
            guard let dir = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.com.rcircelli.wmpspotify") else {
                lastState = "no App Group container"
                fail()
                return
            }
            let logFile = dir.appendingPathComponent("broadcast.log").path
            FileManager.default.createFile(atPath: logFile, contents: nil)  // emptied: this broadcast only
            logPath = logFile
            socket = dir.appendingPathComponent("audio.sock").path
            log("broadcastStarted, \(socket) exists: \(FileManager.default.fileExists(atPath: socket))")
            lastSeen = Date()
            connect()
        }
    }

    /// One attempt at the app's socket. Lost or refused (the app closed, or not yet open), the next
    /// attempt comes a second later and the broadcast goes on, so closing and reopening the app
    /// resumes the visualizers without a new broadcast; 5 min without the app ends it. On `queue`.
    private func connect() {
        guard !done else { return }
        if Date().timeIntervalSince(lastSeen) > Self.giveUp { fail(); return }
        let c = NWConnection(to: .unix(path: socket), using: NWParameters(tls: nil, tcp: NWProtocolTCP.Options()))
        c.stateUpdateHandler = { [weak self, weak c] state in
            guard let self, let c, c === self.connection else { return }
            self.lastState = "\(state)"
            self.log("connection: \(state)")
            switch state {
            case .ready:
                self.ready = true
                self.lastSeen = Date()
                self.sentRate = 0  // a new app: the rate again before its first buffer
            case .waiting, .failed, .cancelled:
                // .waiting is what a refused connect lands in; a lost peer is .failed.
                self.ready = false
                self.unsent = 0
                c.cancel()
                self.connection = nil
                self.queue.asyncAfter(deadline: .now() + 1) { [weak self] in self?.connect() }
            default:
                break
            }
        }
        connection = c
        c.start(queue: queue)
    }

    // Async: fail() calls finishBroadcastWithError on `queue`, and iOS may call this from inside it.
    override func broadcastFinished() {
        queue.async {
            self.log("broadcastFinished")
            self.done = true
            self.connection?.cancel()
            self.connection = nil
        }
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .audioApp else { return }
        queue.sync { take(sampleBuffer) }
    }

    private func take(_ buffer: CMSampleBuffer) {
        // The first buffer is read for the log even before the app is connected.
        guard !done, ready && unsent == 0 || !measured, let s = stereo(buffer) else { return }
        if !measured {
            measured = true
            log("first buffer: \(s.frames) frames, peak \(s.peak)")
        }
        guard ready, unsent == 0, s.frames > 0 else { return }
        if s.rate != sentRate {
            sentRate = s.rate
            send(0, Data("{\"rate\":\(Int(s.rate))}".utf8))
        }
        send(1, s.pcm)
    }

    // One frame: the body's length (4 bytes, little-endian), `type`, the body.
    private func send(_ type: UInt8, _ body: Data) {
        guard let connection else { return }
        var frame = withUnsafeBytes(of: UInt32(body.count).littleEndian) { Data($0) }
        frame.append(type)
        frame.append(body)
        unsent += 1
        // The completion runs on `queue`, the connection's queue.
        connection.send(content: frame, completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            self.unsent = max(0, self.unsent - 1)  // 0 again after a reconnect: an old send's completion must not go below
            if let error, !self.sendFailed {
                self.sendFailed = true
                self.log("send failed: \(error)")
            }
        })
    }

    // Once: the app is gone (or never came up), so the broadcast ends with iOS's alert and the reason.
    private func fail() {
        guard !done else { return }
        done = true
        ready = false
        let why = "WMP Spotify is not running (\(lastState))"
        log("fail: \(why)")
        connection?.cancel()
        connection = nil
        finishBroadcastWithError(NSError(domain: "wmp", code: 1, userInfo: [NSLocalizedDescriptionKey: why]))
    }

    // NSLog, and a line in broadcast.log for the app to show. On `queue` only.
    private func log(_ s: String) {
        NSLog("wmp broadcast: %@", s)
        guard let logPath, let h = FileHandle(forWritingAtPath: logPath) else { return }
        defer { try? h.close() }
        _ = try? h.seekToEnd()
        try? h.write(contentsOf: Data("\(Self.clock.string(from: Date())) \(s)\n".utf8))
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
            log("first buffer format: \(asbd)")
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
        log("skipping app audio buffers: \(why)")
    }
}
