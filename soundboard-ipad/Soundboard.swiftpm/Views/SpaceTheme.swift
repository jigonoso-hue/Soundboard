import SwiftUI

// The Space Age theme: 50s atomic / mid-century modern pages (cream panels with a
// charcoal outline, an offset colour shadow, sparkles, boomerangs, atoms and
// starbursts) on the riveted hull plating of a starship.

enum Atomic {
    static let teal = Color(hex: 0x12B5A5)
    static let orange = Color(hex: 0xF0643C)
    static let lime = Color(hex: 0xC3D23A)
    static let mustard = Color(hex: 0xF5A623)
    static let pink = Color(hex: 0xF497A5)
    static let ink = Color(hex: 0x232323)
    static let palette = [teal, orange, lime, mustard, pink]

    /// A four-pointed sparkle star.
    static func sparkle(at p: CGPoint, size s: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: p.x, y: p.y - s))
        path.addQuadCurve(to: CGPoint(x: p.x + s * 0.45, y: p.y), control: p)
        path.addQuadCurve(to: CGPoint(x: p.x, y: p.y + s), control: p)
        path.addQuadCurve(to: CGPoint(x: p.x - s * 0.45, y: p.y), control: p)
        path.addQuadCurve(to: CGPoint(x: p.x, y: p.y - s), control: p)
        path.closeSubpath()
        return path
    }

    /// The classic mid-century boomerang.
    static func boomerang(at p: CGPoint, size s: CGFloat, angle: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: -s, y: s * 0.35))
        path.addQuadCurve(to: CGPoint(x: 0, y: -s * 0.35), control: CGPoint(x: -s * 0.5, y: -s * 0.5))
        path.addQuadCurve(to: CGPoint(x: s, y: s * 0.35), control: CGPoint(x: s * 0.5, y: -s * 0.5))
        path.addQuadCurve(to: CGPoint(x: 0, y: -s * 0.02), control: CGPoint(x: s * 0.45, y: -s * 0.1))
        path.addQuadCurve(to: CGPoint(x: -s, y: s * 0.35), control: CGPoint(x: -s * 0.45, y: -s * 0.1))
        path.closeSubpath()
        return path
            .applying(CGAffineTransform(rotationAngle: angle))
            .applying(CGAffineTransform(translationX: p.x, y: p.y))
    }

    static func drawAtom(_ context: inout GraphicsContext, at p: CGPoint, size s: CGFloat) {
        for k in 0..<3 {
            let orbit = Path(ellipseIn: CGRect(x: -s, y: -s * 0.38, width: s * 2, height: s * 0.76))
                .applying(CGAffineTransform(rotationAngle: CGFloat(k) * .pi / 3))
                .applying(CGAffineTransform(translationX: p.x, y: p.y))
            context.stroke(orbit, with: .color(ink), lineWidth: 2)
        }
        let nucleus = Path(ellipseIn: CGRect(x: p.x - s * 0.2, y: p.y - s * 0.2, width: s * 0.4, height: s * 0.4))
        context.fill(nucleus, with: .color(mustard))
        context.stroke(nucleus, with: .color(ink), lineWidth: 2)
        for (color, angle) in [(teal, 0.0), (orange, 2.1), (lime, 4.2)] {
            let x = p.x + cos(CGFloat(angle)) * s
            let y = p.y + sin(CGFloat(angle)) * s * 0.38
            context.fill(Path(ellipseIn: CGRect(x: x - 4, y: y - 4, width: 8, height: 8)), with: .color(color))
        }
    }

    static func drawStarburst(_ context: inout GraphicsContext, at p: CGPoint, size s: CGFloat) {
        let colors = [teal, orange, lime]
        for k in 0..<12 {
            let angle = CGFloat(k) * .pi / 6
            let length = k.isMultiple(of: 2) ? s * 0.7 : s
            let end = CGPoint(x: p.x + cos(angle) * length, y: p.y + sin(angle) * length)
            var ray = Path()
            ray.move(to: p)
            ray.addLine(to: end)
            context.stroke(ray, with: .color(ink), lineWidth: 1.4)
            context.fill(Path(ellipseIn: CGRect(x: end.x - 3, y: end.y - 3, width: 6, height: 6)), with: .color(colors[k % 3]))
        }
        context.fill(Path(ellipseIn: CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8)), with: .color(ink))
    }
}

/// Riveted starship hull plating: panels of varied sizes, chamfered corners,
/// bevels, vent slots and rivets.
struct HullPlating: View, Equatable {
    var body: some View {
        Canvas { context, size in
            HullPlating.draw(&context, size: size)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static let shades: [UInt32] = [0x6B7A8C, 0x637284, 0x71808F, 0x5C6B7D, 0x687789]

    static func draw(_ context: inout GraphicsContext, size: CGSize) {
        var random = SeededRandom(2049)
        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: 0x2C3440)))

        // Split the hull into panels.
        var panels: [CGRect] = []
        func split(_ rect: CGRect, depth: Int) {
            let limit = random.range(90, 170)
            if (rect.width < limit && rect.height < limit) || depth > 7 {
                panels.append(rect)
                return
            }
            let f = random.range(0.3, 0.7)
            if rect.width >= rect.height {
                split(CGRect(x: rect.minX, y: rect.minY, width: rect.width * f, height: rect.height), depth: depth + 1)
                split(CGRect(x: rect.minX + rect.width * f, y: rect.minY, width: rect.width * (1 - f), height: rect.height), depth: depth + 1)
            } else {
                split(CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height * f), depth: depth + 1)
                split(CGRect(x: rect.minX, y: rect.minY + rect.height * f, width: rect.width, height: rect.height * (1 - f)), depth: depth + 1)
            }
        }
        split(CGRect(origin: .zero, size: size), depth: 0)

        for cell in panels {
            let r = cell.insetBy(dx: 1.5, dy: 1.5)
            guard r.width > 4, r.height > 4 else { continue }
            let corners = [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY),
                           CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
            // Some panels have one corner cut off.
            let cut: CGFloat = random.next() < 0.35 ? random.range(10, max(10.5, min(24, r.width / 3, r.height / 3))) : 0
            let cutCorner = Int(random.next() * 4) % 4
            var plate = Path()
            for (i, corner) in corners.enumerated() {
                if cut > 0 && i == cutCorner {
                    let previous = corners[(i + 3) % 4]
                    let next = corners[(i + 1) % 4]
                    func toward(_ other: CGPoint) -> CGPoint {
                        CGPoint(x: corner.x + (other.x > corner.x ? cut : (other.x < corner.x ? -cut : 0)),
                                y: corner.y + (other.y > corner.y ? cut : (other.y < corner.y ? -cut : 0)))
                    }
                    let a = toward(previous)
                    let b = toward(next)
                    if i == 0 { plate.move(to: a) } else { plate.addLine(to: a) }
                    plate.addLine(to: b)
                } else if i == 0 {
                    plate.move(to: corner)
                } else {
                    plate.addLine(to: corner)
                }
            }
            plate.closeSubpath()
            context.fill(plate, with: .color(Color(hex: shades[Int(random.next() * CGFloat(shades.count)) % shades.count])))

            var inside = context
            inside.clip(to: plate)
            // Bevel: light top-left, dark bottom-right.
            var light = Path()
            light.move(to: CGPoint(x: r.minX, y: r.maxY))
            light.addLine(to: CGPoint(x: r.minX, y: r.minY))
            light.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            inside.stroke(light, with: .color(.white.opacity(0.22)), lineWidth: 2)
            var dark = Path()
            dark.move(to: CGPoint(x: r.maxX, y: r.minY))
            dark.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
            dark.addLine(to: CGPoint(x: r.minX, y: r.maxY))
            inside.stroke(dark, with: .color(.black.opacity(0.35)), lineWidth: 2)

            // A recessed inner plate.
            if random.next() < 0.3 && r.width > 60 && r.height > 60 {
                inside.stroke(Path(r.insetBy(dx: 10, dy: 10)), with: .color(.black.opacity(0.25)), lineWidth: 1.5)
                inside.stroke(Path(r.insetBy(dx: 10, dy: 10).offsetBy(dx: 1, dy: 1)), with: .color(.white.opacity(0.12)), lineWidth: 1)
            }
            // Vent slots.
            if random.next() < 0.45 && r.width > 50 && r.height > 40 {
                let count = 2 + Int(random.next() * 2)
                let vertical = random.next() < 0.5
                let origin = CGPoint(x: r.minX + random.range(14, r.width - 40), y: r.minY + random.range(14, r.height - 30))
                for k in 0..<count {
                    let slot = vertical
                        ? CGRect(x: origin.x + CGFloat(k) * 7, y: origin.y, width: 3, height: 16)
                        : CGRect(x: origin.x, y: origin.y + CGFloat(k) * 6, width: 22, height: 3)
                    inside.fill(Path(roundedRect: slot, cornerRadius: 1.5), with: .color(Color(hex: 0x323B47)))
                }
            }
            // Rivets.
            if r.width >= 40 && r.height >= 40 {
                for rivet in [CGPoint(x: r.minX + 7, y: r.minY + 7), CGPoint(x: r.maxX - 7, y: r.minY + 7),
                              CGPoint(x: r.minX + 7, y: r.maxY - 7), CGPoint(x: r.maxX - 7, y: r.maxY - 7)] {
                    inside.fill(Path(ellipseIn: CGRect(x: rivet.x - 2.2, y: rivet.y - 2.2, width: 4.4, height: 4.4)), with: .color(Color(hex: 0x3A4350)))
                    inside.fill(Path(ellipseIn: CGRect(x: rivet.x - 1.5, y: rivet.y - 1.5, width: 1.8, height: 1.8)), with: .color(.white.opacity(0.35)))
                }
            }
        }
    }
}

/// A 50s atomic panel: cream card, charcoal outline, offset colour shadow and
/// mid-century decorations kept to the edges so text stays readable.
struct AtomicPanel: View, Equatable {
    let seed: String

    var body: some View {
        let number = stableSeed(seed)
        let shadow = [Atomic.teal, Atomic.orange, Atomic.lime, Atomic.mustard][Int(number % 4)]
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(shadow)
                .offset(x: 6, y: 6)
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(LinearGradient(colors: [Color(hex: 0xF8F2E2), Color(hex: 0xEFE5CC)], startPoint: .top, endPoint: .bottom))
            Canvas { context, size in
                AtomicPanel.decorate(&context, size: size, seed: number)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Atomic.ink, lineWidth: 2.5)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func decorate(_ context: inout GraphicsContext, size: CGSize, seed: UInt64) {
        var random = SeededRandom(seed)
        let w = size.width
        let h = size.height

        // Sparkles along the edges.
        let count = max(3, Int((w + h) / 110))
        var sparkles = context
        sparkles.opacity = 0.6
        for _ in 0..<count {
            let edge = Int(random.next() * 4) % 4
            let point: CGPoint
            switch edge {
            case 0: point = CGPoint(x: random.range(20, max(21, w - 20)), y: random.range(10, 34))
            case 1: point = CGPoint(x: random.range(max(12, w - 40), max(13, w - 12)), y: random.range(20, max(21, h - 20)))
            case 2: point = CGPoint(x: random.range(20, max(21, w - 20)), y: random.range(max(10, h - 34), max(11, h - 10)))
            default: point = CGPoint(x: random.range(10, 34), y: random.range(40, max(41, h - 20)))
            }
            let color = Atomic.palette[Int(random.next() * CGFloat(Atomic.palette.count)) % Atomic.palette.count]
            sparkles.fill(Atomic.sparkle(at: point, size: random.range(8, 18)), with: .color(color))
        }

        // A boomerang in the bottom-right corner of bigger panels.
        if w > 220 && h > 140 {
            var faint = context
            faint.opacity = 0.35
            let shape = Atomic.boomerang(at: CGPoint(x: w - 75, y: h - 45), size: 50, angle: random.range(-0.5, 0.3))
            faint.fill(shape, with: .color(Atomic.palette[Int(random.next() * 3) % 3]))
            faint.stroke(shape, with: .color(Atomic.ink), lineWidth: 2)
        }
        // An atom in the top-right corner.
        if w > 200 && h > 110 {
            var faint = context
            faint.opacity = 0.4
            Atomic.drawAtom(&faint, at: CGPoint(x: w - 40, y: 36), size: 24)
        }
        // A starburst low on tall panels.
        if h > 300 {
            var faint = context
            faint.opacity = 0.35
            Atomic.drawStarburst(&faint, at: CGPoint(x: 40, y: h - 46), size: 26)
        }
    }
}

/// The hull with a panel on it, or just the hull.
struct SpaceBackdropWithPage: View {
    let page: String?

    var body: some View {
        ZStack {
            HullPlating().equatable()
            if let page {
                AtomicPanel(seed: page).equatable()
                    .padding(.leading, 8)
                    .padding(.top, 8)
                    .padding(.trailing, 14)
                    .padding(.bottom, 14)
            }
        }
    }
}
