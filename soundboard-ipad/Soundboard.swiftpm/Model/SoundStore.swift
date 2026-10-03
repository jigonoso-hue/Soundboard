import AVFoundation
import Foundation

/// Sound library: audio files plus a library.json index in Documents/Sounds.
/// Custom tags live in tags.json next to it.
@MainActor
final class SoundStore: ObservableObject {
    @Published private(set) var sounds: [Sound] = []
    /// Tags the user made (the premade ones are in TagStyle.premade).
    @Published private(set) var customTags: [String] = []
    /// Sounds added since the "Tag new sounds" sheet last ran.
    @Published var recentlyAdded: [UUID] = []

    /// Shared by the bash and scene kit stores.
    static var folder: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Sounds", isDirectory: true)
    }

    let folder: URL
    private var indexURL: URL { folder.appendingPathComponent("library.json") }
    private var tagsURL: URL { folder.appendingPathComponent("tags.json") }

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = .prettyPrinted
        return e
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    init() {
        folder = Self.folder
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        load()
        loadTags()
    }

    func sound(_ id: UUID) -> Sound? {
        sounds.first { $0.id == id }
    }

    // MARK: Tags

    /// Premade tags, then the user's own, then any others found on sounds.
    var allTags: [String] {
        var all = TagStyle.premade + customTags
        for sound in sounds {
            for tag in sound.tagList where !all.contains(tag) { all.append(tag) }
        }
        return all
    }

    /// Adds a custom tag and returns its cleaned name, or nil if nothing is left after cleaning.
    @discardableResult
    func addTag(_ name: String) -> String? {
        let tag = TagStyle.clean(name)
        guard !tag.isEmpty else { return nil }
        if !TagStyle.premade.contains(tag) && !customTags.contains(tag) {
            customTags.append(tag)
            saveTags()
        }
        return tag
    }

    /// Deletes a custom tag and takes it off every sound.
    func removeTag(_ tag: String) {
        customTags.removeAll { $0 == tag }
        saveTags()
        var changed = false
        for index in sounds.indices where sounds[index].tagList.contains(tag) {
            sounds[index].tags = sounds[index].tagList.filter { $0 != tag }
            changed = true
        }
        if changed { save() }
    }

    private func loadTags() {
        guard let data = try? Data(contentsOf: tagsURL),
              let saved = try? JSONDecoder().decode([String].self, from: data) else { return }
        customTags = saved.map(TagStyle.clean).filter { !$0.isEmpty }
    }

    private func saveTags() {
        if let data = try? JSONEncoder().encode(customTags) {
            try? data.write(to: tagsURL, options: .atomic)
        }
    }

    private static func cleanTags(_ tags: [String]?) -> [String]? {
        guard let tags else { return nil }
        var out: [String] = []
        for tag in tags.map(TagStyle.clean) where !tag.isEmpty && !out.contains(tag) { out.append(tag) }
        return out
    }

    /// Length of an audio file in seconds, or nil if it can't be read.
    static func measure(_ url: URL) -> Double? {
        guard let player = try? AVAudioPlayer(contentsOf: url), player.duration.isFinite, player.duration > 0 else { return nil }
        return player.duration
    }

    func url(for sound: Sound) -> URL {
        folder.appendingPathComponent(sound.fileName)
    }

    @discardableResult
    func add(data: Data, ext: String, name: String, source: SoundSource? = nil) throws -> Sound {
        let id = UUID()
        let fileName = "\(id.uuidString).\(ext.lowercased())"
        try data.write(to: folder.appendingPathComponent(fileName), options: .atomic)
        return insert(id: id, fileName: fileName, name: name, source: source)
    }

    /// Copies an audio file into the library, rejecting files the iPad can't play.
    @discardableResult
    func addFile(at source: URL, name: String, source origin: SoundSource? = nil) throws -> Sound {
        let id = UUID()
        let ext = source.pathExtension.isEmpty ? "m4a" : source.pathExtension.lowercased()
        let fileName = "\(id.uuidString).\(ext)"
        let destination = folder.appendingPathComponent(fileName)
        try FileManager.default.copyItem(at: source, to: destination)
        do {
            _ = try AVAudioPlayer(contentsOf: destination)
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw SoundError.unsupported(source.lastPathComponent)
        }
        return insert(id: id, fileName: fileName, name: name, source: origin)
    }

    func update(_ sound: Sound) {
        guard let index = sounds.firstIndex(where: { $0.id == sound.id }) else { return }
        var updated = sound
        updated.name = Self.clean(sound.name).isEmpty ? sounds[index].name : Self.clean(sound.name)
        updated.volume = min(1, max(0, sound.volume))
        if let gap = sound.repeatGap { updated.repeatGap = min(3600, max(0, (gap * 10).rounded() / 10)) }
        updated.tags = Self.cleanTags(sound.tags)
        // Edits never change where the file is or when it was added.
        updated.fileName = sounds[index].fileName
        updated.createdAt = sounds[index].createdAt
        sounds[index] = updated
        save()
    }

    func remove(_ id: UUID) {
        guard let index = sounds.firstIndex(where: { $0.id == id }) else { return }
        let sound = sounds.remove(at: index)
        save()
        try? FileManager.default.removeItem(at: url(for: sound))
    }

    /// Moves the sound `id` so it sits just before `target`.
    func move(_ id: UUID, before target: UUID) {
        guard id != target, let from = sounds.firstIndex(where: { $0.id == id }) else { return }
        let sound = sounds.remove(at: from)
        let to = sounds.firstIndex(where: { $0.id == target }) ?? sounds.count
        sounds.insert(sound, at: to)
        save()
    }

    private func insert(id: UUID, fileName: String, name: String, source: SoundSource?) -> Sound {
        let duration = Self.measure(folder.appendingPathComponent(fileName))
        var sound = Sound(
            id: id,
            name: Self.clean(name).isEmpty ? "Untitled" : Self.clean(name),
            fileName: fileName,
            colorIndex: sounds.count % Palette.colors.count,
            volume: 1,
            createdAt: Date(),
            source: source
        )
        sound.duration = duration
        sound.tags = []
        // A whole saved video is a full sound even if it's short.
        sound.kind = source?.full == true || (duration ?? 0) >= SoundKind.fullSoundSeconds ? .full : .clip
        sounds.append(sound)
        save()
        recentlyAdded.append(id)
        return sound
    }

    private func load() {
        guard let data = try? Data(contentsOf: indexURL),
              let decoded = try? decoder.decode([Sound].self, from: data) else { return }
        // Drop entries whose audio file has gone missing.
        sounds = decoded.filter { FileManager.default.fileExists(atPath: url(for: $0).path) }
        // Sounds from before kinds and durations existed: measure them once.
        var changed = false
        for index in sounds.indices where sounds[index].duration == nil {
            sounds[index].duration = Self.measure(url(for: sounds[index]))
            if sounds[index].kind == nil, let duration = sounds[index].duration {
                sounds[index].kind = duration >= SoundKind.fullSoundSeconds ? .full : .clip
            }
            changed = true
        }
        if changed { save() }
    }

    private func save() {
        guard let data = try? encoder.encode(sounds) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    private static func clean(_ name: String) -> String {
        String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
    }
}
