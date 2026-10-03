import Foundation

/// How a clip in a bash repeats: replay `gap` seconds after each play ends
/// (0 = immediately). `times` is the total number of plays; 0 = until stopped.
struct ClipRepeat: Codable, Equatable {
    var gap: Double
    var times: Int
}

/// One sound placed on a bash's timeline.
struct BashClip: Identifiable, Codable, Equatable {
    var id: UUID
    var soundId: UUID
    /// Seconds after the bash is triggered.
    var offset: Double
    var volume: Double
    /// Row in the timeline editor.
    var lane: Int
    var repetition: ClipRepeat? = nil

    /// When this clip's last play ends, or nil if it repeats until stopped.
    func end(length: Double) -> Double? {
        guard let repetition else { return offset + length }
        guard repetition.times > 0 else { return nil }
        return offset + Double(repetition.times) * length + Double(repetition.times - 1) * repetition.gap
    }
}

/// A bash's cover: an icon on a colour, or a picture from Photos.
struct BashCover: Codable, Equatable {
    var icon: String
    var color: String
    var iconColor: String
    /// File name in the covers folder when a picture is used.
    var imageFile: String? = nil
}

/// Several sounds fired together with one tap, each starting when you choose.
struct Bash: Identifiable, Codable, Equatable {
    var id: UUID
    var name: String
    var cover: BashCover
    var clips: [BashClip]
    var createdAt: Date

    /// Distinct sounds in the bash.
    var soundCount: Int { Set(clips.map(\.soundId)).count }
}

/// Bashes, stored in bashes.json next to the sounds; cover pictures in covers/.
@MainActor
final class BashStore: ObservableObject {
    static let icons = ["crossed-swords", "dragon", "mug", "flame", "pine", "castle", "skull", "wave", "bolt", "d20",
                        "wizard-hat", "moon", "crown", "candle", "dagger", "shield", "paw", "ghost", "storm", "lute"]
    static let colors = ["#7c6cff", "#ff5d73", "#ffb347", "#6ee7b7", "#5ec8ff", "#d58bff", "#8a6a4f", "#3f4a5a"]
    static let maxOffset = 3600.0

    @Published private(set) var bashes: [Bash] = []

    let coversFolder: URL
    private let indexURL: URL

    init() {
        let folder = SoundStore.folder
        coversFolder = folder.appendingPathComponent("covers", isDirectory: true)
        indexURL = folder.appendingPathComponent("bashes.json")
        try? FileManager.default.createDirectory(at: coversFolder, withIntermediateDirectories: true)
        load()
    }

    func bash(_ id: UUID) -> Bash? {
        bashes.first { $0.id == id }
    }

    /// A new bash; every sound starts at the same time, each on its own lane.
    @discardableResult
    func create(name: String? = nil, soundIds: [UUID] = []) -> Bash {
        let index = bashes.count
        let bash = Bash(
            id: UUID(),
            name: Self.cleanName(name ?? "") ?? "Bash \(index + 1)",
            cover: BashCover(icon: Self.icons[index % Self.icons.count], color: Self.colors[index % Self.colors.count], iconColor: "#ffffff"),
            clips: soundIds.enumerated().map { lane, soundId in
                BashClip(id: UUID(), soundId: soundId, offset: 0, volume: 1, lane: lane)
            },
            createdAt: Date()
        )
        bashes.append(bash)
        save()
        return bash
    }

    /// Saves edits to a bash (name, cover, clips). A cover picture can only be set with `setCoverImage`.
    func update(_ bash: Bash) {
        guard let index = bashes.firstIndex(where: { $0.id == bash.id }) else { return }
        let current = bashes[index]
        var next = Self.normalized(bash)
        next.createdAt = current.createdAt
        if next.cover.imageFile != current.cover.imageFile {
            if let old = current.cover.imageFile, next.cover.imageFile == nil {
                removeCoverFile(old)
            } else {
                next.cover.imageFile = current.cover.imageFile
            }
        }
        bashes[index] = next
        save()
    }

    /// Uses a picture (JPEG data) as the bash's cover.
    func setCoverImage(_ id: UUID, data: Data) throws {
        guard let index = bashes.firstIndex(where: { $0.id == id }) else { return }
        let file = "\(id.uuidString)-\(Int(Date().timeIntervalSince1970)).jpg"
        try data.write(to: coversFolder.appendingPathComponent(file), options: .atomic)
        if let old = bashes[index].cover.imageFile { removeCoverFile(old) }
        bashes[index].cover.imageFile = file
        save()
    }

    func coverURL(_ file: String) -> URL {
        coversFolder.appendingPathComponent(file)
    }

    func remove(_ id: UUID) {
        guard let index = bashes.firstIndex(where: { $0.id == id }) else { return }
        let bash = bashes.remove(at: index)
        if let file = bash.cover.imageFile { removeCoverFile(file) }
        save()
    }

    @discardableResult
    func duplicate(_ id: UUID) -> Bash? {
        guard let source = bash(id) else { return nil }
        var copy = create(name: "\(source.name) copy")
        copy.clips = source.clips.map { clip in
            var c = clip
            c.id = UUID()
            return c
        }
        copy.cover.icon = source.cover.icon
        copy.cover.color = source.cover.color
        copy.cover.iconColor = source.cover.iconColor
        update(copy)
        if let file = source.cover.imageFile, let data = try? Data(contentsOf: coverURL(file)) {
            try? setCoverImage(copy.id, data: data)
        }
        return self.bash(copy.id)
    }

    /// Adds sounds to a bash, each on a new lane, starting at `offset`.
    func addSounds(_ soundIds: [UUID], to id: UUID, offset: Double = 0) {
        guard var bash = bash(id) else { return }
        var lane = (bash.clips.map(\.lane).max() ?? -1) + 1
        for soundId in soundIds {
            bash.clips.append(BashClip(id: UUID(), soundId: soundId, offset: offset, volume: 1, lane: lane))
            lane += 1
        }
        update(bash)
    }

    /// Drops clips that point at a deleted sound.
    func prune(soundId: UUID) {
        var changed = false
        for index in bashes.indices where bashes[index].clips.contains(where: { $0.soundId == soundId }) {
            bashes[index].clips.removeAll { $0.soundId == soundId }
            changed = true
        }
        if changed { save() }
    }

    // MARK: Storage

    private func load() {
        guard let data = try? Data(contentsOf: indexURL),
              let decoded = try? Self.decoder.decode([Bash].self, from: data) else { return }
        bashes = decoded.map { Self.normalized($0) }
    }

    private func save() {
        guard let data = try? Self.encoder.encode(bashes) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    private func removeCoverFile(_ file: String) {
        try? FileManager.default.removeItem(at: coverURL(file))
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = .prettyPrinted
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    static func cleanName(_ name: String) -> String? {
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        return trimmed.isEmpty ? nil : trimmed
    }

    static func normalized(_ bash: Bash) -> Bash {
        var b = bash
        b.name = cleanName(bash.name) ?? "Untitled bash"
        b.cover.icon = Icons.resolve(bash.cover.icon)
        b.cover.color = HexColor.clean(bash.cover.color, fallback: colors[0])
        b.cover.iconColor = HexColor.clean(bash.cover.iconColor, fallback: "#ffffff")
        b.clips = bash.clips.map { clip in
            var c = clip
            c.offset = min(maxOffset, max(0, (clip.offset * 1000).rounded() / 1000))
            c.volume = min(1, max(0, clip.volume))
            c.lane = max(0, clip.lane)
            if let r = clip.repetition {
                c.repetition = ClipRepeat(
                    gap: min(3600, max(0, (r.gap * 10).rounded() / 10)),
                    times: r.times >= 2 ? min(999, r.times) : 0
                )
            }
            return c
        }
        return b
    }
}
