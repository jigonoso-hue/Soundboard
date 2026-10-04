import SwiftUI

struct SoundSource: Codable, Equatable {
    var title: String
    var url: String
    var start: Double
    var end: Double
    /// True when the whole video's audio was saved rather than a clip.
    var full: Bool? = nil
}

struct Sound: Identifiable, Codable, Equatable {
    var id: UUID
    var name: String
    var fileName: String
    var colorIndex: Int
    var volume: Double
    var createdAt: Date
    var source: SoundSource?
    /// nil = play once; otherwise replay this many seconds after it ends (0 = immediately).
    var repeatGap: Double? = nil
    /// Tags such as "horror" or "tavern" (nil in libraries made before tags).
    var tags: [String]? = nil
    /// Clip (a short effect, shown as a tile) or full sound (a song or long track, shown as a row).
    var kind: SoundKind? = nil
    /// Length in seconds, measured when the sound is added.
    var duration: Double? = nil
    /// Live Session: never sent to listeners (nil in libraries made before Live Sessions).
    var gmOnly: Bool? = nil
    /// Live Session: listeners' phones vibrate when it starts.
    var buzz: Bool? = nil

    var tagList: [String] { tags ?? [] }

    /// Sounds at least a minute long count as full sounds unless the user says otherwise.
    var isFull: Bool {
        (kind ?? ((duration ?? 0) >= SoundKind.fullSoundSeconds ? .full : .clip)) == .full
    }
}

enum SoundKind: String, Codable, CaseIterable {
    case clip, full

    static let fullSoundSeconds = 60.0

    var label: String { self == .clip ? "Clip" : "Full sound" }
    var icon: String { self == .clip ? "scissors" : "note" }
}

/// Tag names and colours, shared by the filters, chips and pickers.
enum TagStyle {
    static let premade = ["surprise", "comedy", "horror", "shock", "suspense", "combat", "magic", "creature",
                          "weather", "nature", "tavern", "music", "victory", "sad", "mystery"]

    private static let presetColors: [String: UInt32] = [
        "surprise": 0xFFB347, "comedy": 0xFFE156, "horror": 0xFF5D73, "shock": 0xD58BFF, "suspense": 0x8B8CFF,
        "combat": 0xFF8A5C, "magic": 0x5EC8FF, "creature": 0x6EE7B7, "weather": 0x7DD3FC, "nature": 0x86EFAC,
        "tavern": 0xF5A742, "music": 0xF472B6, "victory": 0xFACC15, "sad": 0x94A3B8, "mystery": 0xA78BFA,
    ]

    static func color(_ tag: String) -> Color {
        if let hex = presetColors[tag] { return Color(hex: hex) }
        var hash: UInt32 = 0
        for scalar in tag.unicodeScalars { hash = hash &* 31 &+ scalar.value }
        return Color(hue: Double(hash % 360) / 360, saturation: 0.55, brightness: 0.95)
    }

    /// Lowercase letters, numbers, spaces, & ' and -, at most 24 characters (same rule as the Mac app).
    static func clean(_ name: String) -> String {
        let allowed = name.lowercased().unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0) || " &'-".unicodeScalars.contains($0)
        }
        let collapsed = String(String.UnicodeScalarView(allowed))
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        return String(collapsed.prefix(24))
    }
}

enum Palette {
    static let colors: [Color] = [
        Color(hex: 0xFF5D73), Color(hex: 0xFFB347), Color(hex: 0xFFE156), Color(hex: 0x6EE7B7),
        Color(hex: 0x5EC8FF), Color(hex: 0x8B8CFF), Color(hex: 0xD58BFF), Color(hex: 0xFF8FD1),
    ]

    static func color(_ index: Int) -> Color {
        colors[((index % colors.count) + colors.count) % colors.count]
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    /// "#rrggbb" → colour; nil if it isn't one.
    init?(hexString: String) {
        let digits = hexString.hasPrefix("#") ? String(hexString.dropFirst()) : hexString
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(hex: value)
    }

    /// "#rrggbb" for storing a colour the user picked.
    var hexString: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        let clamp = { (v: CGFloat) in Int((min(1, max(0, v)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", clamp(r), clamp(g), clamp(b))
    }
}

/// Hex colour strings as stored in bashes and kits.
enum HexColor {
    static func isValid(_ value: String) -> Bool {
        value.count == 7 && value.hasPrefix("#") && UInt32(value.dropFirst(), radix: 16) != nil
    }

    static func clean(_ value: String?, fallback: String) -> String {
        guard let value, isValid(value) else { return fallback }
        return value.lowercased()
    }
}

enum SoundError: LocalizedError {
    case unsupported(String)
    case noAudio
    case exportFailed

    var errorDescription: String? {
        switch self {
        case .unsupported(let name): return "“\(name)” isn't an audio format this iPad can play."
        case .noAudio: return "That file doesn't contain any audio."
        case .exportFailed: return "Couldn't cut the audio out of that file."
        }
    }
}

enum TimeText {
    /// "1:23.4" / "83.4" / "1:02:03" → seconds.
    static func parse(_ text: String) -> Double? {
        let parts = text.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count) else { return nil }
        var total = 0.0
        for part in parts {
            guard let value = Double(part), value >= 0, value.isFinite else { return nil }
            total = total * 60 + value
        }
        return total
    }

    static func format(_ seconds: Double) -> String {
        let t = seconds.isFinite ? max(0, seconds) : 0
        let tenths = Int((t * 10).rounded())
        let h = tenths / 36000
        let m = (tenths / 600) % 60
        let s = Double(tenths % 600) / 10
        let sec = String(format: "%04.1f", s)
        return h > 0 ? String(format: "%d:%02d:", h, m) + sec : "\(m):\(sec)"
    }
}
