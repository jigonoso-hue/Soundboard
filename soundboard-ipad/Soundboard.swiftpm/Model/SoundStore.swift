import AVFoundation
import Foundation

/// Sound library: audio files plus a library.json index in Documents/Sounds.
@MainActor
final class SoundStore: ObservableObject {
    @Published private(set) var sounds: [Sound] = []

    let folder: URL
    private var indexURL: URL { folder.appendingPathComponent("library.json") }

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
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        folder = documents.appendingPathComponent("Sounds", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        load()
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
        let sound = Sound(
            id: id,
            name: Self.clean(name).isEmpty ? "Untitled" : Self.clean(name),
            fileName: fileName,
            colorIndex: sounds.count % Palette.colors.count,
            volume: 1,
            createdAt: Date(),
            source: source
        )
        sounds.append(sound)
        save()
        return sound
    }

    private func load() {
        guard let data = try? Data(contentsOf: indexURL),
              let decoded = try? decoder.decode([Sound].self, from: data) else { return }
        // Drop entries whose audio file has gone missing.
        sounds = decoded.filter { FileManager.default.fileExists(atPath: url(for: $0).path) }
    }

    private func save() {
        guard let data = try? encoder.encode(sounds) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    private static func clean(_ name: String) -> String {
        String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
    }
}
