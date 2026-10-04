import AVFoundation
import UIKit

/// A sound the host played, with its start time on this device's clock.
struct MirrorPlay {
    var pid: String
    var group: String
    var url: URL
    var name: String
    var at: Date
    var volume: Double
    /// "sfx", "music" or "ambience": which of the listener's sliders applies.
    var category: String
    var loop: Bool
    var gap: Double
    var buzz: Bool
    var whisper: Bool
    /// The player who played it, for sounds players add.
    var by: String? = nil
}

/// A looping ambience layer the host has playing.
struct MirrorLayer {
    var key: String
    var url: URL
    var name: String
    var volume: Double
}

/// Plays what a Live Session host sends, in sync, through the listener's own
/// volume sliders for music, effects and ambience.
@MainActor
final class MirrorPlayer {
    /// The listener's level for a category, including their overall volume.
    var level: (String) -> Double = { _ in 1 }
    /// Called when a whisper or a buzz sound starts, and when what's playing changes.
    var onWhisper: ((MirrorPlay) -> Void)?
    var onBuzz: ((MirrorPlay) -> Void)?
    var onStart: ((MirrorPlay) -> Void)?
    var onChange: (() -> Void)?

    private final class Voice {
        let player: AVAudioPlayer
        let play: MirrorPlay
        var volume: Double
        var started = false
        var resumeAt: Date?

        init(player: AVAudioPlayer, play: MirrorPlay) {
            self.player = player
            self.play = play
            self.volume = play.volume
        }
    }

    private var voices: [String: Voice] = [:]
    private var layers: [String: (player: AVAudioPlayer, layer: MirrorLayer)] = [:]
    private var ticker: Task<Void, Never>?

    func play(_ play: MirrorPlay) {
        stopVoice(play.pid)
        guard let player = try? AVAudioPlayer(contentsOf: play.url) else { return }
        let voice = Voice(player: player, play: play)
        player.volume = Float(min(1, play.volume * level(play.category)))
        if play.loop { player.numberOfLoops = -1 }
        player.prepareToPlay()
        voices[play.pid] = voice

        let wait = play.at.timeIntervalSinceNow
        let length = player.duration
        if wait > 0 {
            player.play(atTime: player.deviceCurrentTime + wait)
            announce(play, after: wait)
        } else {
            // Late (joined mid-way, or the file arrived late): start part-way through.
            let elapsed = -wait
            if play.loop && length > 0 {
                player.currentTime = elapsed.truncatingRemainder(dividingBy: length)
                player.play()
            } else if play.gap > 0 && length > 0 {
                let period = length + play.gap
                let into = elapsed.truncatingRemainder(dividingBy: period)
                if into < length {
                    player.currentTime = into
                    player.play()
                } else {
                    voice.resumeAt = Date().addingTimeInterval(period - into)
                }
            } else if elapsed < length - 0.05 {
                player.currentTime = elapsed
                player.play()
            } else {
                voices[play.pid] = nil
                return
            }
            announce(play, after: 0)
        }
        startTicker()
        onChange?()
    }

    /// Buzz, whisper and "who played it" notices, when the sound actually starts.
    private func announce(_ play: MirrorPlay, after delay: TimeInterval) {
        Task { @MainActor [weak self] in
            if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
            guard let self, self.voices[play.pid] != nil else { return }
            self.onStart?(play)
            if play.buzz { self.onBuzz?(play) }
            if play.whisper { self.onWhisper?(play) }
        }
    }

    func stop(group: String) {
        for (pid, voice) in voices where voice.play.group == group { stopVoice(pid) }
        onChange?()
    }

    func setVolume(_ volume: Double, group: String) {
        for voice in voices.values where voice.play.group == group {
            voice.volume = volume
            voice.player.volume = Float(min(1, volume * level(voice.play.category)))
        }
    }

    func stopAll(ambienceToo: Bool) {
        for pid in Array(voices.keys) { stopVoice(pid) }
        if ambienceToo { setAmbience([]) }
        onChange?()
    }

    private func stopVoice(_ pid: String) {
        voices.removeValue(forKey: pid)?.player.stop()
    }

    func setAmbience(_ list: [MirrorLayer]) {
        let keep = Set(list.map(\.key))
        for (key, entry) in layers where !keep.contains(key) {
            layers[key] = nil
            entry.player.setVolume(0, fadeDuration: AmbienceMixer.fade)
            let player = entry.player
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(AmbienceMixer.fade * 1_000_000_000) + 50_000_000)
                player.stop()
            }
        }
        for layer in list {
            let target = Float(min(1, layer.volume * level("ambience")))
            if let existing = layers[layer.key] {
                layers[layer.key] = (existing.player, layer)
                existing.player.setVolume(target, fadeDuration: 0.3)
                continue
            }
            guard let player = try? AVAudioPlayer(contentsOf: layer.url) else { continue }
            player.numberOfLoops = -1
            player.volume = 0
            player.prepareToPlay()
            player.play()
            player.setVolume(target, fadeDuration: AmbienceMixer.fade)
            layers[layer.key] = (player, layer)
        }
        onChange?()
    }

    /// Re-applies the listener's sliders.
    func applyLevels() {
        for voice in voices.values { voice.player.volume = Float(min(1, voice.volume * level(voice.play.category))) }
        for entry in layers.values { entry.player.volume = Float(min(1, entry.layer.volume * level("ambience"))) }
    }

    var nowPlaying: [String] {
        var names: [String] = []
        for voice in voices.values where !voice.play.whisper && !voice.play.name.isEmpty && !names.contains(voice.play.name) {
            names.append(voice.play.name)
        }
        for entry in layers.values where !entry.layer.name.isEmpty && !names.contains(entry.layer.name) {
            names.append(entry.layer.name)
        }
        return names
    }

    private func startTicker() {
        guard ticker == nil else { return }
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
                guard let self else { return }
                if !self.tick() {
                    self.ticker = nil
                    return
                }
            }
        }
    }

    /// Replays sounds that repeat after a gap and drops finished ones.
    /// Returns whether anything is still playing or waiting.
    private func tick() -> Bool {
        let now = Date()
        var changed = false
        for (pid, voice) in voices {
            if voice.player.isPlaying {
                voice.started = true
                continue
            }
            if let resumeAt = voice.resumeAt {
                if now >= resumeAt {
                    voice.resumeAt = nil
                    voice.player.currentTime = 0
                    voice.player.play()
                }
                continue
            }
            // Scheduled for later and not started yet.
            if !voice.started && voice.play.at > now.addingTimeInterval(-0.3) { continue }
            if voice.play.gap > 0 {
                voice.started = false
                voice.resumeAt = now.addingTimeInterval(voice.play.gap)
                continue
            }
            voices[pid] = nil
            changed = true
        }
        if changed { onChange?() }
        return !voices.isEmpty
    }
}
