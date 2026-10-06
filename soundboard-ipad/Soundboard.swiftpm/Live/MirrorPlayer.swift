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
    /// Seconds it fades in over (a playlist's next song, a scene change).
    var fadeIn: Double = 0
}

/// One thing playing, for the stage's now-playing list.
struct NowPlayingItem: Identifiable, Equatable {
    enum Kind { case sound, music, ambience }
    let id: String
    let name: String
    let kind: Kind
    /// The player who played it, for sounds players add.
    let by: String?
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
        let target = Float(min(1, play.volume * level(play.category)))
        player.volume = play.fadeIn > 0 ? 0 : target
        if play.loop { player.numberOfLoops = -1 }
        player.prepareToPlay()
        voices[play.pid] = voice

        let wait = play.at.timeIntervalSinceNow
        let length = player.duration
        if play.fadeIn > 0 {
            // Fades in from when it starts; if it started a while ago, for what's left of the fade.
            let fadeIn = play.fadeIn
            Task { @MainActor [weak self] in
                if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
                guard self?.voices[play.pid] === voice else { return }
                player.setVolume(target, fadeDuration: max(0.05, fadeIn + min(0, wait)))
            }
        }
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

    /// fade: seconds to fade out over (0: at once).
    func stop(group: String, fade: Double = 0) {
        for (pid, voice) in voices where voice.play.group == group { stopVoice(pid, fade: fade) }
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

    private func stopVoice(_ pid: String, fade: Double = 0) {
        guard let voice = voices.removeValue(forKey: pid) else { return }
        let player = voice.player
        guard fade > 0, player.isPlaying else { player.stop(); return }
        player.setVolume(0, fadeDuration: fade)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(fade * 1_000_000_000) + 50_000_000)
            player.stop()
        }
    }

    /// fade: seconds layers fade in and out over (longer on a scene change).
    func setAmbience(_ list: [MirrorLayer], fade: Double = AmbienceMixer.fade) {
        let keep = Set(list.map(\.key))
        for (key, entry) in layers where !keep.contains(key) {
            layers[key] = nil
            entry.player.setVolume(0, fadeDuration: fade)
            let player = entry.player
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(fade * 1_000_000_000) + 50_000_000)
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
            player.setVolume(target, fadeDuration: fade)
            layers[layer.key] = (player, layer)
        }
        onChange?()
    }

    /// Re-applies the listener's sliders.
    func applyLevels() {
        for voice in voices.values { voice.player.volume = Float(min(1, voice.volume * level(voice.play.category))) }
        for entry in layers.values { entry.player.volume = Float(min(1, entry.layer.volume * level("ambience"))) }
    }

    var nowPlaying: [NowPlayingItem] {
        var items: [NowPlayingItem] = []
        var seen = Set<String>()
        for (pid, voice) in voices.sorted(by: { $0.value.play.at < $1.value.play.at }) {
            let play = voice.play
            guard !play.whisper, !play.name.isEmpty else { continue }
            // A now-and-then ambience sound (thunder) shows with the ambience.
            let kind: NowPlayingItem.Kind = play.category == "music" ? .music : play.category == "ambience" ? .ambience : .sound
            let key = "\(kind)-\(play.name)-\(play.by ?? "")"
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            items.append(NowPlayingItem(id: pid, name: play.name, kind: kind, by: play.by))
        }
        for (key, entry) in layers.sorted(by: { $0.key < $1.key }) where !entry.layer.name.isEmpty {
            items.append(NowPlayingItem(id: "a:" + key, name: entry.layer.name, kind: .ambience, by: nil))
        }
        return items
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
