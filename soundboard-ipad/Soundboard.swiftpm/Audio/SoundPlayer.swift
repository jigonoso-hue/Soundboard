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

    private var players: [UUID: [(player: AVAudioPlayer, volume: Double)]] = [:]
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
        if restartInsteadOfOverlap { stop(sound.id) }
        let player = try AVAudioPlayer(contentsOf: url)
        player.volume = Float(min(1, sound.volume * masterVolume))
        player.prepareToPlay()
        player.play()
        players[sound.id, default: []].append((player, sound.volume))
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

    /// Drops finished players and refreshes progress. Returns whether anything is still playing.
    private func tick() -> Bool {
        var next: [UUID: Double] = [:]
        for (id, list) in players {
            let alive = list.filter { $0.player.isPlaying }
            guard let latest = alive.last?.player else {
                players[id] = nil
                continue
            }
            players[id] = alive
            next[id] = latest.duration > 0 ? latest.currentTime / latest.duration : 0
        }
        progress = next
        return !players.isEmpty
    }
}
