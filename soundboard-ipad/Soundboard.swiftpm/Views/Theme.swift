import SwiftUI

/// The app's look: light/dark, background, accent colour and lettering.
enum AppTheme: String, CaseIterable, Identifiable {
    case system, dark, light, tavern, spaceAge, scifi, academia

    var id: String { rawValue }

    var name: String {
        switch self {
        case .system: return "System"
        case .dark: return "Dark"
        case .light: return "Light"
        case .tavern: return "Tavern"
        case .spaceAge: return "Space Age"
        case .scifi: return "Sci-Fi"
        case .academia: return "Dark Academia"
        }
    }

    var blurb: String {
        switch self {
        case .system: return "Follows your device"
        case .dark: return "Dark and quiet"
        case .light: return "Bright and clean"
        case .tavern: return "Old parchment on a tavern table"
        case .spaceAge: return "Deep space through a starship window"
        case .scifi: return "A glowing starship HUD"
        case .academia: return "Gilded frames and arcane sigils"
        }
    }

    /// Tavern pages are parchment, so text is dark ink; Space Age is dark.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .dark, .spaceAge, .scifi, .academia: return .dark
        case .light, .tavern: return .light
        }
    }

    /// The theme's own accent, used unless you pick another.
    var defaultAccent: String {
        switch self {
        case .tavern: return "#9c3d12"
        case .spaceAge: return "#2ad4c0"
        case .scifi: return "#3fd2ff"
        case .academia: return "#d4a94a"
        default: return "#b04cff"
        }
    }

    /// Tavern uses a book-like serif face, Space Age a rounded one.
    var fontDesign: Font.Design {
        switch self {
        case .tavern, .academia: return .serif
        case .spaceAge: return .rounded
        case .scifi: return .monospaced
        default: return .default
        }
    }

    var isTavern: Bool { self == .tavern }
    /// Themes that paint their own backdrop and put pages on panels.
    var hasBackdrop: Bool { self != .system && self != .dark && self != .light }

    /// Colour of the navigation bar in themes that paint their own backdrop.
    var barColor: Color? {
        switch self {
        case .tavern: return Color(hex: 0x3A2414)
        case .spaceAge: return Color(hex: 0x0B1226)
        case .scifi: return Color(hex: 0x041426)
        case .academia: return Color(hex: 0x0A0B24)
        default: return nil
        }
    }

    /// Text colour in themes that paint their own backdrop (nil: the system's).
    var ink: Color? {
        switch self {
        case .tavern: return Color(hex: 0x2B1A0C)
        case .spaceAge: return Color(hex: 0xF6EFDD)
        case .scifi: return Color(hex: 0xDDF6FF)
        case .academia: return Color(hex: 0xF1E6C8)
        default: return nil
        }
    }

    /// Quieter text: captions, timers, icons.
    var secondaryInk: Color {
        switch self {
        case .tavern: return Color(hex: 0x5B4127)
        case .spaceAge: return Color(hex: 0xA9B6D6)
        case .scifi: return Color(hex: 0x7FB6D4)
        case .academia: return Color(hex: 0xA9A3C9)
        default: return .secondary
        }
    }

    /// Fill behind a card (a full sound, bash or ambience layer); stronger while it plays.
    func cardFill(active: Bool = false) -> Color {
        switch self {
        case .tavern: return Color(hex: 0x7A5228).opacity(active ? 0.28 : 0.16)
        case .spaceAge: return Color(hex: 0x0C142C).opacity(active ? 0.95 : 0.82)
        case .scifi: return Color(hex: 0x08203A).opacity(active ? 0.95 : 0.8)
        case .academia: return Color(hex: 0x14164A).opacity(active ? 0.95 : 0.8)
        default: return Color.secondary.opacity(active ? 0.18 : 0.1)
        }
    }

    /// Outline of a card.
    var cardStroke: Color {
        switch self {
        case .tavern: return Color(hex: 0x5A3A18).opacity(0.55)
        case .spaceAge: return Color(hex: 0xF6EFDD).opacity(0.55)
        case .scifi: return Color(hex: 0x3FD2FF).opacity(0.55)
        case .academia: return Color(hex: 0xD4A94A).opacity(0.6)
        default: return Color.secondary.opacity(0.25)
        }
    }

    /// Colour of playing ambience: mint, or a deeper green that reads on parchment.
    var ambienceColor: Color {
        isTavern ? Color(hex: 0x2F7A4D) : Color(hex: 0x6EE7B7)
    }

    /// Icon colour on a playing ambience layer's badge.
    var onAmbience: Color {
        isTavern ? .white : Color(hex: 0x10261D)
    }

    /// Highlight of a playing bash: yellow, or old gold that reads on parchment.
    var bashColor: Color {
        isTavern ? Color(hex: 0xA86F00) : Color(hex: 0xFFE156)
    }

    /// Solid base under see-through tiles, so the backdrop doesn't show through.
    var tileBase: Color {
        switch self {
        case .spaceAge: return Color(hex: 0x0C142C).opacity(0.85)
        case .scifi: return Color(hex: 0x081E36).opacity(0.85)
        case .academia: return Color(hex: 0x0E1035).opacity(0.85)
        case .tavern: return Color(hex: 0xF3E6C8).opacity(0.6)
        default: return .clear
        }
    }
}

private struct AppThemeKey: EnvironmentKey {
    static let defaultValue: AppTheme = .dark
}

extension EnvironmentValues {
    /// The current theme, for views that only need its colours.
    var appTheme: AppTheme {
        get { self[AppThemeKey.self] }
        set { self[AppThemeKey.self] = newValue }
    }
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
        ("Moss", "#4caf50"), ("Sea", "#1fa2d6"), ("Rose", "#ff5d9e"), ("Rust", "#9c3d12"),
    ]

    init() {
        let defaults = UserDefaults.standard
        let saved = defaults.string(forKey: "theme") ?? ""
        // The old Parchment theme is now part of Tavern.
        theme = saved == "parchment" ? .tavern : (AppTheme(rawValue: saved) ?? .dark)
        accentHex = defaults.string(forKey: "accent")
    }

    var accent: Color {
        Color(hexString: accentHex ?? theme.defaultAccent) ?? .purple
    }
}

// MARK: - Seeded randomness (the same seed always draws the same wear)

struct SeededRandom {
    private var state: UInt64

    init(_ seed: UInt64) {
        state = seed &+ 0x9E37_79B9_7F4A_7C15
    }

    mutating func next() -> CGFloat {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return CGFloat(state >> 11) / 9_007_199_254_740_992
    }

    mutating func range(_ low: CGFloat, _ high: CGFloat) -> CGFloat {
        low + (high - low) * next()
    }
}

/// A stable number for a string (FNV-1a), so each sheet keeps its look.
func stableSeed(_ text: String) -> UInt64 {
    var hash: UInt64 = 14_695_981_039_346_656_037
    for byte in text.utf8 {
        hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211
    }
    return hash
}

// MARK: - Parchment

/// The outline of a worn sheet: uneven, torn edges with the odd nick.
struct TornEdge: Shape {
    let seed: UInt64

    func path(in rect: CGRect) -> Path {
        var random = SeededRandom(seed)
        var points: [CGPoint] = []
        let step: CGFloat = 11

        // Walks one edge from a to b; `inward` points into the sheet.
        func edge(from a: CGPoint, to b: CGPoint, inward: CGVector) {
            let length = max(1, hypot(b.x - a.x, b.y - a.y))
            let along = CGVector(dx: (b.x - a.x) / length, dy: (b.y - a.y) / length)
            let count = max(2, Int((length / step).rounded()))
            let phase = random.range(0, 6.28)
            let wave = random.range(1, 3.5)
            for i in 0..<count {
                let t = CGFloat(i) / CGFloat(count)
                let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
                // Gentle waviness plus small tears.
                let depth = random.range(0, 2.2) + wave * (1 + sin(t * length / 90 + phase)) / 2
                points.append(CGPoint(x: p.x + inward.dx * depth, y: p.y + inward.dy * depth))
                if random.next() < 0.045 {
                    // A nick: a small V cut into the edge.
                    let cut = random.range(4, 10)
                    points.append(CGPoint(x: p.x + along.dx * 3 + inward.dx * cut, y: p.y + along.dy * 3 + inward.dy * cut))
                    points.append(CGPoint(x: p.x + along.dx * 6 + inward.dx * depth, y: p.y + along.dy * 6 + inward.dy * depth))
                }
            }
        }

        edge(from: CGPoint(x: rect.minX, y: rect.minY), to: CGPoint(x: rect.maxX, y: rect.minY), inward: CGVector(dx: 0, dy: 1))
        edge(from: CGPoint(x: rect.maxX, y: rect.minY), to: CGPoint(x: rect.maxX, y: rect.maxY), inward: CGVector(dx: -1, dy: 0))
        edge(from: CGPoint(x: rect.maxX, y: rect.maxY), to: CGPoint(x: rect.minX, y: rect.maxY), inward: CGVector(dx: 0, dy: -1))
        edge(from: CGPoint(x: rect.minX, y: rect.maxY), to: CGPoint(x: rect.minX, y: rect.minY), inward: CGVector(dx: 1, dy: 0))

        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        for point in points.dropFirst() { path.addLine(to: point) }
        path.closeSubpath()
        return path
    }
}

/// A sheet of old parchment: creased, stained and darkened at the edges.
/// Equatable so it only redraws when its seed changes, not on every update.
struct Parchment: View, Equatable {
    let seed: String

    var body: some View {
        let number = stableSeed(seed)
        Canvas { context, size in
            Parchment.draw(&context, size: size, seed: number)
        }
        .shadow(color: .black.opacity(0.5), radius: 7, y: 3)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static let ink = Color(red: 0.42, green: 0.25, blue: 0.08)

    static func draw(_ context: inout GraphicsContext, size: CGSize, seed: UInt64) {
        let rect = CGRect(origin: .zero, size: size)
        let outline = TornEdge(seed: seed).path(in: rect)
        let w = size.width
        let h = size.height
        var random = SeededRandom(seed &* 7 &+ 3)

        // Base colour, aged towards the bottom right.
        context.fill(outline, with: .linearGradient(
            Gradient(colors: [Color(hex: 0xEFDCAF), Color(hex: 0xE6CF9C), Color(hex: 0xD9BD84)]),
            startPoint: .zero,
            endPoint: CGPoint(x: w, y: h)
        ))
        context.clip(to: outline)

        // Mottling: soft darker and lighter patches.
        var soft = context
        soft.addFilter(.blur(radius: 22))
        for _ in 0..<16 {
            let rx = random.range(30, 140)
            let ry = random.range(20, 110)
            let ellipse = CGRect(x: random.range(0, w) - rx, y: random.range(0, h) - ry, width: rx * 2, height: ry * 2)
            soft.fill(Path(ellipseIn: ellipse), with: .color(ink.opacity(random.range(0.05, 0.12))))
        }
        for _ in 0..<6 {
            let rx = random.range(30, 100)
            let ry = random.range(20, 80)
            let ellipse = CGRect(x: random.range(0, w) - rx, y: random.range(0, h) - ry, width: rx * 2, height: ry * 2)
            soft.fill(Path(ellipseIn: ellipse), with: .color(Color(red: 1, green: 0.97, blue: 0.88).opacity(0.25)))
        }

        // Stains: mug rings and spilled drops.
        var ringContext = context
        ringContext.addFilter(.blur(radius: 1))
        var washContext = context
        washContext.addFilter(.blur(radius: 6))
        let rings = Int(random.range(0, 2.6))
        for _ in 0..<rings where w > 120 && h > 120 {
            let center = CGPoint(x: random.range(40, w - 40), y: random.range(40, h - 40))
            let radius = random.range(20, 42)
            var ring = Path()
            ring.addArc(center: center, radius: radius, startAngle: .radians(Double(random.range(0, 1))),
                        endAngle: .radians(Double(random.range(4.5, 6.4))), clockwise: false)
            ringContext.stroke(ring, with: .color(ink.opacity(0.3)), lineWidth: random.range(2, 4))
            washContext.fill(Path(ellipseIn: CGRect(x: center.x - radius + 3, y: center.y - radius + 3,
                                                    width: (radius - 3) * 2, height: (radius - 3) * 2)),
                             with: .color(ink.opacity(0.06)))
        }
        var blotContext = context
        blotContext.addFilter(.blur(radius: 8))
        for _ in 0..<2 {
            let rx = random.range(16, 46)
            let ry = random.range(10, 32)
            let blot = CGRect(x: random.range(0, w) - rx, y: random.range(0, h) - ry, width: rx * 2, height: ry * 2)
            blotContext.fill(Path(ellipseIn: blot), with: .color(ink.opacity(0.15)))
        }

        // Crinkles: a dark crease with a light ridge beside it.
        let creases = max(3, Int(w * h / 14000))
        for _ in 0..<creases {
            var x = random.range(0, w)
            var y = random.range(0, h)
            var angle = random.range(0, 6.28)
            var crease = Path()
            var ridge = Path()
            crease.move(to: CGPoint(x: x, y: y))
            ridge.move(to: CGPoint(x: x + 1.2, y: y + 1.2))
            for _ in 0..<Int(random.range(2, 5)) {
                angle += random.range(-0.6, 0.6)
                let length = random.range(10, 40)
                x += cos(angle) * length
                y += sin(angle) * length
                crease.addLine(to: CGPoint(x: x, y: y))
                ridge.addLine(to: CGPoint(x: x + 1.2, y: y + 1.2))
            }
            context.stroke(crease, with: .color(ink.opacity(0.2)), lineWidth: 0.9)
            context.stroke(ridge, with: .color(Color(red: 1, green: 0.98, blue: 0.9).opacity(0.45)), lineWidth: 0.9)
        }

        // Speckles of age.
        let specks = Int(w * h / 900)
        for _ in 0..<specks {
            let r = random.range(0.3, 1.1)
            let dot = CGRect(x: random.range(0, w) - r, y: random.range(0, h) - r, width: r * 2, height: r * 2)
            context.fill(Path(ellipseIn: dot), with: .color(ink.opacity(random.range(0.05, 0.25))))
        }

        // Worn, darkened edges.
        var burn = context
        burn.addFilter(.blur(radius: 10))
        burn.stroke(outline, with: .color(Color(red: 0.37, green: 0.2, blue: 0.06).opacity(0.55)), lineWidth: 26)
        var rim = context
        rim.addFilter(.blur(radius: 2))
        rim.stroke(outline, with: .color(Color(red: 0.27, green: 0.14, blue: 0.04).opacity(0.5)), lineWidth: 4)
    }
}

// MARK: - Tavern table

/// Wooden planks: varied shades, grain, knots and seams.
struct WoodTable: View, Equatable {
    var body: some View {
        Canvas { context, size in
            WoodTable.draw(&context, size: size)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static let shades: [UInt32] = [0x5B3A22, 0x4F321D, 0x64412A, 0x573722, 0x4A2E1A]

    static func draw(_ context: inout GraphicsContext, size: CGSize) {
        var random = SeededRandom(42)
        let plank: CGFloat = 74
        let w = size.width
        var y: CGFloat = 0
        var row = 0
        while y < size.height {
            let board = CGRect(x: 0, y: y, width: w, height: plank)
            context.fill(Path(board), with: .color(Color(hex: shades[Int(random.next() * CGFloat(shades.count)) % shades.count])))

            // Grain.
            for k in 0..<16 {
                let gy = y + random.range(4, plank - 4)
                let amplitude = random.range(1, 5)
                let wavelength = random.range(60, 160)
                var grain = Path()
                grain.move(to: CGPoint(x: 0, y: gy))
                var x: CGFloat = 40
                while x <= w + 40 {
                    grain.addLine(to: CGPoint(x: x, y: gy + sin(x / wavelength + CGFloat(k)) * amplitude))
                    x += 40
                }
                let dark = random.next() < 0.5
                context.stroke(grain, with: .color(dark ? Color(red: 0.12, green: 0.06, blue: 0.02).opacity(0.28)
                                                        : Color(red: 0.55, green: 0.37, blue: 0.22).opacity(0.18)),
                               lineWidth: random.range(0.5, 1.6))
            }

            // A knot now and then.
            if random.next() < 0.6 {
                let center = CGPoint(x: random.range(40, max(41, w - 40)), y: y + plank / 2)
                for ring in 1...4 {
                    let r = CGFloat(ring)
                    let knot = CGRect(x: center.x - r * 5, y: center.y - r * 2.4, width: r * 10, height: r * 4.8)
                    context.stroke(Path(ellipseIn: knot), with: .color(Color(red: 0.1, green: 0.05, blue: 0.02).opacity(0.45 - Double(ring) * 0.08)), lineWidth: 1.2)
                }
            }

            // Board ends, staggered row to row.
            var x = row.isMultiple(of: 2) ? random.range(250, 400) : random.range(80, 200)
            while x < w {
                context.fill(Path(CGRect(x: x, y: y, width: 2, height: plank)), with: .color(.black.opacity(0.5)))
                x += random.range(300, 480)
            }

            // Seam and a faint highlight.
            context.fill(Path(CGRect(x: 0, y: y + plank - 2, width: w, height: 2)), with: .color(.black.opacity(0.6)))
            context.fill(Path(CGRect(x: 0, y: y, width: w, height: 1)), with: .color(Color(red: 1, green: 0.86, blue: 0.67).opacity(0.07)))
            y += plank
            row += 1
        }
    }
}

/// The table with a parchment sheet on it, or just the table.
struct TavernBackdrop: View {
    /// Seed for the page's look; nil for the bare table.
    let page: String?

    var body: some View {
        ZStack {
            WoodTable().equatable()
            if let page {
                Parchment(seed: page).equatable().padding(8)
            }
        }
    }
}

/// A themed "sheet" behind a card or strip: parchment in Tavern, an atomic panel
/// in Space Age, a HUD panel in Sci-Fi, a gilded frame in Dark Academia, otherwise `fallback`.
struct ThemePanel<Fallback: View>: View {
    let theme: AppTheme
    let seed: String
    @ViewBuilder var fallback: () -> Fallback

    var body: some View {
        switch theme {
        case .tavern: Parchment(seed: seed).equatable()
        case .spaceAge: AtomicPanel(seed: seed).equatable()
        case .scifi: HUDPanel(seed: seed).equatable()
        case .academia: GildedPanel(seed: seed).equatable()
        default: fallback()
        }
    }
}

extension View {
    /// In the Tavern theme: the table with this screen on its own parchment page, or the
    /// bare table when `page` is nil. In Space Age: the window onto space. In Sci-Fi: the HUD. In Dark Academia: the starry night.
    @ViewBuilder
    func themedBackground(_ theme: AppTheme, page: String? = "page") -> some View {
        // Fill the screen even when the content is empty, or the backdrop shrinks with it.
        let filled = frame(maxWidth: .infinity, maxHeight: .infinity)
        switch theme {
        case .tavern:
            filled
                .scrollContentBackground(.hidden)
                .background(TavernBackdrop(page: page).ignoresSafeArea())
        case .spaceAge:
            filled
                .scrollContentBackground(.hidden)
                .background(SpaceScene(seed: page ?? "board").equatable().ignoresSafeArea())
        case .scifi:
            filled
                .scrollContentBackground(.hidden)
                .background(HUDBackdrop().equatable().ignoresSafeArea())
        case .academia:
            filled
                .scrollContentBackground(.hidden)
                .background(ArcaneBackdrop().equatable().ignoresSafeArea())
        default:
            self
        }
    }

    /// In themes with a backdrop: a solid bar with light text for the navigation bar.
    @ViewBuilder
    func themedNavigationBar(_ theme: AppTheme) -> some View {
        if let bar = theme.barColor {
            self
                .toolbarBackground(bar, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbarColorScheme(.dark, for: .navigationBar)
        } else {
            self
        }
    }

    /// In themes that paint their own backdrop: text in the theme's ink.
    @ViewBuilder
    func themedInk(_ theme: AppTheme) -> some View {
        if let ink = theme.ink {
            self.foregroundStyle(ink, theme.secondaryInk)
        } else {
            self
        }
    }
}
