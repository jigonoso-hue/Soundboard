import AVFoundation
import Foundation

struct AmbienceLayer: Identifiable, Codable, Equatable {
    enum Kind: String, Codable { case builtin, sound }

    var id: String
    var kind: Kind
    /// Built-in file name, or a library sound's UUID string.
    var ref: String
    var volume: Double
}

struct BuiltinLoop: Identifiable, Equatable {
    var id: String { file }
    let file: String
    let name: String
    let url: URL
}

/// Looping background layers (built-in loops or library sounds), each with
/// its own volume, faded in and out under the soundboard.
@MainActor
final class AmbienceMixer: ObservableObject {
    static let fade: TimeInterval = 1.5

    @Published private(set) var layers: [AmbienceLayer] = []
    @Published private(set) var playing: Set<String> = []
    @Published var masterVolume: Double = 0.8 {
        didSet { applyVolumes(); save() }
    }

    let builtins: [BuiltinLoop]
    private weak var store: SoundStore?
    private var players: [String: AVAudioPlayer] = [:]
    private var stateURL: URL?

    private struct SavedState: Codable {
        var masterVolume: Double
        var layers: [AmbienceLayer]
        /// Built-in loops the user has already been offered (nil in older saves).
        var knownBuiltins: [String]?
    }

    /// The loops shipped before the app started tracking which ones you've seen.
    private static let originalBuiltins: Set<String> = [
        "campfire.wav", "cave-drips.wav", "dark-drone.wav", "forest-stream.wav",
        "night-forest.wav", "ocean-waves.wav", "rain.wav", "wind.wav",
    ]

    init() {
        // Resources/Ambience may be copied as a folder or flattened into the bundle.
        let nested = Bundle.module.urls(forResourcesWithExtension: "wav", subdirectory: "Ambience") ?? []
        let urls = nested.isEmpty ? (Bundle.module.urls(forResourcesWithExtension: "wav", subdirectory: nil) ?? []) : nested
        builtins = urls
            .map { url in
                let file = url.lastPathComponent
                let name = url.deletingPathExtension().lastPathComponent
                    .replacingOccurrences(of: "-", with: " ")
                    .capitalized
                return BuiltinLoop(file: file, name: name, url: url)
            }
            .sorted { $0.name < $1.name }
    }

    /// Connects the mixer to the library and restores the saved mix.
    func attach(to store: SoundStore) {
        guard self.store == nil else { return }
        self.store = store
        stateURL = store.folder.appendingPathComponent("ambience.json")
        if let url = stateURL,
           let data = try? Data(contentsOf: url),
           let saved = try? JSONDecoder().decode(SavedState.self, from: data) {
            layers = saved.layers
            masterVolume = saved.masterVolume
            // Loops added in an app update show up in the strip; ones the user removed stay removed.
            let known = saved.knownBuiltins.map(Set.init) ?? Self.originalBuiltins
            for loop in builtins where !known.contains(loop.file)
                && !layers.contains(where: { $0.kind == .builtin && $0.ref == loop.file }) {
                layers.append(AmbienceLayer(id: "builtin-\(loop.file)", kind: .builtin, ref: loop.file, volume: 0.7))
            }
        } else {
            // First run: offer every built-in loop, all switched off.
            layers = builtins.map { AmbienceLayer(id: "builtin-\($0.file)", kind: .builtin, ref: $0.file, volume: 0.7) }
        }
        save()
        syncWithLibrary()
    }

    // MARK: Layers

    func name(of layer: AmbienceLayer) -> String {
        switch layer.kind {
        case .builtin:
            return builtins.first { $0.file == layer.ref }?.name ?? layer.ref
        case .sound:
            return store?.sounds.first { $0.id.uuidString == layer.ref }?.name ?? "Missing sound"
        }
    }

    func isPlaying(_ layer: AmbienceLayer) -> Bool {
        playing.contains(layer.id)
    }

    func toggle(_ layer: AmbienceLayer) {
        if isPlaying(layer) { stop(layer.id) } else { start(layer) }
    }

    func setVolume(_ volume: Double, for layer: AmbienceLayer) {
        guard let index = layers.firstIndex(where: { $0.id == layer.id }) else { return }
        layers[index].volume = volume
        players[layer.id]?.volume = Float(volume * masterVolume)
        save()
    }

    func add(_ kind: AmbienceLayer.Kind, ref: String, play: Bool = true) {
        let layer: AmbienceLayer
        if let existing = layers.first(where: { $0.kind == kind && $0.ref == ref }) {
            layer = existing
        } else {
            layer = AmbienceLayer(id: "\(kind.rawValue)-\(ref)", kind: kind, ref: ref, volume: 0.7)
            layers.append(layer)
            save()
        }
        if play && !isPlaying(layer) { start(layer) }
    }

    func remove(_ layer: AmbienceLayer) {
        stop(layer.id, fade: 0.3)
        layers.removeAll { $0.id == layer.id }
        save()
    }

    func stopAll() {
        for id in playing { stop(id) }
    }

    /// Drops layers whose library sound was deleted.
    func syncWithLibrary() {
        guard let store else { return }
        let ids = Set(store.sounds.map { $0.id.uuidString })
        let missing = layers.filter { $0.kind == .sound && !ids.contains($0.ref) }
        guard !missing.isEmpty else { return }
        for layer in missing { stop(layer.id, fade: 0.3) }
        layers.removeAll { layer in missing.contains { $0.id == layer.id } }
        save()
    }

    // MARK: Playback

    private func url(for layer: AmbienceLayer) -> URL? {
        switch layer.kind {
        case .builtin:
            return builtins.first { $0.file == layer.ref }?.url
        case .sound:
            guard let sound = store?.sounds.first(where: { $0.id.uuidString == layer.ref }) else { return nil }
            return store?.url(for: sound)
        }
    }

    private func start(_ layer: AmbienceLayer) {
        guard let url = url(for: layer), let player = try? AVAudioPlayer(contentsOf: url) else { return }
        player.numberOfLoops = -1
        player.volume = 0
        // Start built-in loops at a random point so they don't sound identical every time.
        if layer.kind == .builtin { player.currentTime = Double.random(in: 0..<max(player.duration, 0.1)) }
        player.prepareToPlay()
        player.play()
        player.setVolume(Float(layer.volume * masterVolume), fadeDuration: Self.fade)
        players[layer.id]?.stop()
        players[layer.id] = player
        playing.insert(layer.id)
    }

    private func stop(_ id: String, fade: TimeInterval = 1.5) {
        guard let player = players.removeValue(forKey: id) else { return }
        playing.remove(id)
        player.setVolume(0, fadeDuration: fade)
        Task {
            try? await Task.sleep(nanoseconds: UInt64(fade * 1_000_000_000) + 50_000_000)
            player.stop()
        }
    }

    private func applyVolumes() {
        for layer in layers {
            players[layer.id]?.volume = Float(layer.volume * masterVolume)
        }
    }

    private func save() {
        guard let stateURL else { return }
        let state = SavedState(masterVolume: masterVolume, layers: layers, knownBuiltins: builtins.map(\.file))
        if let data = try? JSONEncoder().encode(state) {
            try? data.write(to: stateURL, options: .atomic)
        }
    }
}
