import Foundation

/// What a section holds. Sound sections can hold any sound or bash (the kind
/// decides what the library panel shows first); ambience sections hold loops.
enum SectionKind: String, Codable, CaseIterable {
    case bashes, clips, full, mixed, ambience

    var label: String {
        switch self {
        case .bashes: return "Bashes"
        case .clips: return "Clips"
        case .full: return "Full sounds"
        case .mixed: return "Anything"
        case .ambience: return "Ambience"
        }
    }

    var icon: String {
        switch self {
        case .bashes: return "bolt"
        case .clips: return "scissors"
        case .full: return "note"
        case .mixed: return "grid"
        case .ambience: return "layers"
        }
    }
}

enum ItemSize: String, Codable, CaseIterable {
    case s, m, l

    var label: String {
        switch self {
        case .s: return "Small"
        case .m: return "Medium"
        case .l: return "Large"
        }
    }
}

struct KitItem: Codable, Hashable {
    enum ItemType: String, Codable { case sound, bash }
    var type: ItemType
    var id: UUID
}

/// A looping layer in an ambience section: a built-in loop or a library sound.
struct KitLayer: Identifiable, Codable, Equatable {
    var id: UUID
    var kind: AmbienceLayer.Kind
    /// Built-in file name, or a library sound's UUID string.
    var ref: String
    var volume: Double
    /// Plays now and then (seconds between plays) instead of looping.
    var every: [Double]? = nil
    /// Was playing when you left the kit: comes back when the kit starts on opening.
    var on: Bool? = nil
}

/// A box on the kit's 12-column board. x and w are columns; y and h are rows.
struct KitSection: Identifiable, Codable, Equatable {
    var id: UUID
    var title: String
    var kind: SectionKind
    var x: Int
    var y: Int
    var w: Int
    var h: Int
    var size: ItemSize
    var items: [KitItem]
    var layers: [KitLayer]
    /// The section's own volume slider: nil when the section doesn't show one.
    var volume: Double? = nil
    /// Shows a shuffle button that plays a random item from the section.
    var shuffle: Bool? = nil
    /// A playlist: its full sounds play one after another, crossfading.
    var playlist: Bool? = nil
    /// The playlist plays in a random order.
    var playlistShuffle: Bool? = nil

    var isAmbience: Bool { kind == .ambience }
    /// Level applied to everything played from this section.
    var gain: Double { volume ?? 1 }
    var hasShuffle: Bool { shuffle == true && !isAmbience }
    var isPlaylist: Bool { playlist == true && !isAmbience }
    var count: Int { isAmbience ? layers.count : items.count }

    /// Voice name for one of this section's layers in the ambience mixer.
    func voiceId(_ layer: KitLayer) -> String { "kit-\(id.uuidString)-\(layer.id.uuidString)" }
}

/// A board for one scene, such as "Tavern Brawl", holding sounds, bashes and ambience.
struct SoundKit: Identifiable, Codable, Equatable {
    var id: UUID
    var name: String
    var icon: String
    var color: String
    var iconColor: String
    var sections: [KitSection]
    var createdAt: Date
    /// Opening the kit fades in its music and ambience, fading out what was playing.
    var autoplay: Bool? = nil

    var hasAmbience: Bool { sections.contains { $0.isAmbience } }
    var allItems: [KitItem] { sections.flatMap(\.items) }
}

/// Scene kits, stored in kits.json next to the sounds.
@MainActor
final class KitStore: ObservableObject {
    static let columns = 12
    static let icons = ["mug", "dragon", "castle", "pine", "crossed-swords", "skull", "wave", "flame", "wizard-hat", "crown",
                        "candle", "storm", "map", "jolly-roger", "mask", "moon"]
    static let colors = ["#f5a742", "#ff5d73", "#7c6cff", "#6ee7b7", "#5ec8ff", "#d58bff", "#8a6a4f", "#3f4a5a"]

    @Published private(set) var kits: [SoundKit] = []

    private let indexURL: URL

    init() {
        let folder = SoundStore.folder
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        indexURL = folder.appendingPathComponent("kits.json")
        load()
    }

    func kit(_ id: UUID) -> SoundKit? {
        kits.first { $0.id == id }
    }

    static func defaultSections() -> [KitSection] {
        [
            KitSection(id: UUID(), title: "Bashes", kind: .bashes, x: 0, y: 0, w: 12, h: 4, size: .m, items: [], layers: []),
            KitSection(id: UUID(), title: "Sound Effects", kind: .clips, x: 0, y: 4, w: 7, h: 8, size: .m, items: [], layers: []),
            KitSection(id: UUID(), title: "Music", kind: .full, x: 7, y: 4, w: 5, h: 8, size: .m, items: [], layers: []),
            KitSection(id: UUID(), title: "Ambience", kind: .ambience, x: 0, y: 12, w: 12, h: 5, size: .m, items: [], layers: []),
        ]
    }

    @discardableResult
    func create(name: String?, icon: String? = nil, color: String? = nil, iconColor: String? = nil) -> SoundKit {
        let index = kits.count
        let trimmed = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let kit = Self.normalized(SoundKit(
            id: UUID(),
            name: trimmed.isEmpty ? "Scene Kit \(index + 1)" : trimmed,
            icon: icon ?? Self.icons[index % Self.icons.count],
            color: color ?? Self.colors[index % Self.colors.count],
            iconColor: iconColor ?? "#ffffff",
            sections: Self.defaultSections(),
            createdAt: Date()
        ))
        kits.append(kit)
        save()
        return kit
    }

    /// Saves a kit's name, look and sections (layout and contents).
    func update(_ kit: SoundKit) {
        guard let index = kits.firstIndex(where: { $0.id == kit.id }) else { return }
        var next = Self.normalized(kit)
        next.createdAt = kits[index].createdAt
        kits[index] = next
        save()
    }

    func remove(_ id: UUID) {
        kits.removeAll { $0.id == id }
        save()
    }

    @discardableResult
    func duplicate(_ id: UUID) -> SoundKit? {
        guard let source = kit(id) else { return nil }
        var copy = create(name: "\(source.name) copy", icon: source.icon, color: source.color, iconColor: source.iconColor)
        copy.sections = source.sections.map { section in
            var s = section
            s.id = UUID()
            s.layers = section.layers.map { layer in
                var l = layer
                l.id = UUID()
                return l
            }
            return s
        }
        copy.autoplay = source.autoplay
        update(copy)
        return kit(copy.id)
    }

    /// Adds an item to a section, or (without one) to the section that suits it best.
    func add(_ item: KitItem, to kitId: UUID, section sectionId: UUID? = nil, isFull: Bool = false) {
        guard var kit = kit(kitId) else { return }
        if !kit.sections.contains(where: { !$0.isAmbience }) {
            kit.sections.append(contentsOf: Self.defaultSections().filter { !$0.isAmbience })
        }
        let wanted: SectionKind = item.type == .bash ? .bashes : (isFull ? .full : .clips)
        let target = kit.sections.firstIndex(where: { $0.id == sectionId && !$0.isAmbience })
            ?? kit.sections.firstIndex(where: { $0.kind == wanted })
            ?? kit.sections.firstIndex(where: { $0.kind == .mixed })
            ?? kit.sections.firstIndex(where: { !$0.isAmbience })
        guard let target else { return }
        if !kit.sections[target].items.contains(item) {
            kit.sections[target].items.append(item)
        }
        update(kit)
    }

    /// Drops references to a deleted sound or bash (including ambience layers using the sound).
    func prune(_ type: KitItem.ItemType, id: UUID) {
        var changed = false
        for k in kits.indices {
            for s in kits[k].sections.indices {
                let before = kits[k].sections[s].items.count + kits[k].sections[s].layers.count
                kits[k].sections[s].items.removeAll { $0.type == type && $0.id == id }
                if type == .sound {
                    kits[k].sections[s].layers.removeAll { $0.kind == .sound && $0.ref == id.uuidString }
                }
                if kits[k].sections[s].items.count + kits[k].sections[s].layers.count != before { changed = true }
            }
        }
        if changed { save() }
    }

    // MARK: Layout

    private static func overlaps(_ a: KitSection, _ b: KitSection) -> Bool {
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    }

    /// Sections float up to fill gaps; `fixed` keeps its spot and the others flow around it.
    static func compact(_ sections: inout [KitSection], fixed: UUID? = nil) {
        var placed: [KitSection] = sections.filter { $0.id == fixed }
        let order = sections.indices
            .filter { sections[$0].id != fixed }
            .sorted { (sections[$0].y, sections[$0].x) < (sections[$1].y, sections[$1].x) }
        for index in order {
            var s = sections[index]
            s.y = 0
            while placed.contains(where: { overlaps(s, $0) }) { s.y += 1 }
            sections[index] = s
            placed.append(s)
        }
        if let fixed, let f = sections.firstIndex(where: { $0.id == fixed }) {
            let others = placed.filter { $0.id != fixed }
            while sections[f].y > 0 {
                var up = sections[f]
                up.y -= 1
                if others.contains(where: { overlaps(up, $0) }) { break }
                sections[f] = up
            }
        }
    }

    // MARK: Storage

    private func load() {
        guard let data = try? Data(contentsOf: indexURL),
              let decoded = try? Self.decoder.decode([SoundKit].self, from: data) else { return }
        kits = decoded.map { Self.normalized($0) }
    }

    private func save() {
        guard let data = try? Self.encoder.encode(kits) else { return }
        try? data.write(to: indexURL, options: .atomic)
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

    static func normalized(_ kit: SoundKit) -> SoundKit {
        var k = kit
        let name = kit.name.trimmingCharacters(in: .whitespacesAndNewlines)
        k.name = name.isEmpty ? "Untitled kit" : String(name.prefix(60))
        k.icon = Icons.resolve(kit.icon)
        k.color = HexColor.clean(kit.color, fallback: colors[0])
        k.iconColor = HexColor.clean(kit.iconColor, fallback: "#ffffff")
        var seen = Set<UUID>()
        k.sections = kit.sections.map { section in
            var s = section
            if seen.contains(s.id) { s.id = UUID() }
            seen.insert(s.id)
            let title = section.title.trimmingCharacters(in: .whitespacesAndNewlines)
            s.title = title.isEmpty ? "Section" : String(title.prefix(40))
            s.w = min(columns, max(2, section.w))
            s.x = min(columns - s.w, max(0, section.x))
            s.y = min(500, max(0, section.y))
            s.h = min(40, max(2, section.h))
            if let volume = section.volume { s.volume = min(1, max(0, volume)) }
            if s.isAmbience {
                s.items = []
                var keys = Set<String>()
                s.layers = section.layers.filter { keys.insert("\($0.kind.rawValue):\($0.ref)").inserted }.map { layer in
                    var l = layer
                    l.volume = min(1, max(0, layer.volume))
                    l.every = AmbienceMixer.cleanEvery(layer.every)
                    l.on = layer.on == true ? true : nil
                    return l
                }
                s.playlist = nil
                s.playlistShuffle = nil
            } else {
                s.layers = []
                s.playlist = section.playlist == true ? true : nil
                s.playlistShuffle = s.playlist == true && section.playlistShuffle == true ? true : nil
                var items: [KitItem] = []
                for item in section.items where !items.contains(item) { items.append(item) }
                s.items = items
            }
            return s
        }
        k.autoplay = kit.autoplay == true ? true : nil
        return k
    }
}
