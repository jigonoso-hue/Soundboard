import AVFoundation
import Foundation
import QuartzCore
import ReplayKit

/// Records the app's own audio output with ReplayKit, keeping only the part
/// that belongs to [start, end] of the YouTube video.
///
/// On iPadOS, YouTube plays through a media pipeline that Web Audio can't tap,
/// so recording inside the page only gets silence. Instead the page script
/// plays the range and reports the video's clock, and this records what the
/// app actually plays, matching each audio buffer to a time in the video.
final class AppAudioRecorder {
    struct Result {
        let file: URL
        let frames: Int
        let sampleRate: Double
        let peak: Float
    }

    enum RecorderError: LocalizedError {
        case unavailable
        case denied(String)

        var errorDescription: String? {
            switch self {
            case .unavailable:
                return "Recording isn't available on this device right now."
            case .denied(let detail):
                return "Soundboard needs permission to record its own audio (\(detail)). Tap Create Sound again and choose Allow."
            }
        }
    }

    static var isAvailable: Bool { RPScreenRecorder.shared().isAvailable }

    private let start: Double
    private let end: Double
    private let lock = NSLock()

    // Guarded by `lock`.
    private var anchorHost: Double?
    private var anchorMedia: Double = 0
    private var playing = false
    private var written: Double
    private var writer: CaptureWriter?
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private var targetFormat: AVAudioFormat?
    private var peak: Float = 0
    private var failure: Error?

    init(start: Double, end: Double) {
        self.start = start
        self.end = end
        self.written = start
    }

    /// Starts recording. iPadOS asks for permission the first time.
    func begin(_ completion: @escaping (Error?) -> Void) {
        let recorder = RPScreenRecorder.shared()
        guard recorder.isAvailable else { return completion(RecorderError.unavailable) }
        recorder.isMicrophoneEnabled = false
        recorder.startCapture(handler: { [weak self] sample, type, _ in
            guard type == .audioApp, let self else { return }
            self.process(sample)
        }, completionHandler: { error in
            DispatchQueue.main.async {
                completion(error.map { RecorderError.denied($0.localizedDescription) })
            }
        })
    }

    /// The video's current time, reported by the page while it plays.
    func updateClock(media: Double, playing: Bool) {
        let now = CACurrentMediaTime()
        lock.lock()
        anchorHost = now
        anchorMedia = media
        self.playing = playing
        lock.unlock()
    }

    /// Stops recording and finishes the file.
    func finish(_ completion: @escaping (Result?, Error?) -> Void) {
        RPScreenRecorder.shared().stopCapture { [weak self] _ in
            guard let self else { return }
            self.lock.lock()
            let writer = self.writer
            self.writer = nil
            let peak = self.peak
            let failure = self.failure
            self.lock.unlock()
            DispatchQueue.main.async {
                if let failure {
                    writer?.discard()
                    completion(nil, failure)
                    return
                }
                guard let writer, writer.frames > 0 else {
                    completion(nil, nil)
                    return
                }
                let frames = writer.frames
                let sampleRate = writer.sampleRate
                let file = writer.finish()
                completion(Result(file: file, frames: frames, sampleRate: sampleRate, peak: peak), nil)
            }
        }
    }

    func cancel() {
        RPScreenRecorder.shared().stopCapture { _ in }
        lock.lock()
        writer?.discard()
        writer = nil
        lock.unlock()
    }

    // MARK: Audio

    private func process(_ sample: CMSampleBuffer) {
        guard CMSampleBufferDataIsReady(sample),
              let description = CMSampleBufferGetFormatDescription(sample),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return }
        let frameCount = CMSampleBufferGetNumSamples(sample)
        guard frameCount > 0 else { return }

        lock.lock()
        defer { lock.unlock() }
        guard failure == nil, playing, let anchorHost else { return }

        // Media time of the buffer's first sample. ReplayKit stamps buffers on
        // the host clock; if a stamp looks wrong, fall back to arrival time.
        let now = CACurrentMediaTime()
        let rate = asbd.pointee.mSampleRate
        let bufferSeconds = Double(frameCount) / rate
        var hostStart = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        if !hostStart.isFinite || abs(hostStart - now) > 5 { hostStart = now - bufferSeconds }
        let mediaStart = anchorMedia + (hostStart - anchorHost)
        let mediaEnd = mediaStart + bufferSeconds
        guard mediaEnd > max(start, written), mediaStart < end else { return }

        do {
            let pcm = try convert(sample, asbd: asbd, frames: frameCount)
            let first = max(0, Int(((max(start, written) - mediaStart) * rate).rounded()))
            let last = min(Int(pcm.frameLength), Int(((end - mediaStart) * rate).rounded()))
            guard last > first, let data = pcm.int16ChannelData?[0] else { return }
            let channels = Int(pcm.format.channelCount)
            var chunk = Data(count: (last - first) * channels * 2)
            chunk.withUnsafeMutableBytes { raw in
                guard let out = raw.baseAddress?.assumingMemoryBound(to: Int16.self) else { return }
                for i in 0..<((last - first) * channels) {
                    let value = data[first * channels + i]
                    out[i] = value
                    peak = max(peak, Float(abs(Int(value))) / 32768)
                }
            }
            if writer == nil {
                writer = try CaptureWriter(sampleRate: rate, channels: channels)
            }
            try writer?.append(chunk)
            written = mediaStart + Double(last) / rate
        } catch {
            failure = error
        }
    }

    /// Converts a ReplayKit buffer (any layout, sometimes big-endian) to interleaved 16-bit stereo.
    private func convert(_ sample: CMSampleBuffer, asbd: UnsafePointer<AudioStreamBasicDescription>, frames: Int) throws -> AVAudioPCMBuffer {
        if sourceFormat == nil || sourceFormat?.sampleRate != asbd.pointee.mSampleRate
            || sourceFormat?.channelCount != asbd.pointee.mChannelsPerFrame {
            var description = asbd.pointee
            guard let source = AVAudioFormat(streamDescription: &description),
                  let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: description.mSampleRate, channels: 2, interleaved: true),
                  let converter = AVAudioConverter(from: source, to: target) else {
                throw SoundError.exportFailed
            }
            sourceFormat = source
            targetFormat = target
            self.converter = converter
        }
        guard let sourceFormat, let targetFormat, let converter,
              let input = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: AVAudioFrameCount(frames)),
              let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: AVAudioFrameCount(frames)) else {
            throw SoundError.exportFailed
        }
        input.frameLength = AVAudioFrameCount(frames)
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames), into: input.mutableAudioBufferList)
        guard status == noErr else { throw SoundError.exportFailed }
        try converter.convert(to: output, from: input)
        return output
    }
}
