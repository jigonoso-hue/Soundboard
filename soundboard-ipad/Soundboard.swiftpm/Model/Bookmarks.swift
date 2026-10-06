import Foundation

/// A saved moment of the game's sound, to bring back with one tap (next
/// session, or after a detour): the scene kit that was open, the playlists
/// playing (which song, how far in), other songs playing, the ambience layers
/// and their volumes, and the master and ambience volumes. Matches the Mac
/// app's src/bookmarks.js.
struct Bookmark: Identifiable, Codable, Equatable {
    struct PlaylistSpot: Codable, Equatable {
        var kitId: UUID
        var sectionId: UUID
        var songId: UUID
        /// Seconds into the song.
        var position: Double
    }

    struct SongSpot: Codable, Equatable {
        var id: UUID
        var position: Double
        /// A scene kit section's volume slider, when it was played from one.
        var gain: Double
    }

    struct Music: Codable, Equatable {
        var playlists: [PlaylistSpot] = []
        var songs: [SongSpot] = []
    }

    struct Layer: Codable, Equatable {
        /// The voice: a strip layer's id, or a scene kit layer's voice id.
        var id: String
        /// One of the ambience strip's own layers.
        var strip: Bool
        var kind: AmbienceLayer.Kind
        var ref: String
        var volume: Double
        var every: [Double]? = nil
    }

    struct Ambience: Codable, Equatable {
        var volume: Double
        var layers: [Layer] = []
    }

    var id = UUID()
    var name: String
    var at = Date()
    var kitId: UUID?
    var master: Double
    var music = Music()
    var ambience: Ambience

    /// What it brings back, in a few words.
    var summary: String {
        var parts: [String] = []
        let songs = music.playlists.count + music.songs.count
        if songs > 0 { parts.append("\(songs) song\(songs == 1 ? "" : "s")") }
        let layers = ambience.layers.count
        if layers > 0 { parts.append("\(layers) layer\(layers == 1 ? "" : "s")") }
        return parts.isEmpty ? "Silence" : parts.joined(separator: " · ")
    }

    static func cleanName(_ text: String) -> String {
        String(text.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces).prefix(60))
    }
}

@MainActor
final class BookmarkStore: ObservableObject {
    static let limit = 50

    /// Newest first.
    @Published private(set) var bookmarks: [Bookmark] = []
    private let url: URL

    init() {
        let folder = SoundStore.folder
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        url = folder.appendingPathComponent("bookmarks.json")
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode([Bookmark].self, from: data) {
            bookmarks = saved
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(bookmarks) else { return }
        try? data.write(to: url, options: .atomic)
    }

    /// Adds a new bookmark (newest first), or replaces one with the same id.
    func save(_ bookmark: Bookmark) {
        var clean = bookmark
        clean.name = Bookmark.cleanName(clean.name).isEmpty ? "Bookmark" : Bookmark.cleanName(clean.name)
        if let index = bookmarks.firstIndex(where: { $0.id == clean.id }) {
            bookmarks[index] = clean
        } else {
            bookmarks.insert(clean, at: 0)
        }
        bookmarks = Array(bookmarks.prefix(Self.limit))
        save()
    }

    func rename(_ id: UUID, to name: String) {
        let clean = Bookmark.cleanName(name)
        guard !clean.isEmpty, let index = bookmarks.firstIndex(where: { $0.id == id }) else { return }
        bookmarks[index].name = clean
        save()
    }

    func remove(_ id: UUID) {
        bookmarks.removeAll { $0.id == id }
        save()
    }

    /// A scene kit was deleted: its bookmarks forget it (their sound still comes back).
    func forgetKit(_ kitId: UUID) {
        var changed = false
        for i in bookmarks.indices {
            if bookmarks[i].kitId == kitId { bookmarks[i].kitId = nil; changed = true }
            let before = bookmarks[i].music.playlists.count
            bookmarks[i].music.playlists.removeAll { $0.kitId == kitId }
            if bookmarks[i].music.playlists.count != before { changed = true }
        }
        if changed { save() }
    }
}
