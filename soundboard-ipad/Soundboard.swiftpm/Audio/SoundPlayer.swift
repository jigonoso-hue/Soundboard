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

    /// How to play a sound, beyond tapping it.
    struct PlayOptions {
        /// Always start another copy (a playlist's next song); never toggle it off.
        var fresh = false
        /// Seconds to fade in over.
        var fadeIn: Double = 0
        /// What Live Session listeners stop it by (default "s:<id>").
        var group: String? = nil
        /// Called once when this many seconds of it are left.
        var nearEnd: (seconds: Double, action: () -> Void)? = nil
        /// Called when it finishes by itself.
        var onEnded: (() -> Void)? = nil
        /// Called when it's stopped from elsewhere (Stop All, its tile).
        var onRelease: (() -> Void)? = nil
    }

    private final class Voice {
        let token = UUID()
        let player: AVAudioPlayer
        var volume: Double
        /// Extra level from where it was played, such as a scene kit section's volume slider.
        var gain: Double = 1
        /// Seconds to wait before replaying, or nil to play once.
        let repeatGap: Double?
        /// When a repeating voice finished and is waiting to replay.
        var resumeAt: Date?
        let group: String
        var options: PlayOptions
        var nearFired = false
        /// While fading in or out, volume changes don't cut across the fade.
        var fadingUntil: Date?

        init(player: AVAudioPlayer, volume: Double, repeatGap: Double?, group: String, options: PlayOptions) {
            self.player = player
            self.volume = volume
            self.repeatGap = repeatGap
            self.group = group
            self.options = options
        }

        var fading: Bool { fadingUntil.map { Date() < $0 } ?? false }
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

    /// Plays a sound. Returns the copy's token (to stop just that copy later), or nil.
    @discardableResult
    func play(_ sound: Sound, url: URL, gain: Double = 1, options: PlayOptions = PlayOptions()) throws -> UUID? {
        // A repeating sound toggles: tapping it again stops it instead of stacking another copy.
        if !options.fresh && sound.repeatGap != nil && progress[sound.id] != nil {
            stop(sound.id)
            return nil
        }
        if restartInsteadOfOverlap && !options.fresh { stop(sound.id) }
        let player = try AVAudioPlayer(contentsOf: url)
        let volume = volumes[sound.id] ?? sound.volume
        let level = Float(min(1, volume * gain * masterVolume))
        player.volume = options.fadeIn > 0 ? 0 : level
        let repeatGap = options.fresh ? nil : sound.repeatGap
        if repeatGap == 0 { player.numberOfLoops = -1 } // replay immediately, gaplessly
        player.prepareToPlay()
        player.play()
        let voice = Voice(player: player, volume: volume, repeatGap: repeatGap,
                          group: options.group ?? "s:\(sound.id.uuidString)", options: options)
        voice.gain = gain
        if options.fadeIn > 0 {
            player.setVolume(level, fadeDuration: options.fadeIn)
            voice.fadingUntil = Date().addingTimeInterval(options.fadeIn)
        }
        players[sound.id, default: []].append(voice)
        progress[sound.id] = 0
        volumes[sound.id] = volume
        startTicker()
        live?.soundPlayed(sound, volume: min(1, volume * gain * masterVolume), group: voice.group, fadeIn: options.fadeIn)
        return voice.token
    }

    /// Stops one copy of a sound, fading it out over `fade` seconds.
    func release(_ id: UUID, token: UUID, fade: Double = 0) {
        guard var list = players[id], let index = list.firstIndex(where: { $0.token == token }) else { return }
        let voice = list.remove(at: index)
        players[id] = list.isEmpty ? nil : list
        if list.isEmpty {
            progress[id] = nil
            volumes[id] = nil
        }
        end(voice, fade: fade)
    }

    /// Whether that copy of a sound is still playing (not finished or stopped).
    func isPlaying(_ id: UUID, token: UUID) -> Bool {
        players[id]?.contains { $0.token == token } ?? false
    }

    private func end(_ voice: Voice, fade: Double) {
        let player = voice.player
        if fade > 0 && player.isPlaying {
            player.setVolume(0, fadeDuration: fade)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(fade * 1_000_000_000) + 50_000_000)
                player.stop()
            }
        } else {
            player.stop()
        }
        live?.groupStopped(voice.group, fade: fade)
        // Lets a playlist know its song was stopped from elsewhere.
        if let onRelease = voice.options.onRelease {
            voice.options.onRelease = nil
            onRelease()
        }
    }

    /// Stops every copy of a sound, fading out over `fade` seconds (a scene change).
    func stop(_ id: UUID, fade: Double = 0) {
        guard let list = players.removeValue(forKey: id) else { return }
        progress[id] = nil
        volumes[id] = nil
        for voice in list { end(voice, fade: fade) }
    }

    /// The full sounds playing, for a scene change to fade out.
    var playingIds: [UUID] { Array(players.keys) }

    func stopAll() {
        for id in Array(players.keys) { stop(id) }
        live?.stoppedAll()
    }

    private func applyVolumes() {
        for list in players.values {
            for entry in list where !entry.fading {
                entry.player.volume = Float(min(1, entry.volume * entry.gain * masterVolume))
                live?.groupVolume(entry.group, volume: min(1, entry.volume * entry.gain * masterVolume))
            }
        }
    }

    /// Changes a playing sound's volume (the slider on a playing full sound).
    func setVolume(_ volume: Double, for id: UUID) {
        let value = min(1, max(0, volume))
        guard let list = players[id] else { return }
        volumes[id] = value
        for voice in list {
            voice.volume = value
            if voice.fading { continue }
            voice.player.volume = Float(min(1, value * voice.gain * masterVolume))
            live?.groupVolume(voice.group, volume: min(1, value * voice.gain * masterVolume))
        }
    }

    /// Changes the extra level of playing sounds (a scene kit section's volume slider).
    func setGain(_ gain: Double, for ids: [UUID]) {
        for id in ids {
            for voice in players[id] ?? [] {
                voice.gain = gain
                if voice.fading { continue }
                voice.player.volume = Float(min(1, voice.volume * gain * masterVolume))
                live?.groupVolume(voice.group, volume: min(1, voice.volume * gain * masterVolume))
            }
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
        // Callbacks run after the sweep, since they may start or stop sounds.
        var callbacks: [() -> Void] = []
        for (id, list) in players {
            var alive: [Voice] = []
            for voice in list {
                if voice.player.isPlaying {
                    alive.append(voice)
                    if let near = voice.options.nearEnd, !voice.nearFired,
                       voice.player.duration > 0, voice.player.duration - voice.player.currentTime <= near.seconds {
                        voice.nearFired = true
                        callbacks.append(near.action)
                    }
                } else if let gap = voice.repeatGap {
                    if voice.resumeAt == nil { voice.resumeAt = now.addingTimeInterval(gap) }
                    if let resumeAt = voice.resumeAt, now >= resumeAt {
                        voice.resumeAt = nil
                        voice.player.currentTime = 0
                        voice.player.play()
                    }
                    alive.append(voice)
                } else {
                    // Finished by itself.
                    if let onEnded = voice.options.onEnded { callbacks.append(onEnded) }
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
        for callback in callbacks { callback() }
        return !players.isEmpty
    }
}
