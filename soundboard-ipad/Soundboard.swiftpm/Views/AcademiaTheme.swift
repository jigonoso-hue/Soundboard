import SwiftUI

// The Dark Academia theme: deep indigo pages in gilded frames (inward-curved
// corners, a double gold line, thorned corner stars, filigree curls, crest
// ornaments, moon phases) on a dark starry night with blue glows, an arcane
// sigil in an astrolabe ring, a crescent moon, constellations, an hourglass and
// a key. Sounds are leather-bound book covers that glow with magic as they play.

enum Arcane {
    static let goldGradient = Gradient(stops: [
        .init(color: Color(hex: 0xF6DC8F), location: 0),
        .init(color: Color(hex: 0xB8862B), location: 0.45),
        .init(color: Color(hex: 0xF0CF75), location: 0.7),
        .init(color: Color(hex: 0x9C6F22), location: 1),
    ])

    static func gold(over r: CGRect) -> GraphicsContext.Shading {
        .linearGradient(goldGradient, startPoint: CGPoint(x: r.minX, y: r.minY), endPoint: CGPoint(x: r.maxX, y: r.maxY))
    }

    /// A rectangle whose corners curve inward.
    static func frame(_ r: CGRect, cut k: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: r.minX + k, y: r.minY))
        path.addLine(to: CGPoint(x: r.maxX - k, y: r.minY))
        path.addQuadCurve(to: CGPoint(x: r.maxX, y: r.minY + k), control: CGPoint(x: r.maxX - k, y: r.minY + k))
        path.addLine(to: CGPoint(x: r.maxX, y: r.maxY - k))
        path.addQuadCurve(to: CGPoint(x: r.maxX - k, y: r.maxY), control: CGPoint(x: r.maxX - k, y: r.maxY - k))
        path.addLine(to: CGPoint(x: r.minX + k, y: r.maxY))
        path.addQuadCurve(to: CGPoint(x: r.minX, y: r.maxY - k), control: CGPoint(x: r.minX + k, y: r.maxY - k))
        path.addLine(to: CGPoint(x: r.minX, y: r.minY + k))
        path.addQuadCurve(to: CGPoint(x: r.minX + k, y: r.minY), control: CGPoint(x: r.minX + k, y: r.minY + k))
        path.closeSubpath()
        return path
    }

    /// A four-pointed star with a smaller cross-star behind it.
    static func star(at p: CGPoint, size s: CGFloat) -> Path {
        func point(_ size: CGFloat, _ angle: CGFloat) -> Path {
            Atomic.sparkle(at: .zero, size: size)
                .applying(CGAffineTransform(rotationAngle: angle))
                .applying(CGAffineTransform(translationX: p.x, y: p.y))
        }
        var path = point(s, 0)
        path.addPath(point(s * 0.6, .pi / 2))
        return path
    }

    static func diamond(at p: CGPoint, size s: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: p.x, y: p.y - s))
        path.addLine(to: CGPoint(x: p.x + s * 0.7, y: p.y))
        path.addLine(to: CGPoint(x: p.x, y: p.y + s))
        path.addLine(to: CGPoint(x: p.x - s * 0.7, y: p.y))
        path.closeSubpath()
        return path
    }

    /// A thin spike from `p` in direction (dx, dy).
    static func thorn(at p: CGPoint, dx: CGFloat, dy: CGFloat, length: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: p.x - dy * 2.2, y: p.y + dx * 2.2))
        path.addLine(to: CGPoint(x: p.x + dx * length, y: p.y + dy * length))
        path.addLine(to: CGPoint(x: p.x + dy * 2.2, y: p.y - dx * 2.2))
        path.closeSubpath()
        return path
    }

    static func polygon(center c: CGPoint, radius r: CGFloat, sides n: Int, rotation: CGFloat) -> Path {
        var path = Path()
        for i in 0...n {
            let angle = rotation + CGFloat(i) / CGFloat(n) * .pi * 2
            let point = CGPoint(x: c.x + cos(angle) * r, y: c.y + sin(angle) * r)
            if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }

    /// An arcane sigil: rings, two squares, a hexagram and rays.
    static func sigil(center c: CGPoint, radius r: CGFloat) -> Path {
        func circle(_ radius: CGFloat) -> Path {
            Path(ellipseIn: CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2))
        }
        var path = circle(r)
        path.addPath(circle(r * 0.93))
        path.addPath(polygon(center: c, radius: r * 0.93, sides: 4, rotation: 0))
        path.addPath(polygon(center: c, radius: r * 0.93, sides: 4, rotation: .pi / 4))
        path.addPath(polygon(center: c, radius: r * 0.93, sides: 3, rotation: -.pi / 2))
        path.addPath(polygon(center: c, radius: r * 0.93, sides: 3, rotation: .pi / 2))
        path.addPath(circle(r * 0.46))
        path.addPath(circle(r * 0.3))
        for i in 0..<8 {
            let angle = CGFloat(i) / 8 * .pi * 2
            path.move(to: CGPoint(x: c.x + cos(angle) * r, y: c.y + sin(angle) * r))
            path.addLine(to: CGPoint(x: c.x + cos(angle) * r * 1.12, y: c.y + sin(angle) * r * 1.12))
        }
        return path
    }

    /// A crescent moon.
    static func crescent(at p: CGPoint, radius r: CGFloat) -> Path {
        let full = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
        let bite = Path(ellipseIn: CGRect(x: p.x - r * 0.4, y: p.y - r * 1.05, width: r * 1.7, height: r * 1.7))
        return full.subtracting(bite)
    }

    /// An astrolabe ring: two circles with degree ticks and twelve diamonds around it.
    static func astrolabe(center c: CGPoint, radius r: CGFloat) -> (lines: Path, marks: Path) {
        var lines = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        let outer = r * 1.08
        lines.addEllipse(in: CGRect(x: c.x - outer, y: c.y - outer, width: outer * 2, height: outer * 2))
        for i in 0..<72 {
            let angle = CGFloat(i) / 72 * .pi * 2
            let length = i % 6 == 0 ? r * 0.08 : r * 0.035
            lines.move(to: CGPoint(x: c.x + cos(angle) * outer, y: c.y + sin(angle) * outer))
            lines.addLine(to: CGPoint(x: c.x + cos(angle) * (outer - length), y: c.y + sin(angle) * (outer - length)))
        }
        var marks = Path()
        for i in 0..<12 {
            let angle = CGFloat(i) / 12 * .pi * 2 + 0.26
            marks.addPath(diamond(at: CGPoint(x: c.x + cos(angle) * r * 1.15, y: c.y + sin(angle) * r * 1.15), size: 4))
        }
        return (lines, marks)
    }

    /// Stars joined by a dotted line. Points are in units of `scale`.
    static func constellation(_ points: [(CGFloat, CGFloat)], origin o: CGPoint, scale: CGFloat) -> (line: Path, stars: Path) {
        var line = Path()
        var stars = Path()
        for (i, (x, y)) in points.enumerated() {
            let p = CGPoint(x: o.x + x * scale, y: o.y + y * scale)
            if i == 0 { line.move(to: p) } else { line.addLine(to: p) }
            stars.addEllipse(in: CGRect(x: p.x - 1.8, y: p.y - 1.8, width: 3.6, height: 3.6))
        }
        return (line, stars)
    }

    static func hourglass(at p: CGPoint, size s: CGFloat) -> Path {
        var path = Path(CGRect(x: p.x - s * 0.6, y: p.y - s, width: s * 1.2, height: s * 0.12))
        path.addRect(CGRect(x: p.x - s * 0.6, y: p.y + s * 0.88, width: s * 1.2, height: s * 0.12))
        path.move(to: CGPoint(x: p.x - s * 0.45, y: p.y - s * 0.88))
        path.addQuadCurve(to: p, control: CGPoint(x: p.x - s * 0.45, y: p.y - s * 0.2))
        path.addQuadCurve(to: CGPoint(x: p.x - s * 0.45, y: p.y + s * 0.88), control: CGPoint(x: p.x - s * 0.45, y: p.y + s * 0.2))
        path.addLine(to: CGPoint(x: p.x + s * 0.45, y: p.y + s * 0.88))
        path.addQuadCurve(to: p, control: CGPoint(x: p.x + s * 0.45, y: p.y + s * 0.2))
        path.addQuadCurve(to: CGPoint(x: p.x + s * 0.45, y: p.y - s * 0.88), control: CGPoint(x: p.x + s * 0.45, y: p.y - s * 0.2))
        path.closeSubpath()
        return path
    }

    static func key(at p: CGPoint, size s: CGFloat, angle: CGFloat) -> Path {
        var path = Path(ellipseIn: CGRect(x: -s, y: -s * 0.3, width: s * 0.6, height: s * 0.6))
        path.move(to: CGPoint(x: -s * 0.4, y: 0))
        path.addLine(to: CGPoint(x: s, y: 0))
        path.move(to: CGPoint(x: s * 0.7, y: 0))
        path.addLine(to: CGPoint(x: s * 0.7, y: s * 0.25))
        path.move(to: CGPoint(x: s * 0.9, y: 0))
        path.addLine(to: CGPoint(x: s * 0.9, y: s * 0.3))
        return path
            .applying(CGAffineTransform(rotationAngle: angle))
            .applying(CGAffineTransform(translationX: p.x, y: p.y))
    }

    /// A filigree curl: a short line ending in a small spiral.
    static func curl(from p: CGPoint, dx: CGFloat, dy: CGFloat, length l: CGFloat) -> Path {
        var path = Path()
        let end = CGPoint(x: p.x + dx * l, y: p.y + dy * l)
        // Perpendicular, pointing into the panel.
        let nx = -dy
        let ny = dx
        path.move(to: p)
        path.addQuadCurve(to: end, control: CGPoint(x: p.x + dx * l * 0.5 + nx * 4, y: p.y + dy * l * 0.5 + ny * 4))
        path.addQuadCurve(to: CGPoint(x: end.x + nx * 7 - dx * 3, y: end.y + ny * 7 - dy * 3),
                          control: CGPoint(x: end.x + dx * 6 + nx * 4, y: end.y + dy * 6 + ny * 4))
        path.addQuadCurve(to: CGPoint(x: end.x - dx * 2 + nx * 3, y: end.y - dy * 2 + ny * 3),
                          control: CGPoint(x: end.x - dx * 4 + nx * 7, y: end.y - dy * 4 + ny * 7))
        return path
    }

    /// Five moon phases in a row: new, waxing, full, waning, new.
    static func moonPhases(center c: CGPoint, radius r: CGFloat, spacing: CGFloat) -> (filled: Path, outline: Path) {
        var filled = Path()
        var outline = Path()
        for i in 0..<5 {
            let p = CGPoint(x: c.x + CGFloat(i - 2) * spacing, y: c.y)
            let disc = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            outline.addEllipse(in: disc)
            switch i {
            case 1: filled.addPath(Path(ellipseIn: disc).subtracting(Path(CGRect(x: p.x - r, y: p.y - r, width: r, height: r * 2))))
            case 2: filled.addEllipse(in: disc)
            case 3: filled.addPath(Path(ellipseIn: disc).subtracting(Path(CGRect(x: p.x, y: p.y - r, width: r, height: r * 2))))
            default: break
            }
        }
        return (filled, outline)
    }
}

struct GildedFrameShape: Shape {
    func path(in rect: CGRect) -> Path {
        Arcane.frame(rect, cut: 12)
    }
}

/// The night behind everything: blue glows, stars, gold sparkles and a faint sigil.
struct ArcaneBackdrop: View, Equatable {
    var body: some View {
        Canvas { context, size in
            ArcaneBackdrop.draw(&context, size: size)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func draw(_ context: inout GraphicsContext, size: CGSize) {
        let w = size.width
        let h = size.height
        let all = CGRect(origin: .zero, size: size)
        context.fill(Path(all), with: .linearGradient(
            Gradient(colors: [Color(hex: 0x05060F), Color(hex: 0x0B0F2A)]),
            startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))

        var glow = context
        glow.addFilter(.blur(radius: min(80, max(w, h) * 0.08)))
        let scale = max(w, h) / 1100
        let glows: [(CGPoint, Double)] = [(CGPoint(x: 0, y: h * 0.55), 0.5), (CGPoint(x: w, y: h * 0.2), 0.35), (CGPoint(x: w * 0.55, y: 0), 0.2)]
        for (point, alpha) in glows {
            let rw = 180 * scale
            let rh = 260 * scale
            glow.fill(Path(ellipseIn: CGRect(x: point.x - rw, y: point.y - rh, width: rw * 2, height: rh * 2)),
                      with: .color(Color(hex: 0x1D54D6).opacity(alpha)))
        }

        var random = SeededRandom(9)
        for _ in 0..<Int(w * h / 2600) {
            let r = random.range(0.3, 1.1)
            let x = random.range(0, w)
            let y = random.range(0, h)
            context.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)),
                         with: .color(.white.opacity(random.range(0.2, 0.8))))
        }

        context.stroke(Arcane.sigil(center: CGPoint(x: w * 0.6, y: h * 0.5), radius: min(w, h) * 0.34),
                       with: .color(Color(hex: 0x8FA6FF).opacity(0.13)), lineWidth: 1.2)

        let gold = Arcane.gold(over: all)
        let short = min(w, h)
        let ring = Arcane.astrolabe(center: CGPoint(x: w * 0.6, y: h * 0.5), radius: short * 0.42)
        context.stroke(ring.lines, with: .color(Color(hex: 0xD4A94A).opacity(0.22)), lineWidth: 1)
        context.fill(ring.marks, with: .color(Color(hex: 0xD4A94A).opacity(0.35)))

        // A glowing crescent moon.
        let moon = Arcane.crescent(at: CGPoint(x: w * 0.9, y: h * 0.12), radius: max(12, short * 0.05))
        var moonGlow = context
        moonGlow.addFilter(.blur(radius: 14))
        moonGlow.fill(moon, with: .color(Color(hex: 0xF6DC8F).opacity(0.7)))
        context.fill(moon, with: gold)

        // Constellations.
        let constellations: [([(CGFloat, CGFloat)], CGPoint)] = [
            ([(0, 0), (1, 0.4), (2, 0.2), (2.8, 1), (3.6, 0.7)], CGPoint(x: w * 0.36, y: h * 0.07)),
            ([(0, 0), (0.6, 1), (1.5, 1.2), (2.1, 0.4), (0, 0)], CGPoint(x: w * 0.8, y: h * 0.8)),
        ]
        for (points, origin) in constellations {
            let stars = Arcane.constellation(points, origin: origin, scale: 28)
            context.stroke(stars.line, with: .color(Color(hex: 0xF6DC8F).opacity(0.35)), style: StrokeStyle(lineWidth: 0.8, dash: [3, 4]))
            context.fill(stars.stars, with: .color(Color(hex: 0xF6DC8F)))
        }

        // An hourglass and a key.
        var faint = context
        faint.opacity = 0.5
        faint.stroke(Arcane.hourglass(at: CGPoint(x: w * 0.95, y: h * 0.55), size: 16), with: gold, lineWidth: 1.4)
        faint.stroke(Arcane.key(at: CGPoint(x: w * 0.3, y: h * 0.93), size: 22, angle: -0.4), with: gold, lineWidth: 1.6)

        var sparkles = context
        sparkles.opacity = 0.8
        for _ in 0..<14 {
            let point = CGPoint(x: random.range(0, w), y: random.range(0, h))
            sparkles.fill(Arcane.star(at: point, size: random.range(4, 9)), with: Arcane.gold(over: all))
        }
    }
}

/// A Dark Academia page: deep indigo in a gilded frame with corner stars,
/// crest ornaments, a faint sigil and a few gold sparkles.
struct GildedPanel: View, Equatable {
    let seed: String

    /// Room around the panel for ornaments that stick out past its edge.
    private static let bleed: CGFloat = 16

    var body: some View {
        let number = stableSeed(seed)
        ZStack {
            GildedFrameShape()
                .fill(RadialGradient(
                    colors: [Color(hex: 0x242678).opacity(0.95), Color(hex: 0x0C0D30).opacity(0.95)],
                    center: UnitPoint(x: 0.5, y: 0.45), startRadius: 10, endRadius: 600))
            Canvas { context, size in
                let r = CGRect(origin: .zero, size: size).insetBy(dx: GildedPanel.bleed, dy: GildedPanel.bleed)
                GildedPanel.decorate(&context, rect: r, seed: number)
            }
            .padding(-GildedPanel.bleed)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func decorate(_ context: inout GraphicsContext, rect r: CGRect, seed: UInt64) {
        guard r.width > 30, r.height > 30 else { return }
        var random = SeededRandom(seed)
        let k: CGFloat = 12
        let w = r.width
        let h = r.height

        // A faint sigil low in tall panels.
        if h > 140 {
            var faint = context
            faint.clip(to: Arcane.frame(r, cut: k))
            let radius = min(w, h) * 0.28
            faint.stroke(Arcane.sigil(center: CGPoint(x: r.midX, y: r.maxY - min(w, h) * 0.32), radius: radius),
                         with: .color(Color(hex: 0xC9B6FF).opacity(0.08)), lineWidth: 1)
        }

        let gold = Arcane.gold(over: r)
        context.stroke(Arcane.frame(r, cut: k), with: gold, lineWidth: 1.8)
        var inner = context
        inner.opacity = 0.7
        inner.stroke(Arcane.frame(r.insetBy(dx: 6, dy: 6), cut: k - 2), with: gold, lineWidth: 0.8)

        // Thorned stars at the corners.
        let corners: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (r.minX, r.minY, 1, 1), (r.maxX, r.minY, -1, 1), (r.minX, r.maxY, 1, -1), (r.maxX, r.maxY, -1, -1),
        ]
        for (cx, cy, sx, sy) in corners {
            let star = CGPoint(x: cx + sx * k * 0.72, y: cy + sy * k * 0.72)
            context.fill(Arcane.star(at: star, size: 9), with: gold)
            context.fill(Arcane.thorn(at: star, dx: -sx * 0.7071, dy: -sy * 0.7071, length: 15), with: gold)
            // Filigree curls along both edges from each corner.
            if w > 120 && h > 80 {
                var curls = Arcane.curl(from: CGPoint(x: cx + sx * (k + 4), y: cy + sy * 3), dx: sx, dy: 0, length: 22)
                curls.addPath(Arcane.curl(from: CGPoint(x: cx + sx * 3, y: cy + sy * (k + 4)), dx: 0, dy: sy, length: 22))
                context.stroke(curls, with: gold, lineWidth: 1)
            }
        }

        // Moon phases under the top ornament of wide panels.
        if w > 260 && h > 120 {
            let phases = Arcane.moonPhases(center: CGPoint(x: r.midX, y: r.minY + 18), radius: 3.2, spacing: 12)
            var faint = context
            faint.opacity = 0.75
            faint.fill(phases.filled, with: gold)
            faint.stroke(phases.outline, with: gold, lineWidth: 0.7)
        }

        // Crest ornaments at the top and bottom.
        if w > 140 {
            let top = CGPoint(x: r.midX, y: r.minY)
            context.fill(Arcane.diamond(at: top, size: 6), with: gold)
            context.fill(Arcane.thorn(at: top, dx: 0, dy: -1, length: 12), with: gold)
            var swirls = Path()
            swirls.move(to: CGPoint(x: top.x - 38, y: top.y + 1))
            swirls.addQuadCurve(to: CGPoint(x: top.x - 7, y: top.y), control: CGPoint(x: top.x - 16, y: top.y - 9))
            swirls.move(to: CGPoint(x: top.x + 38, y: top.y + 1))
            swirls.addQuadCurve(to: CGPoint(x: top.x + 7, y: top.y), control: CGPoint(x: top.x + 16, y: top.y - 9))
            let bottom = CGPoint(x: r.midX, y: r.maxY)
            context.fill(Arcane.diamond(at: bottom, size: 5), with: gold)
            swirls.move(to: CGPoint(x: bottom.x - 26, y: bottom.y - 1))
            swirls.addQuadCurve(to: CGPoint(x: bottom.x - 6, y: bottom.y), control: CGPoint(x: bottom.x - 12, y: bottom.y + 8))
            swirls.move(to: CGPoint(x: bottom.x + 26, y: bottom.y - 1))
            swirls.addQuadCurve(to: CGPoint(x: bottom.x + 6, y: bottom.y), control: CGPoint(x: bottom.x + 12, y: bottom.y + 8))
            context.stroke(swirls, with: gold, lineWidth: 1.4)
        }
        // Diamonds halfway down the sides of tall panels.
        if h > 200 {
            context.fill(Arcane.diamond(at: CGPoint(x: r.minX, y: r.midY), size: 5), with: gold)
            context.fill(Arcane.diamond(at: CGPoint(x: r.maxX, y: r.midY), size: 5), with: gold)
        }

        // A few small sparkles near the top and bottom edges.
        var sparkles = context
        sparkles.opacity = 0.7
        let count = max(2, Int((w + h) / 240))
        for _ in 0..<count {
            let x = random.range(r.minX + 20, max(r.minX + 21, r.maxX - 20))
            let nearTop = random.next() < 0.5
            let y = nearTop ? r.minY + random.range(14, 26) : r.maxY - random.range(14, 26)
            sparkles.fill(Arcane.star(at: CGPoint(x: x, y: y), size: random.range(3, 6)), with: gold)
        }
    }
}

/// A leather-bound book cover for a sound: the sound's colour as leather, a
/// spine with gold bands, page edges, a double gold border with corner
/// diamonds and (on large tiles) an emblem.
struct BookCover: View, Equatable {
    let seed: String
    let color: Color
    var emblem = false

    var body: some View {
        Canvas { context, size in
            BookCover.draw(&context, size: size, seed: stableSeed(seed), color: color, emblem: emblem)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func draw(_ context: inout GraphicsContext, size: CGSize, seed: UInt64, color: Color, emblem: Bool) {
        let w = size.width
        let h = size.height
        let all = CGRect(origin: .zero, size: size)
        context.fill(Path(all), with: .color(Color(hex: 0x1A1028)))
        context.fill(Path(all), with: .color(color.opacity(0.55)))
        context.fill(Path(all), with: .linearGradient(
            Gradient(colors: [.white.opacity(0.1), .black.opacity(0.45)]),
            startPoint: .zero, endPoint: CGPoint(x: w, y: h)))

        // Leather grain.
        var random = SeededRandom(seed)
        for _ in 0..<Int(w * h / 30) {
            let light = random.next() < 0.5
            context.fill(Path(CGRect(x: random.range(0, w), y: random.range(0, h), width: 1.2, height: 1.2)),
                         with: .color(light ? .white.opacity(0.05) : .black.opacity(0.12)))
        }

        let gold = Arcane.gold(over: all)
        // Spine with gold bands.
        context.fill(Path(CGRect(x: 0, y: 0, width: 10, height: h)), with: .color(.black.opacity(0.35)))
        for f in [0.12, 0.16, 0.84, 0.88] {
            context.fill(Path(CGRect(x: 0, y: h * CGFloat(f), width: 10, height: 1.5)), with: gold)
        }
        context.fill(Path(CGRect(x: 10, y: 0, width: 1, height: h)), with: .color(.white.opacity(0.12)))
        // Page edges on the right.
        context.fill(Path(CGRect(x: w - 3, y: 3, width: 3, height: h - 6)), with: .color(Color(hex: 0xE8DCC0)))

        // Double gold border with corner diamonds.
        let border = CGRect(x: 16, y: 6, width: w - 25, height: h - 12)
        guard border.width > 10, border.height > 10 else { return }
        context.stroke(Path(border), with: gold, lineWidth: 1.2)
        context.stroke(Path(border.insetBy(dx: 3, dy: 3)), with: gold, lineWidth: 0.6)
        for corner in [CGPoint(x: border.minX, y: border.minY), CGPoint(x: border.maxX, y: border.minY),
                       CGPoint(x: border.minX, y: border.maxY), CGPoint(x: border.maxX, y: border.maxY)] {
            context.fill(Arcane.diamond(at: corner, size: 3.5), with: gold)
        }

        if emblem {
            let center = CGPoint(x: border.midX, y: h * 0.72)
            var mark = context
            mark.opacity = 0.85
            var lines = Path(ellipseIn: CGRect(x: center.x - 11, y: center.y - 11, width: 22, height: 22))
            lines.addPath(Arcane.polygon(center: center, radius: 11, sides: 3, rotation: -.pi / 2))
            lines.addPath(Arcane.polygon(center: center, radius: 11, sides: 3, rotation: .pi / 2))
            mark.stroke(lines, with: gold, lineWidth: 0.9)
            mark.fill(Arcane.star(at: center, size: 4), with: gold)
        }
    }
}

/// Magic over a playing book: a pulsing golden glow along the border and
/// sparkles drifting up through the cover.
struct MagicGlow: View {
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            Canvas { context, size in
                let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                MagicGlow.draw(&context, size: size, time: time, color: color)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func draw(_ context: inout GraphicsContext, size: CGSize, time: Double, color: Color) {
        let w = size.width
        let h = size.height
        guard w > 30, h > 20 else { return }
        let pulse = 0.65 + 0.35 * sin(time * 3)

        // Glowing border.
        let border = Path(CGRect(x: 16, y: 6, width: w - 25, height: h - 12))
        var glow = context
        glow.addFilter(.blur(radius: 5))
        glow.stroke(border, with: .color(Color(hex: 0xFFD27A).opacity(pulse)), lineWidth: 5)
        glow.stroke(border, with: .color(color.opacity(pulse * 0.6)), lineWidth: 9)

        // Sparkles rising and fading.
        var random = SeededRandom(7)
        for i in 0..<14 {
            let speed = random.range(0.15, 0.35)
            let offset = random.next()
            let x0 = random.range(16, w - 6)
            let sparkleSize = random.range(2, 4.5)
            let warm = random.next() < 0.5
            let travel = (CGFloat(time) * speed + offset).truncatingRemainder(dividingBy: 1)
            let y = h - 4 - travel * (h - 8)
            let x = x0 + sin(CGFloat(time) * 2 + CGFloat(i)) * 4
            var mote = context
            mote.opacity = Double(sin(travel * .pi))
            mote.fill(Arcane.star(at: CGPoint(x: x, y: y), size: sparkleSize),
                      with: .color(warm ? Color(hex: 0xFFE7A3) : color))
        }
    }
}
