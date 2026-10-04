import SwiftUI

// The Dark Academia theme: deep indigo pages in gilded frames (inward-curved
// corners, a double gold line, thorned corner stars, crest ornaments) on a dark
// starry night with blue glows and a faint arcane sigil.

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

        var sparkles = context
        sparkles.opacity = 0.8
        for _ in 0..<10 {
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
