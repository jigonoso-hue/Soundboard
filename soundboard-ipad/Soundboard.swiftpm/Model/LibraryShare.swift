import Compression
import Foundation

/// Sharing a whole library between the apps (iPhone/iPad, Mac, Android): one
/// zip file holding dungeon-radio-library.json (the sounds, bashes, scene
/// kits and custom tags) beside the sound files (sounds/<id>.<ext>) and bash
/// cover pictures (covers/<id>.<ext>). Every app writes this same file and
/// reads it back. The Mac and Android follow the same rules in
/// soundboard-mac/src/library-share.js; keep the two in step.
///
/// Importing adds to the library; it never replaces anything. Something
/// already here (the same id, or for a sound the very same audio) is kept
/// and the import points at it, so importing a file twice adds nothing.
@MainActor
enum LibraryShare {
    static let manifestName = "dungeon-radio-library.json"
    static let format = "dungeon-radio-library"
    static let version = 1
    static let fileName = "Dungeon Radio Library.zip"
    static let audioTypes = ["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "webm", "aiff", "aif", "caf", "mp4"]
    static let coverTypes = ["png", "jpg", "jpeg", "gif", "webp"]
    /// Sound colours by index (Palette), as the Mac stores them.
    static let paletteHex = ["#ff5d73", "#ffb347", "#ffe156", "#6ee7b7", "#5ec8ff", "#8b8cff", "#d58bff", "#ff8fd1"]

    enum ShareError: LocalizedError {
        case notLibrary, newer, damaged, notZip, tooBig, premium(PremiumRules.Limit)

        var errorDescription: String? {
            switch self {
            case .notLibrary: return "That file isn’t a Dungeon Radio library."
            case .newer: return "That library was made by a newer Dungeon Radio. Update the app to open it."
            case .damaged: return "That library file is damaged."
            case .notZip: return "That isn’t a zip file."
            case .tooBig: return "The library is too big to share as one file (over 4 GB)."
            case .premium(let limit): return limit.message
            }
        }
    }

    struct Exported {
        let url: URL
        let sounds: Int
        let bashes: Int
        let kits: Int
        let bytes: Int
    }

    struct Imported {
        var sounds = 0
        var bashes = 0
        var kits = 0
        var skipped = 0

        /// "Added 12 sounds, 3 bashes and 2 scene kits." (the same words as the Mac's describeImport).
        var message: String {
            func n(_ count: Int, _ one: String, _ many: String) -> String { "\(count) \(count == 1 ? one : many)" }
            var parts: [String] = []
            if sounds > 0 { parts.append(n(sounds, "sound", "sounds")) }
            if bashes > 0 { parts.append(n(bashes, "bash", "bashes")) }
            if kits > 0 { parts.append(n(kits, "scene kit", "scene kits")) }
            guard let last = parts.last else { return "Everything in that file is already in your library." }
            let list = parts.count > 1 ? "\(parts.dropLast().joined(separator: ", ")) and \(last)" : last
            let already = skipped > 0 ? " \(n(skipped, "thing was", "things were")) already in your library." : ""
            return "Added \(list).\(already)"
        }
    }

    private static let iso = ISO8601DateFormatter()
    private static let isoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    /// A date from the file: the Mac writes fractions of a second, this app doesn't.
    private static func date(_ value: Any?) -> Date? {
        guard let text = value as? String else { return nil }
        return iso.date(from: text) ?? isoFraction.date(from: text)
    }
    private static func lower(_ id: UUID) -> String { id.uuidString.lowercased() }
    private static func ext(_ file: String) -> String { (file as NSString).pathExtension.lowercased() }

    // MARK: Export

    /// Packs the library into a zip in the temporary folder, ready to share.
    /// The list is made here; the zip is written in the background.
    static func export(store: SoundStore, bashes: BashStore, kits: KitStore) async throws -> Exported {
        var files: [(name: String, url: URL)] = []
        var sounds: [[String: Any]] = []
        var soundIds = Set<UUID>()
        for s in store.sounds {
            let e = ext(s.fileName)
            let url = store.url(for: s)
            guard audioTypes.contains(e), FileManager.default.fileExists(atPath: url.path) else { continue }
            let name = "sounds/\(lower(s.id)).\(e)"
            files.append((name, url))
            soundIds.insert(s.id)
            var entry: [String: Any] = [
                "id": lower(s.id), "name": s.name, "file": name,
                "color": paletteHex[((s.colorIndex % paletteHex.count) + paletteHex.count) % paletteHex.count],
                "volume": s.volume, "tags": s.tagList,
                "kind": (s.kind?.rawValue as Any?) ?? NSNull(), "duration": (s.duration as Any?) ?? NSNull(),
                "repeat": s.repeatGap.map { ["gap": $0] as Any } ?? NSNull(),
                "createdAt": iso.string(from: s.createdAt),
            ]
            if s.gmOnly == true { entry["gmOnly"] = true }
            if s.buzz == true { entry["buzz"] = true }
            if let source = s.source {
                var src: [String: Any] = ["title": source.title, "url": source.url, "start": source.start, "end": source.end]
                if source.full == true { src["full"] = true }
                entry["source"] = src
            } else {
                entry["source"] = NSNull()
            }
            sounds.append(entry)
        }
        var bashList: [[String: Any]] = []
        var bashIds = Set<UUID>()
        for b in bashes.bashes {
            var cover: [String: Any] = ["type": "icon", "icon": b.cover.icon, "color": b.cover.color, "iconColor": b.cover.iconColor]
            if let image = b.cover.imageFile, coverTypes.contains(ext(image)),
               FileManager.default.fileExists(atPath: bashes.coverURL(image).path) {
                let name = "covers/\(lower(b.id)).\(ext(image))"
                files.append((name, bashes.coverURL(image)))
                cover = ["type": "image", "file": name]
            }
            bashIds.insert(b.id)
            bashList.append([
                "id": lower(b.id), "name": b.name, "cover": cover, "createdAt": iso.string(from: b.createdAt),
                "clips": b.clips.filter { soundIds.contains($0.soundId) }.map { c -> [String: Any] in
                    [
                        "id": lower(c.id), "soundId": lower(c.soundId), "offset": c.offset, "volume": c.volume, "lane": c.lane,
                        "repeat": c.repetition.map { ["gap": $0.gap, "times": $0.times] as Any } ?? NSNull(),
                    ]
                },
            ])
        }
        let kitList: [[String: Any]] = kits.kits.map { k in
            var kit: [String: Any] = [
                "id": lower(k.id), "name": k.name, "icon": k.icon, "color": k.color, "iconColor": k.iconColor,
                "createdAt": iso.string(from: k.createdAt),
                "sections": k.sections.map { s -> [String: Any] in
                    var section: [String: Any] = [
                        "id": lower(s.id), "title": s.title, "kind": s.kind.rawValue,
                        "x": s.x, "y": s.y, "w": s.w, "h": s.h, "size": s.size.rawValue,
                        "items": s.items.filter { $0.type == .sound ? soundIds.contains($0.id) : bashIds.contains($0.id) }
                            .map { ["type": $0.type.rawValue, "id": lower($0.id)] },
                        "layers": s.layers.compactMap { l -> [String: Any]? in
                            var ref = l.ref
                            if l.kind == .sound {
                                guard let sid = UUID(uuidString: l.ref), soundIds.contains(sid) else { return nil }
                                ref = lower(sid)
                            }
                            var layer: [String: Any] = ["id": lower(l.id), "kind": l.kind.rawValue, "ref": ref, "volume": l.volume]
                            if let every = l.every { layer["every"] = every }
                            if l.on == true { layer["on"] = true }
                            return layer
                        },
                    ]
                    if let volume = s.volume { section["volume"] = volume }
                    if s.isPlaylist {
                        section["playlist"] = true
                        if s.playlistShuffle == true { section["playlistShuffle"] = true }
                        if let loop = s.playlistLoop { section["playlistLoop"] = loop }
                    }
                    return section
                },
            ]
            if k.autoplay == true { kit["autoplay"] = true }
            return kit
        }
        let manifest: [String: Any] = [
            "format": format, "version": version, "app": "iPhone/iPad", "exportedAt": iso.string(from: Date()),
            "tags": store.customTags, "sounds": sounds, "bashes": bashList, "kits": kitList,
        ]
        let data = try JSONSerialization.data(withJSONObject: manifest)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Share", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let out = folder.appendingPathComponent(fileName)
        let entries: [(String, LibraryZip.Source)] = [(manifestName, .data(data))] + files.map { ($0.name, .file($0.url)) }
        try await Task.detached(priority: .userInitiated) { try LibraryZip.write(to: out, entries: entries) }.value
        let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
        return Exported(url: out, sounds: sounds.count, bashes: bashList.count, kits: kitList.count, bytes: bytes)
    }

    // MARK: Import

    /// Adds a library file's sounds, bashes, kits and tags to this library.
    static func importLibrary(from url: URL, store: SoundStore, bashes: BashStore, kits: KitStore) throws -> Imported {
        let zip = try ZipReader(url: url)
        guard let raw = try zip.read(manifestName),
              let m = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              m["format"] as? String == format else { throw ShareError.notLibrary }
        guard let v = m["version"] as? Int, v >= 1 else { throw ShareError.damaged }
        if v > version { throw ShareError.newer }
        let list = { (key: String) -> [[String: Any]] in Array(((m[key] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }.prefix(20000)) }

        // Sounds: which are new, and where the rest already are.
        var soundMap: [UUID: UUID] = [:]
        var newSounds: [(entry: [String: Any], id: UUID, file: String)] = []
        var sizes: [Int: [Sound]] = [:]
        for s in store.sounds {
            let size = (try? FileManager.default.attributesOfItem(atPath: store.url(for: s).path)[.size] as? Int) ?? -1
            sizes[size, default: []].append(s)
        }
        var seen = Set<UUID>()
        var total = 0
        for entry in list("sounds") {
            guard let id = uuid(entry["id"]), !seen.contains(id), let file = entry["file"] as? String,
                  file.hasPrefix("sounds/"), LibraryZip.isSafeName(file), audioTypes.contains(ext(file)) else { continue }
            seen.insert(id)
            total += 1
            if store.sound(id) != nil { soundMap[id] = id; continue }
            guard let size = zip.size(file) else { continue }
            if let candidates = sizes[size], let incoming = try zip.read(file),
               let same = candidates.first(where: { (try? Data(contentsOf: store.url(for: $0))) == incoming }) {
                soundMap[id] = same.id
                continue
            }
            soundMap[id] = id
            newSounds.append((entry, id, file))
        }
        let bashEntries = list("bashes").filter { uuid($0["id"]) != nil }
        let kitEntries = list("kits").filter { uuid($0["id"]) != nil && $0["sections"] is [Any] }
        let newBashes = bashEntries.filter { bashes.bash(uuid($0["id"])!) == nil }
        let newKits = kitEntries.filter { kits.kit(uuid($0["id"])!) == nil }

        // The free version's limits, for everything new at once.
        if !Premium.shared.isPremium {
            let newFull = newSounds.filter { $0.entry["kind"] as? String == "full" }.count
            let full = store.sounds.filter(\.isFull).count
            let clips = store.sounds.count - full
            var limit: PremiumRules.Limit?
            if clips + newSounds.count - newFull > PremiumRules.Limit.clips.max { limit = .clips }
            else if full + newFull > PremiumRules.Limit.full.max { limit = .full }
            else if bashes.bashes.count + newBashes.count > PremiumRules.Limit.bashes.max { limit = .bashes }
            else if kits.kits.count + newKits.count > PremiumRules.Limit.kits.max { limit = .kits }
            if let limit {
                Premium.shared.request = PremiumRequest(reason: limit.message)
                throw ShareError.premium(limit)
            }
        }

        for tag in ((m["tags"] as? [Any]) ?? []).compactMap({ $0 as? String }).prefix(500) { _ = store.addTag(tag) }
        var result = Imported()
        for (entry, id, file) in newSounds {
            guard let data = try? zip.read(file) else { soundMap[id] = nil; continue }
            var sound = Sound(
                id: id,
                name: clean(entry["name"], 80) ?? "Untitled",
                fileName: "",
                colorIndex: max(0, paletteHex.firstIndex(of: ((entry["color"] as? String) ?? "").lowercased()) ?? 0),
                volume: number(entry["volume"], 0, 1) ?? 1,
                createdAt: date(entry["createdAt"]) ?? Date(),
                source: source(entry["source"])
            )
            if let r = entry["repeat"] as? [String: Any] { sound.repeatGap = number(r["gap"], 0, 3600) ?? 0 }
            sound.tags = ((entry["tags"] as? [Any]) ?? []).compactMap { $0 as? String }.map(TagStyle.clean).filter { !$0.isEmpty }
            sound.kind = (entry["kind"] as? String).flatMap(SoundKind.init(rawValue:))
            sound.duration = number(entry["duration"], 0, 24 * 3600).flatMap { $0 > 0 ? $0 : nil }
            if entry["gmOnly"] as? Bool == true { sound.gmOnly = true }
            if entry["buzz"] as? Bool == true { sound.buzz = true }
            do {
                let added = try store.importSound(sound, data: data, ext: ext(file))
                soundMap[id] = added.id
                result.sounds += 1
            } catch {
                soundMap[id] = nil
            }
        }
        let soundId = { (raw: Any?) -> UUID? in
            guard let id = uuid(raw) else { return nil }
            return soundMap[id] ?? (store.sound(id) != nil ? id : nil)
        }

        for entry in newBashes {
            let coverDict = (entry["cover"] as? [String: Any]) ?? [:]
            var cover: (data: Data, ext: String)?
            if coverDict["type"] as? String == "image", let file = coverDict["file"] as? String,
               file.hasPrefix("covers/"), LibraryZip.isSafeName(file), coverTypes.contains(ext(file)),
               let data = try? zip.read(file) {
                cover = (data, ext(file))
            }
            let clips: [BashClip] = ((entry["clips"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }.compactMap { c in
                guard let sid = soundId(c["soundId"]) else { return nil }
                var clip = BashClip(id: uuid(c["id"]) ?? UUID(), soundId: sid, offset: number(c["offset"], 0, 3600) ?? 0,
                                    volume: number(c["volume"], 0, 1) ?? 1, lane: Int(number(c["lane"], 0, 999) ?? 0))
                if let r = c["repeat"] as? [String: Any] {
                    clip.repetition = ClipRepeat(gap: number(r["gap"], 0, 3600) ?? 0, times: Int(number(r["times"], 0, 999) ?? 0))
                }
                return clip
            }
            let bash = Bash(
                id: uuid(entry["id"])!,
                name: clean(entry["name"], 80) ?? "Untitled bash",
                cover: BashCover(icon: (coverDict["icon"] as? String) ?? BashStore.icons[0],
                                 color: (coverDict["color"] as? String) ?? BashStore.colors[0],
                                 iconColor: (coverDict["iconColor"] as? String) ?? "#ffffff"),
                clips: clips,
                createdAt: date(entry["createdAt"]) ?? Date()
            )
            bashes.importBash(bash, cover: cover)
            result.bashes += 1
        }

        for entry in newKits {
            let sections: [KitSection] = ((entry["sections"] as? [Any]) ?? []).prefix(200).compactMap { $0 as? [String: Any] }.map { s in
                let kind = (s["kind"] as? String).flatMap(SectionKind.init(rawValue:)) ?? .mixed
                let items: [KitItem] = kind == .ambience ? [] : ((s["items"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }.compactMap { i in
                    switch i["type"] as? String {
                    case "sound": return soundId(i["id"]).map { KitItem(type: .sound, id: $0) }
                    case "bash":
                        guard let id = uuid(i["id"]), bashes.bash(id) != nil else { return nil }
                        return KitItem(type: .bash, id: id)
                    default: return nil
                    }
                }
                let layers: [KitLayer] = kind != .ambience ? [] : ((s["layers"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }.compactMap { l in
                    let volume = number(l["volume"], 0, 1) ?? 0.7
                    var layer: KitLayer
                    switch l["kind"] as? String {
                    case "builtin":
                        guard let ref = l["ref"] as? String, ref.range(of: "^[a-z0-9-]+\\.wav$", options: .regularExpression) != nil else { return nil }
                        layer = KitLayer(id: uuid(l["id"]) ?? UUID(), kind: .builtin, ref: ref, volume: volume)
                    case "sound":
                        guard let sid = soundId(l["ref"]) else { return nil }
                        layer = KitLayer(id: uuid(l["id"]) ?? UUID(), kind: .sound, ref: sid.uuidString, volume: volume)
                    default: return nil
                    }
                    if let every = l["every"] as? [Any], every.count == 2,
                       let lo = number(every[0], 1, 3600), let hi = number(every[1], 1, 3600) { layer.every = [lo, hi] }
                    if l["on"] as? Bool == true { layer.on = true }
                    return layer
                }
                var section = KitSection(
                    id: uuid(s["id"]) ?? UUID(),
                    title: clean(s["title"], 40) ?? "Section",
                    kind: kind,
                    x: Int(number(s["x"], 0, 11) ?? 0), y: Int(number(s["y"], 0, 500) ?? 0),
                    w: Int(number(s["w"], 2, 12) ?? 6), h: Int(number(s["h"], 2, 40) ?? 6),
                    size: (s["size"] as? String).flatMap(ItemSize.init(rawValue:)) ?? .m,
                    items: items, layers: layers
                )
                section.volume = number(s["volume"], 0, 1)
                if kind != .ambience && (s["playlist"] as? Bool == true || s["shuffle"] as? Bool == true) {
                    section.playlist = true
                    if s["playlistShuffle"] as? Bool == true { section.playlistShuffle = true }
                    if let loop = s["playlistLoop"] as? String, ["one", "off"].contains(loop) { section.playlistLoop = loop }
                }
                return section
            }
            var kit = SoundKit(
                id: uuid(entry["id"])!,
                name: clean(entry["name"], 60) ?? "Untitled kit",
                icon: (entry["icon"] as? String) ?? KitStore.icons[0],
                color: (entry["color"] as? String) ?? KitStore.colors[0],
                iconColor: (entry["iconColor"] as? String) ?? "#ffffff",
                sections: sections,
                createdAt: date(entry["createdAt"]) ?? Date()
            )
            if entry["autoplay"] as? Bool == true { kit.autoplay = true }
            kits.importKit(kit)
            result.kits += 1
        }
        result.skipped = (total - newSounds.count) + (bashEntries.count - newBashes.count) + (kitEntries.count - newKits.count)
        return result
    }

    // MARK: Reading fields from someone else's file

    private static func uuid(_ value: Any?) -> UUID? {
        guard let text = value as? String, text.count == 36 else { return nil }
        return UUID(uuidString: text)
    }

    private static func number(_ value: Any?, _ low: Double, _ high: Double) -> Double? {
        guard let n = (value as? NSNumber)?.doubleValue, n.isFinite else { return nil }
        return min(high, max(low, n))
    }

    private static func clean(_ value: Any?, _ max: Int) -> String? {
        guard let text = value as? String else { return nil }
        let scalars = text.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }
        let cleaned = String(String.UnicodeScalarView(scalars)).trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : String(cleaned.prefix(max))
    }

    private static func source(_ value: Any?) -> SoundSource? {
        guard let s = value as? [String: Any] else { return nil }
        let url = clean(s["url"], 500) ?? ""
        guard url.isEmpty || url.hasPrefix("https://") else { return nil }
        var source = SoundSource(title: clean(s["title"], 200) ?? "", url: url,
                                 start: number(s["start"], 0, 1e6) ?? 0, end: number(s["end"], 0, 1e6) ?? 0)
        if s["full"] as? Bool == true { source.full = true }
        return source
    }
}

// MARK: - Zip

/// A small zip writer and reader for shared libraries, the same files the
/// Mac's zip.js and Android's LibraryZip.kt make: compressed audio and
/// pictures are stored as they are, the list of sounds and wav or aiff audio
/// are deflated (raw DEFLATE, Compression's ZLIB) when that makes them smaller.
enum LibraryZip {
    enum Source {
        case data(Data)
        case file(URL)
    }

    private static let deflateTypes = ["json", "wav", "aif", "aiff", "caf"]
    private static let maxEntry = 2 * 1024 * 1024 * 1024

    /// Only these names are ever read from a library file: never a path that leaves its folder.
    static func isSafeName(_ name: String) -> Bool {
        if name == LibraryShare.manifestName { return true }
        let parts = name.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0] == "sounds" || parts[0] == "covers" else { return false }
        let file = parts[1].split(separator: ".", omittingEmptySubsequences: false)
        guard file.count == 2, file[0].count == 36, (1...5).contains(file[1].count) else { return false }
        let hex = CharacterSet(charactersIn: "0123456789abcdef-")
        let alnum = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789")
        return file[0].unicodeScalars.allSatisfy { hex.contains($0) } && file[1].unicodeScalars.allSatisfy { alnum.contains($0) }
    }

    static func write(to url: URL, entries: [(String, Source)]) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        var central = Data()
        var offset = 0
        var count = 0
        let (time, day) = dosTime(Date())
        for (name, source) in entries {
            let raw: Data
            switch source {
            case .data(let data): raw = data
            case .file(let file): raw = try Data(contentsOf: file, options: .mappedIfSafe)
            }
            var body = raw
            var method: UInt16 = 0
            if deflateTypes.contains((name as NSString).pathExtension.lowercased()), let packed = deflate(raw) {
                body = packed
                method = 8
            }
            let nameBytes = Data(name.utf8)
            let crc = crc32(raw)
            guard offset + 30 + nameBytes.count + body.count < Int(UInt32.max) else { throw LibraryShare.ShareError.tooBig }
            var local = Data()
            local.put32(0x04034b50); local.put16(20); local.put16(0x0800); local.put16(method); local.put16(time); local.put16(day)
            local.put32(crc); local.put32(UInt32(body.count)); local.put32(UInt32(raw.count)); local.put16(UInt16(nameBytes.count)); local.put16(0)
            try handle.write(contentsOf: local + nameBytes)
            try handle.write(contentsOf: body)
            central.put32(0x02014b50); central.put16(20); central.put16(20); central.put16(0x0800); central.put16(method)
            central.put16(time); central.put16(day); central.put32(crc); central.put32(UInt32(body.count)); central.put32(UInt32(raw.count))
            central.put16(UInt16(nameBytes.count)); central.put16(0); central.put16(0); central.put16(0); central.put16(0); central.put32(0)
            central.put32(UInt32(offset))
            central.append(nameBytes)
            offset += local.count + nameBytes.count + body.count
            count += 1
        }
        var end = Data()
        end.put32(0x06054b50); end.put16(0); end.put16(0); end.put16(UInt16(count)); end.put16(UInt16(count))
        end.put32(UInt32(central.count)); end.put32(UInt32(offset)); end.put16(0)
        try handle.write(contentsOf: central + end)
    }

    static func deflate(_ data: Data) -> Data? {
        guard !data.isEmpty else { return nil }
        let capacity = data.count + 1024
        var out = Data(count: capacity)
        let written = out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                compression_encode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, capacity,
                                          src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written > 0, written < data.count else { return nil }
        out.count = written
        return out
    }

    static func inflate(_ data: Data, size: Int) -> Data? {
        if size == 0 { return Data() }
        guard !data.isEmpty else { return nil }
        var out = Data(count: size)
        let written = out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, size,
                                          src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        return written == size ? out : nil
    }

    private static let crcTable: [UInt32] = (0..<256).map { n in
        var c = UInt32(n)
        for _ in 0..<8 { c = c & 1 != 0 ? 0xedb88320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xffffffff
        data.withUnsafeBytes { bytes in
            for byte in bytes.bindMemory(to: UInt8.self) { crc = crcTable[Int((crc ^ UInt32(byte)) & 0xff)] ^ (crc >> 8) }
        }
        return crc ^ 0xffffffff
    }

    private static func dosTime(_ date: Date) -> (UInt16, UInt16) {
        let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let time = ((c.hour ?? 0) << 11) | ((c.minute ?? 0) << 5) | ((c.second ?? 0) / 2)
        let day = ((max(1980, c.year ?? 1980) - 1980) << 9) | ((c.month ?? 1) << 5) | (c.day ?? 1)
        return (UInt16(time), UInt16(day))
    }
}

/// Reads a zip's files by name, through its central directory (so zips with
/// data descriptors, as Android writes, read too). Stored and deflated only.
final class ZipReader {
    private struct Entry {
        let method: Int
        let crc: UInt32
        let compressed: Int
        let size: Int
        let offset: Int
    }

    private let handle: FileHandle
    private var entries: [String: Entry] = [:]

    init(url: URL) throws {
        handle = try FileHandle(forReadingFrom: url)
        do {
            let total = Int(try handle.seekToEnd())
            let tailLength = min(total, 22 + 0xffff)
            let tail = try read(at: total - tailLength, count: tailLength)
            guard tail.count >= 22 else { throw LibraryShare.ShareError.notZip }
            var at = -1
            var i = tail.count - 22
            while i >= 0 {
                if tail.u32(i) == 0x06054b50 { at = i; break }
                i -= 1
            }
            guard at >= 0 else { throw LibraryShare.ShareError.notZip }
            let count = tail.u16(at + 10)
            let dirSize = Int(tail.u32(at + 12))
            let dirStart = Int(tail.u32(at + 16))
            guard dirStart + dirSize <= total else { throw LibraryShare.ShareError.damaged }
            let dir = try read(at: dirStart, count: dirSize)
            var p = 0
            for _ in 0..<count {
                guard p + 46 <= dir.count, dir.u32(p) == 0x02014b50 else { throw LibraryShare.ShareError.damaged }
                let nameLength = dir.u16(p + 28)
                guard p + 46 + nameLength <= dir.count else { throw LibraryShare.ShareError.damaged }
                let name = String(decoding: dir.subdata(in: dir.startIndex + p + 46 ..< dir.startIndex + p + 46 + nameLength), as: UTF8.self)
                entries[name] = Entry(method: dir.u16(p + 10), crc: dir.u32(p + 16), compressed: Int(dir.u32(p + 20)),
                                      size: Int(dir.u32(p + 24)), offset: Int(dir.u32(p + 42)))
                p += 46 + nameLength + dir.u16(p + 30) + dir.u16(p + 32)
            }
        } catch {
            try? handle.close()
            throw error
        }
    }

    deinit { try? handle.close() }

    func size(_ name: String) -> Int? { entries[name]?.size }

    func read(_ name: String) throws -> Data? {
        guard let e = entries[name] else { return nil }
        guard e.size <= 2 * 1024 * 1024 * 1024, e.compressed <= 2 * 1024 * 1024 * 1024 else { throw LibraryShare.ShareError.tooBig }
        let local = try read(at: e.offset, count: 30)
        guard local.count == 30, local.put32(0) == 0x04034b50 else { throw LibraryShare.ShareError.damaged }
        let body = try read(at: e.offset + 30 + local.put16(26) + local.put16(28), count: e.compressed)
        let data: Data
        switch e.method {
        case 0: data = body
        case 8:
            guard let inflated = LibraryZip.inflate(body, size: e.size) else { throw LibraryShare.ShareError.damaged }
            data = inflated
        default: throw LibraryShare.ShareError.damaged
        }
        guard data.count == e.size, LibraryZip.crc32(data) == e.crc else { throw LibraryShare.ShareError.damaged }
        return data
    }

    private func read(at offset: Int, count: Int) throws -> Data {
        try handle.seek(toOffset: UInt64(max(0, offset)))
        let data = try handle.read(upToCount: count) ?? Data()
        guard data.count == count else { throw LibraryShare.ShareError.damaged }
        return data
    }
}

private extension Data {
    mutating func put16(_ value: UInt16) { append(UInt8(value & 0xff)); append(UInt8(value >> 8)) }
    mutating func put32(_ value: UInt32) { for shift in [0, 8, 16, 24] { append(UInt8((value >> UInt32(shift)) & 0xff)) } }
    func u16(_ at: Int) -> Int { Int(self[startIndex + at]) | Int(self[startIndex + at + 1]) << 8 }
    func u32(_ at: Int) -> UInt32 {
        var value: UInt32 = 0
        for i in 0..<4 { value |= UInt32(self[startIndex + at + i]) << UInt32(8 * i) }
        return value
    }
}
