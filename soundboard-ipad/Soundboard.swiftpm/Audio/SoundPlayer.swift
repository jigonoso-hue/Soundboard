import AVFoundation
import Foundation

@MainActor
final class SoundPlayer: ObservableObject {
    /// Playing sounds → playback progress (0...1) of their most recent instance.
    @Published private(set) var progress: [UUID: Double] = [:]
    /// Live volume of each playing sound (its own volume, adjustable while it plays).
    @Published private(set) var volumes: [UUID: Double] = [:]

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
        var volume: Double
        /// Extra level from where it was played, such as a scene kit section's volume slider.
        var gain: Double = 1
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
    /// Forwards what plays to Live Session listeners while hosting.
    weak var live: LiveSession?

    init() {
        let defaults = UserDefaults.standard
        masterVolume = defaults.object(forKey: "masterVolume") as? Double ?? 1
        restartInsteadOfOverlap = defaults.bool(forKey: "restartInsteadOfOverlap")
        // Playback that mixes with music or the YouTube view and keeps going with the screen locked.
        BackgroundAudio.shared.configure()
    }

    func play(_ sound: Sound, url: URL, gain: Double = 1) throws {
        // A repeating sound toggles: tapping it again stops it instead of stacking another copy.
        if sound.repeatGap != nil && progress[sound.id] != nil {
            stop(sound.id)
            return
        }
        if restartInsteadOfOverlap { stop(sound.id) }
        let player = try AVAudioPlayer(contentsOf: url)
        let volume = volumes[sound.id] ?? sound.volume
        player.volume = Float(min(1, volume * gain * masterVolume))
        if sound.repeatGap == 0 { player.numberOfLoops = -1 } // replay immediately, gaplessly
        player.prepareToPlay()
        player.play()
        let voice = Voice(player: player, volume: volume, repeatGap: sound.repeatGap)
        voice.gain = gain
        players[sound.id, default: []].append(voice)
        progress[sound.id] = 0
        volumes[sound.id] = volume
        startTicker()
        live?.soundPlayed(sound, volume: min(1, volume * gain * masterVolume))
    }

    func stop(_ id: UUID) {
        let wasPlaying = players[id] != nil
        players[id]?.forEach { $0.player.stop() }
        players[id] = nil
        progress[id] = nil
        volumes[id] = nil
        if wasPlaying { live?.soundStopped(id) }
    }

    func stopAll() {
        for id in Array(players.keys) { stop(id) }
        live?.stoppedAll()
    }

    private func applyVolumes() {
        for (id, list) in players {
            for entry in list { entry.player.volume = Float(min(1, entry.volume * entry.gain * masterVolume)) }
            if let entry = list.last { live?.soundVolume(id, volume: min(1, entry.volume * entry.gain * masterVolume)) }
        }
    }

    /// Changes a playing sound's volume (the slider on a playing full sound).
    func setVolume(_ volume: Double, for id: UUID) {
        let value = min(1, max(0, volume))
        guard let list = players[id] else { return }
        volumes[id] = value
        for voice in list {
            voice.volume = value
            voice.player.volume = Float(min(1, value * voice.gain * masterVolume))
        }
        if let voice = list.last { live?.soundVolume(id, volume: min(1, value * voice.gain * masterVolume)) }
    }

    /// Changes the extra level of playing sounds (a scene kit section's volume slider).
    func setGain(_ gain: Double, for ids: [UUID]) {
        for id in ids {
            for voice in players[id] ?? [] {
                voice.gain = gain
                voice.player.volume = Float(min(1, voice.volume * gain * masterVolume))
            }
            if let voice = players[id]?.last { live?.soundVolume(id, volume: min(1, voice.volume * gain * masterVolume)) }
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
