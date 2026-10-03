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
