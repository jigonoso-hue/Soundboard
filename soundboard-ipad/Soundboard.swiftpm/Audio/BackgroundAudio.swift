import AVFoundation
import Foundation

/// Keeps sound going with the screen locked or in another app (the app
/// declares background audio in BackgroundAudio.plist).
///
/// iOS lets an app run in the background only while it is playing audio. That
/// covers sounds already playing, but a Live Session also has to stay connected
/// between cues, so while one is on this plays an inaudible loop of silence.
@MainActor
final class BackgroundAudio {
    static let shared = BackgroundAudio()

    private var silence: AVAudioPlayer?
    private var keepingAlive = false
    private var observers: [NSObjectProtocol] = []
    /// Audio session calls can take a while (they wait on the system's audio
    /// server), so they run here rather than on the main thread.
    private nonisolated static let sessionQueue = DispatchQueue(label: "dungeonradio.audio-session", qos: .userInitiated)

    private init() {}

    /// Sets up the shared audio session: playback that mixes with other apps'
    /// audio and carries on in the background.
    func configure() {
        Self.sessionQueue.async {
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, options: [.mixWithOthers])
            try? session.setActive(true)
        }
        guard observers.isEmpty else { return }
        let session = AVAudioSession.sharedInstance()
        let center = NotificationCenter.default
        // A phone call or Siri pauses our audio; take the session back afterwards.
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .ended else { return }
            MainActor.assumeIsolated { BackgroundAudio.shared.resume() }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main) { _ in
            MainActor.assumeIsolated {
                BackgroundAudio.shared.silence = nil
                BackgroundAudio.shared.configure()
                BackgroundAudio.shared.resume()
            }
        })
    }

    /// While on, the app keeps running (and connected) in the background even
    /// when nothing audible is playing.
    func keepAlive(_ on: Bool) {
        keepingAlive = on
        if on {
            resume()
        } else {
            silence?.stop()
            silence = nil
        }
    }

    private func resume() {
        // Re-activate the session off the main thread, then (back on it) make
        // sure the keep-alive loop is playing.
        Self.sessionQueue.async {
            try? AVAudioSession.sharedInstance().setActive(true)
            DispatchQueue.main.async {
                MainActor.assumeIsolated { BackgroundAudio.shared.startSilence() }
            }
        }
    }

    private func startSilence() {
        guard keepingAlive else { return }
        if silence == nil {
            silence = try? AVAudioPlayer(data: Self.silentWAV())
            silence?.numberOfLoops = -1
        }
        if silence?.isPlaying != true {
            silence?.play()
        }
    }

    /// One second of 16-bit mono silence as a WAV file.
    private static func silentWAV(sampleRate: Int = 22050) -> Data {
        let samples = sampleRate
        let dataSize = samples * 2
        var data = Data()
        func append(_ text: String) { data.append(contentsOf: Array(text.utf8)) }
        func append32(_ value: Int) { withUnsafeBytes(of: UInt32(value).littleEndian) { data.append(contentsOf: $0) } }
        func append16(_ value: Int) { withUnsafeBytes(of: UInt16(value).littleEndian) { data.append(contentsOf: $0) } }
        append("RIFF")
        append32(36 + dataSize)
        append("WAVE")
        append("fmt ")
        append32(16)
        append16(1) // PCM
        append16(1) // mono
        append32(sampleRate)
        append32(sampleRate * 2)
        append16(2)
        append16(16)
        append("data")
        append32(dataSize)
        data.append(Data(count: dataSize))
        return data
    }
}
