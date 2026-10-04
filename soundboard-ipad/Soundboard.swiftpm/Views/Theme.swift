import SwiftUI

/// The app's look: light/dark, background, accent colour and lettering.
enum AppTheme: String, CaseIterable, Identifiable {
    case system, dark, light, parchment, tavern

    var id: String { rawValue }

    var name: String {
        switch self {
        case .system: return "System"
        case .dark: return "Dark"
        case .light: return "Light"
        case .parchment: return "Parchment"
        case .tavern: return "Tavern"
        }
    }

    var blurb: String {
        switch self {
        case .system: return "Follows your device"
        case .dark: return "Dark and quiet"
        case .light: return "Bright and clean"
        case .parchment: return "Aged paper and ink"
        case .tavern: return "Wood, firelight and ale"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .dark, .tavern: return .dark
        case .light, .parchment: return .light
        }
    }

    /// The theme's own accent, used unless you pick another.
    var defaultAccent: String {
        switch self {
        case .system, .dark, .light: return "#b04cff"
        case .parchment: return "#8b2e16"
        case .tavern: return "#e0a040"
        }
    }

    /// Bardcore themes use a book-like serif face.
    var fontDesign: Font.Design { self == .parchment || self == .tavern ? .serif : .default }

    /// Whether the theme paints its own background behind lists and boards.
    var hasBackground: Bool { self == .parchment || self == .tavern }
}

/// Appearance options, saved between launches.
@MainActor
final class ThemeSettings: ObservableObject {
    @Published var theme: AppTheme {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: "theme") }
    }
    /// A custom accent ("#rrggbb"), or nil for the theme's own.
    @Published var accentHex: String? {
        didSet { UserDefaults.standard.set(accentHex, forKey: "accent") }
    }

    static let accentPresets: [(String, String)] = [
        ("Amethyst", "#b04cff"), ("Crimson", "#d7263d"), ("Ember", "#ff7a1a"), ("Gold", "#e0a040"),
        ("Moss", "#4caf50"), ("Sea", "#1fa2d6"), ("Rose", "#ff5d9e"), ("Ink", "#8b2e16"),
    ]

    init() {
        let defaults = UserDefaults.standard
        theme = AppTheme(rawValue: defaults.string(forKey: "theme") ?? "") ?? .dark
        accentHex = defaults.string(forKey: "accent")
    }

    var accent: Color {
        Color(hexString: accentHex ?? theme.defaultAccent) ?? .purple
    }
}

/// The painted background of the Parchment and Tavern themes.
struct ThemeBackground: View {
    let theme: AppTheme

    var body: some View {
        switch theme {
        case .parchment:
            ZStack {
                LinearGradient(
                    colors: [Color(hex: 0xF4E6C3), Color(hex: 0xEAD6A6), Color(hex: 0xE0C690)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                // Faint fibres in the paper.
                Canvas { context, size in
                    var seed: UInt64 = 7
                    func random() -> CGFloat {
                        seed = seed &* 6364136223846793005 &+ 1442695040888963407
                        return CGFloat(seed >> 33) / CGFloat(UInt32.max >> 1)
                    }
                    for _ in 0..<160 {
                        let x = random() * size.width
                        let y = random() * size.height
                        var line = Path()
                        line.move(to: CGPoint(x: x, y: y))
                        line.addLine(to: CGPoint(x: x + 20 + random() * 60, y: y + (random() - 0.5) * 6))
                        context.stroke(line, with: .color(Color(hex: 0x8B6B3A).opacity(0.06)), lineWidth: 1)
                    }
                }
                // Darker, burnt-looking edges.
                RadialGradient(
                    colors: [.clear, Color(hex: 0x7A5520).opacity(0.28)],
                    center: .center,
                    startRadius: 250,
                    endRadius: 900
                )
            }
        case .tavern:
            ZStack {
                LinearGradient(
                    colors: [Color(hex: 0x2E1B10), Color(hex: 0x24150C), Color(hex: 0x1A0F08)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                // Wooden planks: seams and a little grain.
                Canvas { context, size in
                    let plank: CGFloat = 64
                    var y: CGFloat = plank
                    var row = 0
                    while y < size.height {
                        var seam = Path()
                        seam.move(to: CGPoint(x: 0, y: y))
                        seam.addLine(to: CGPoint(x: size.width, y: y))
                        context.stroke(seam, with: .color(.black.opacity(0.45)), lineWidth: 2)
                        // Board ends, staggered row to row.
                        var x: CGFloat = row.isMultiple(of: 2) ? 180 : 60
                        while x < size.width {
                            var end = Path()
                            end.move(to: CGPoint(x: x, y: y - plank))
                            end.addLine(to: CGPoint(x: x, y: y))
                            context.stroke(end, with: .color(.black.opacity(0.3)), lineWidth: 1.5)
                            x += 260
                        }
                        for k in 1...3 {
                            var grain = Path()
                            let gy = y - plank + CGFloat(k) * plank / 4
                            grain.move(to: CGPoint(x: 0, y: gy))
                            grain.addCurve(
                                to: CGPoint(x: size.width, y: gy + 3),
                                control1: CGPoint(x: size.width * 0.3, y: gy - 4),
                                control2: CGPoint(x: size.width * 0.7, y: gy + 6)
                            )
                            context.stroke(grain, with: .color(Color(hex: 0x6B4426).opacity(0.18)), lineWidth: 1)
                        }
                        y += plank
                        row += 1
                    }
                }
                // Warm glow, as if from a hearth.
                RadialGradient(
                    colors: [Color(hex: 0xE0A040).opacity(0.10), .clear],
                    center: .bottomLeading,
                    startRadius: 50,
                    endRadius: 700
                )
            }
        default:
            Color.clear
        }
    }
}

extension View {
    /// Paints the theme's background behind a scroll view, list or form.
    @ViewBuilder
    func themedBackground(_ theme: AppTheme) -> some View {
        if theme.hasBackground {
            self
                .scrollContentBackground(.hidden)
                .background(ThemeBackground(theme: theme).ignoresSafeArea())
        } else {
            self
        }
    }
}
