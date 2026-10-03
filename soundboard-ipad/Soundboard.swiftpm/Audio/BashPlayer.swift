import AVFoundation
import Foundation

/// Plays a bash: every clip starts at its offset on the audio clock, and
/// repeating clips are scheduled a little ahead of time as the bash runs.
@MainActor
final class BashPlayer: ObservableObject {
    /// The bash currently playing (also set for the editor's unsaved draft).
    @Published private(set) var playingId: UUID?
    /// Seconds since the start of the bash.
    @Published private(set) var position: Double = 0
    /// Total length, or nil when a clip repeats until stopped.
    @Published private(set) var total: Double?

    private struct Track {
        let clip: BashClip
        let url: URL
        let length: Double
        /// Index of the next play to schedule.
        var next = 0
    }

    private struct Instance {
        let player: AVAudioPlayer
        let end: Double
    }

    private var tracks: [Track] = []
    private var instances: [Instance] = []
    /// Device time at which the bash's 0:00 falls.
    private var base: TimeInterval = 0
    private var clock: AVAudioPlayer?
    private var volume: Double = 1
    private var ticker: Task<Void, Never>?

    var progress: Double? {
        guard playingId != nil else { return nil }
        guard let total, total > 0 else { return 1 }
        return min(1, position / total)
    }

    /// Starts `bash` from `start` seconds. Sounds missing from the library are skipped.
    func play(_ bash: Bash, store: SoundStore, masterVolume: Double, from start: Double = 0) {
        stop()
        var built: [Track] = []
        for clip in bash.clips {
            guard let sound = store.sound(clip.soundId) else { continue }
            let url = store.url(for: sound)
            let length = sound.duration ?? SoundStore.measure(url) ?? 1
            built.append(Track(clip: clip, url: url, length: max(0.05, length)))
        }
        guard let first = built.first, let clockPlayer = try? AVAudioPlayer(contentsOf: first.url) else { return }
        tracks = built
        clock = clockPlayer
        volume = masterVolume
        var ends: [Double] = []
        var endless = false
        for track in built {
            if let end = track.clip.end(length: track.length) { ends.append(end) } else { endless = true }
        }
        total = endless ? nil : (ends.max() ?? 0)
        base = clockPlayer.deviceCurrentTime + 0.08 - start
        position = start
        playingId = bash.id
        schedule()
        startTicker()
    }

    func stop() {
        ticker?.cancel()
        ticker = nil
        for instance in instances { instance.player.stop() }
        instances = []
        tracks = []
        clock = nil
        playingId = nil
        position = 0
        total = nil
    }

    func isPlaying(_ id: UUID) -> Bool { playingId == id }

    private var now: Double {
        guard let clock else { return 0 }
        return clock.deviceCurrentTime - base
    }

    /// Schedules every play that starts within the next second.
    private func schedule() {
        let elapsed = now
        let horizon = elapsed + 1.0
        for index in tracks.indices {
            while true {
                let track = tracks[index]
                let clip = track.clip
                let plays = clip.repetition.map { $0.times == 0 ? Int.max : $0.times } ?? 1
                guard track.next < plays else { break }
                let gap = clip.repetition?.gap ?? 0
                let startAt = clip.offset + Double(track.next) * (track.length + gap)
                guard startAt < horizon else { break }
                tracks[index].next += 1
                let endAt = startAt + track.length
                guard endAt > elapsed else { continue } // already over (when starting mid-way)
                guard let player = try? AVAudioPlayer(contentsOf: track.url) else { continue }
                player.volume = Float(min(1, clip.volume * volume))
                player.prepareToPlay()
                if startAt >= elapsed {
                    player.play(atTime: base + startAt)
                } else {
                    player.currentTime = elapsed - startAt
                    player.play()
                }
                instances.append(Instance(player: player, end: endAt))
            }
        }
    }

    private func startTicker() {
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 50_000_000)
                guard let self, !Task.isCancelled else { return }
                self.tick()
            }
        }
    }

    private func tick() {
        guard playingId != nil else { return }
        let elapsed = now
        position = max(0, elapsed)
        if let total, elapsed > total + 0.15 {
            stop()
            return
        }
        instances.removeAll { instance in
            if instance.end < elapsed - 0.5 {
                instance.player.stop()
                return true
            }
            return false
        }
        schedule()
    }
}
