// The broadcast upload extension (ios/README.md): what a system screen recording hears, the mix of
// every app's audio (Spotify's web player in WMP Spotify among them), sent to the app's AudioServer
// on ws://127.0.0.1:47831 as {"rate":n} in a text frame, then each buffer as a binary frame of
// interleaved stereo int16 LE. Video and the microphone are dropped. No app reachable within 5 s, or
// the socket lost, ends the broadcast with "WMP Spotify is not running". Extensions get about 50 MB,
// so nothing is kept: a buffer that arrives while the last one is still unsent is dropped. All state
// is on `queue`.
import AudioToolbox
import CoreMedia
import Foundation
import Network
import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
    private let queue = DispatchQueue(label: "broadcast-audio")
    private var connection: NWConnection?
    private var ready = false      // the WebSocket handshake is done
    private var done = false       // the broadcast is over, by the user or by fail()
    private var sentRate = 0.0     // the rate the app was last told
    private var unsent = 0         // frames handed to the connection and not yet processed
    private var described = false  // the first buffer's format was logged
    private var skipped = false    // a buffer this cannot read was logged

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        let params = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        let c = NWConnection(to: .hostPort(host: "127.0.0.1", port: 47831), using: params)
        c.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                NSLog("wmp broadcast: connected to the app")
                self.ready = true
            case .waiting(let error):
                // Refused (the app is not running) lands here, and the deadline below ends it.
                NSLog("wmp broadcast: waiting: %@", "\(error)")
            case .failed(let error):
                NSLog("wmp broadcast: failed: %@", "\(error)")
                self.fail()
            case .cancelled:
                self.fail()
            default:
                break
            }
        }
        queue.sync { connection = c }
        c.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, !self.ready else { return }
            self.fail()
        }
    }

    // Async: fail() calls finishBroadcastWithError on `queue`, and iOS may call this from inside it.
    override func broadcastFinished() {
        queue.async {
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
        guard ready, !done, unsent == 0, let s = stereo(buffer), s.frames > 0 else { return }
        if s.rate != sentRate {
            sentRate = s.rate
            send(Data("{\"rate\":\(Int(s.rate))}".utf8), .text)
        }
        send(s.pcm, .binary)
    }

    private func send(_ data: Data, _ opcode: NWProtocolWebSocket.Opcode) {
        guard let connection else { return }
        unsent += 1
        let context = NWConnection.ContentContext(identifier: "audio",
                                                  metadata: [NWProtocolWebSocket.Metadata(opcode: opcode)])
        // The completion runs on `queue`, the connection's queue.
        connection.send(content: data, contentContext: context, isComplete: true,
                        completion: .contentProcessed { [weak self] _ in self?.unsent -= 1 })
    }

    // Once: the app is gone (or never came up), so the broadcast ends with iOS's alert and the reason.
    private func fail() {
        guard !done else { return }
        done = true
        ready = false
        connection?.cancel()
        connection = nil
        finishBroadcastWithError(NSError(domain: "wmp", code: 1,
                                         userInfo: [NSLocalizedDescriptionKey: "WMP Spotify is not running"]))
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
            NSLog("wmp broadcast: first app audio buffer: %@", "\(asbd)")
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
        NSLog("wmp broadcast: skipping app audio buffers: %@", why)
    }
}
