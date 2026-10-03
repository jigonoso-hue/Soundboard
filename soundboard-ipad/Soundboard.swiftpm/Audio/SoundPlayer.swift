import AVFoundation
import Foundation

@MainActor
final class SoundPlayer: ObservableObject {
    /// Playing sounds → playback progress (0...1) of their most recent instance.
    @Published private(set) var progress: [UUID: Double] = [:]

    @Published var masterVolume: Double {
        didSet {
            UserDefaults.standard.set(masterVolume, forKey: "masterVolume")
            applyVolumes()
        }
    }

    @Published var restartInsteadOfOverlap: Bool {
        didSet { UserDefaults.standard.set(restartInsteadOfOverlap, forKey: "restartInsteadOfOverlap") }
    }

    private final class Voice {
        let player: AVAudioPlayer
        let volume: Double
        /// Seconds to wait before replaying, or nil to play once.
        let repeatGap: Double?
        /// When a repeating voice finished and is waiting to replay.
        var resumeAt: Date?

        init(player: AVAudioPlayer, volume: Double, repeatGap: Double?) {
            self.player = player
            self.volume = volume
            self.repeatGap = repeatGap
        }
    }

    private var players: [UUID: [Voice]] = [:]
    private var ticker: Task<Void, Never>?

    init() {
        let defaults = UserDefaults.standard
        masterVolume = defaults.object(forKey: "masterVolume") as? Double ?? 1
        restartInsteadOfOverlap = defaults.bool(forKey: "restartInsteadOfOverlap")
        // .mixWithOthers lets sounds play over music, calls, or the YouTube view.
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func play(_ sound: Sound, url: URL) throws {
        // A repeating sound toggles: tapping it again stops it instead of stacking another copy.
        if sound.repeatGap != nil && progress[sound.id] != nil {
            stop(sound.id)
            return
        }
        if restartInsteadOfOverlap { stop(sound.id) }
        let player = try AVAudioPlayer(contentsOf: url)
        player.volume = Float(min(1, sound.volume * masterVolume))
        if sound.repeatGap == 0 { player.numberOfLoops = -1 } // replay immediately, gaplessly
        player.prepareToPlay()
        player.play()
        players[sound.id, default: []].append(Voice(player: player, volume: sound.volume, repeatGap: sound.repeatGap))
        progress[sound.id] = 0
        startTicker()
    }

    func stop(_ id: UUID) {
        players[id]?.forEach { $0.player.stop() }
        players[id] = nil
        progress[id] = nil
    }

    func stopAll() {
        for id in Array(players.keys) { stop(id) }
    }

    private func applyVolumes() {
        for list in players.values {
            for entry in list { entry.player.volume = Float(min(1, entry.volume * masterVolume)) }
        }
    }

    private func startTicker() {
        guard ticker == nil else { return }
        ticker = Task { [weak self] in
            while true {
                guard let self else { return }
                if !self.tick() {
                    self.ticker = nil
                    return
                }
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }
    }

    /// Drops finished players, replays repeating ones when their wait is over and
    /// refreshes progress. Returns whether anything is still playing or waiting.
    private func tick() -> Bool {
        var next: [UUID: Double] = [:]
        let now = Date()
        for (id, list) in players {
            var alive: [Voice] = []
            for voice in list {
                if voice.player.isPlaying {
                    alive.append(voice)
                } else if let gap = voice.repeatGap {
                    if voice.resumeAt == nil { voice.resumeAt = now.addingTimeInterval(gap) }
                    if let resumeAt = voice.resumeAt, now >= resumeAt {
                        voice.resumeAt = nil
                        voice.player.currentTime = 0
                        voice.player.play()
                    }
                    alive.append(voice)
                }
            }
            guard let latest = alive.last?.player else {
                players[id] = nil
                continue
            }
            players[id] = alive
            next[id] = latest.isPlaying && latest.duration > 0 ? latest.currentTime / latest.duration : 0
        }
        progress = next
        return !players.isEmpty
    }
}
