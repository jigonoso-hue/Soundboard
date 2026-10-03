import AVFoundation
import Foundation

/// Encodes captured 16-bit PCM to AAC (.m4a) as it streams in, so even
/// hour-long captures never sit in memory.
final class CaptureWriter {
    let url: URL
    private var file: AVAudioFile?
    private let channels: Int
    private(set) var frames = 0
    let sampleRate: Double

    init(sampleRate: Double, channels: Int) throws {
        self.sampleRate = sampleRate
        self.channels = channels
        url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: 192_000,
        ]
        file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatInt16, interleaved: true)
    }

    /// Appends interleaved little-endian Int16 samples.
    func append(_ pcm: Data) throws {
        guard let file else { return }
        let frameCount = pcm.count / (2 * channels)
        guard frameCount > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(frameCount)),
              let destination = buffer.int16ChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(frameCount)
        pcm.withUnsafeBytes { raw in
            guard let source = raw.baseAddress else { return }
            memcpy(destination, source, frameCount * 2 * channels)
        }
        try file.write(from: buffer)
        frames += frameCount
    }

    /// Finalises the file and returns its URL.
    func finish() -> URL {
        file = nil // releasing the AVAudioFile flushes and closes it
        return url
    }

    func discard() {
        file = nil
        try? FileManager.default.removeItem(at: url)
    }
}

enum ClipExporter {
    /// Cuts [start, end] seconds of audio out of any audio or video file into a temporary .m4a.
    static func exportAudio(from url: URL, start: Double, end: Double) async throws -> URL {
        let asset = AVURLAsset(url: url)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        guard !tracks.isEmpty else { throw SoundError.noAudio }
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw SoundError.exportFailed
        }
        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")
        session.outputURL = output
        session.outputFileType = .m4a
        session.timeRange = CMTimeRange(
            start: CMTime(seconds: start, preferredTimescale: 600),
            end: CMTime(seconds: end, preferredTimescale: 600)
        )
        await session.export()
        guard session.status == .completed else { throw session.error ?? SoundError.exportFailed }
        return output
    }
}
