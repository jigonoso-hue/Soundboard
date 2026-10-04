import SwiftUI

// The Space Age theme: a starship window onto deep space (nebulae, stars, a ringed
// planet and a flying saucer) framed by riveted hull plating, with 50s atomic
// panels: dark navy cards with a cream outline, an offset colour shadow,
// starfields, sparkles, boomerangs and atoms.

enum Atomic {
    static let teal = Color(hex: 0x12B5A5)
    static let orange = Color(hex: 0xF0643C)
    static let lime = Color(hex: 0xC3D23A)
    static let mustard = Color(hex: 0xF5A623)
    static let pink = Color(hex: 0xF497A5)
    static let ink = Color(hex: 0x232323)
    static let cream = Color(hex: 0xF6EFDD)
    static let navy = Color(hex: 0x0C142C)
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

    static func drawAtom(_ context: inout GraphicsContext, at p: CGPoint, size s: CGFloat, line: Color = ink) {
        for k in 0..<3 {
            let orbit = Path(ellipseIn: CGRect(x: -s, y: -s * 0.38, width: s * 2, height: s * 0.76))
                .applying(CGAffineTransform(rotationAngle: CGFloat(k) * .pi / 3))
                .applying(CGAffineTransform(translationX: p.x, y: p.y))
            context.stroke(orbit, with: .color(line), lineWidth: 2)
        }
        let nucleus = Path(ellipseIn: CGRect(x: p.x - s * 0.2, y: p.y - s * 0.2, width: s * 0.4, height: s * 0.4))
        context.fill(nucleus, with: .color(mustard))
        context.stroke(nucleus, with: .color(line), lineWidth: 2)
        for (color, angle) in [(teal, 0.0), (orange, 2.1), (lime, 4.2)] {
            let x = p.x + cos(CGFloat(angle)) * s
            let y = p.y + sin(CGFloat(angle)) * s * 0.38
            context.fill(Path(ellipseIn: CGRect(x: x - 4, y: y - 4, width: 8, height: 8)), with: .color(color))
        }
    }

    static func drawStarburst(_ context: inout GraphicsContext, at p: CGPoint, size s: CGFloat, line: Color = ink) {
        let colors = [teal, orange, lime]
        for k in 0..<12 {
            let angle = CGFloat(k) * .pi / 6
            let length = k.isMultiple(of: 2) ? s * 0.7 : s
            let end = CGPoint(x: p.x + cos(angle) * length, y: p.y + sin(angle) * length)
            var ray = Path()
            ray.move(to: p)
            ray.addLine(to: end)
            context.stroke(ray, with: .color(line), lineWidth: 1.4)
            context.fill(Path(ellipseIn: CGRect(x: end.x - 3, y: end.y - 3, width: 6, height: 6)), with: .color(colors[k % 3]))
        }
        context.fill(Path(ellipseIn: CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8)), with: .color(line))
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

/// A window onto deep space framed by hull plating: a nebula, stars, sparkles,
/// a ringed planet, a flying saucer and an atom.
struct SpaceScene: View, Equatable {
    let seed: String

    var body: some View {
        Canvas { context, size in
            SpaceScene.draw(&context, size: size, seed: stableSeed(seed))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func draw(_ context: inout GraphicsContext, size: CGSize, seed: UInt64) {
        HullPlating.draw(&context, size: size)
        let w = size.width
        let h = size.height
        let inset = min(14, w * 0.05)
        let viewport = CGRect(x: inset, y: inset, width: w - inset * 2, height: h - inset * 2)
        guard viewport.width > 10, viewport.height > 10 else { return }
        let radius = min(28, viewport.width * 0.2)
        let window = Path(roundedRect: viewport, cornerRadius: radius, style: .continuous)

        var space = context
        space.clip(to: window)
        space.fill(window, with: .linearGradient(
            Gradient(colors: [Color(hex: 0x050816), Color(hex: 0x0D1838), Color(hex: 0x1C1242)]),
            startPoint: .zero, endPoint: CGPoint(x: w, y: h)))

        var random = SeededRandom(seed &* 31 &+ 77)
        // Nebula clouds.
        var nebula = space
        nebula.addFilter(.blur(radius: min(60, max(w, h) * 0.08)))
        let scale = max(w, h) / 1100
        for (color, alpha) in [(Atomic.teal, 0.28), (Atomic.orange, 0.2), (Atomic.pink, 0.18), (Atomic.teal, 0.18), (Color(hex: 0x6A4CFF), 0.25)] {
            let rw = random.range(120, 260) * scale
            let rh = random.range(80, 180) * scale
            let cloud = Path(ellipseIn: CGRect(x: -rw, y: -rh, width: rw * 2, height: rh * 2))
                .applying(CGAffineTransform(rotationAngle: random.range(0, 3)))
                .applying(CGAffineTransform(translationX: random.range(0, w), y: random.range(0, h)))
            nebula.fill(cloud, with: .color(color.opacity(alpha)))
        }

        // Stars.
        let starCount = Int(w * h / 1500)
        for _ in 0..<starCount {
            let r = random.range(0.3, 1.4)
            let x = random.range(0, w)
            let y = random.range(0, h)
            let tint = random.next() < 0.12 ? Color(hex: 0xBBFFFF) : Color.white
            space.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)),
                       with: .color(tint.opacity(random.range(0.25, 0.95))))
        }
        for _ in 0..<18 {
            let point = CGPoint(x: random.range(0, w), y: random.range(0, h))
            let sparkleSize = random.range(4, 9)
            let color = random.next() < 0.5 ? Color.white : [Atomic.teal, Atomic.mustard, Atomic.pink][Int(random.next() * 3) % 3]
            space.fill(Atomic.sparkle(at: point, size: sparkleSize), with: .color(color))
        }

        drawPlanet(&space, at: CGPoint(x: w * 0.84, y: h * 0.2), radius: max(14, min(w, h) * 0.1), tilt: -0.35)
        drawSaucer(&space, at: CGPoint(x: w * 0.14, y: h * 0.8), size: min(34, w * 0.12))
        if w > 400 {
            var atom = space
            atom.opacity = 0.7
            Atomic.drawAtom(&atom, at: CGPoint(x: w * 0.55, y: h * 0.88), size: 30, line: Atomic.cream)
        }

        // The window frame.
        context.stroke(window, with: .color(Color(hex: 0x2C3440)), lineWidth: 5)
        context.stroke(Path(roundedRect: viewport.insetBy(dx: -3, dy: -3), cornerRadius: radius + 2, style: .continuous),
                       with: .color(.white.opacity(0.25)), lineWidth: 1.5)
    }

    /// An orange planet with a cream and teal ring passing behind and in front of it.
    static func drawPlanet(_ context: inout GraphicsContext, at p: CGPoint, radius r: CGFloat, tilt: CGFloat) {
        func ring(front: Bool) {
            var band = context
            band.translateBy(x: p.x, y: p.y)
            band.rotate(by: .radians(tilt))
            band.clip(to: Path(CGRect(x: -r * 3, y: front ? 0 : -r * 3, width: r * 6, height: r * 3)))
            let ellipse = Path(ellipseIn: CGRect(x: -r * 1.9, y: -r * 0.45, width: r * 3.8, height: r * 0.9))
            band.stroke(ellipse, with: .color(Atomic.cream), lineWidth: max(2, r * 0.07))
            band.stroke(ellipse, with: .color(Atomic.teal), lineWidth: max(1, r * 0.025))
        }
        ring(front: false)
        let body = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
        context.fill(body, with: .linearGradient(
            Gradient(colors: [Color(hex: 0xFFB35C), Color(hex: 0xE0532E)]),
            startPoint: CGPoint(x: p.x - r, y: p.y - r), endPoint: CGPoint(x: p.x + r, y: p.y + r)))
        var shade = context
        shade.clip(to: body)
        shade.fill(Path(ellipseIn: CGRect(x: p.x - r * 0.65, y: p.y - r * 0.65, width: r * 2, height: r * 2)),
                   with: .color(.black.opacity(0.25)))
        ring(front: true)
    }

    /// A little teal flying saucer with a cream dome and running lights.
    static func drawSaucer(_ context: inout GraphicsContext, at p: CGPoint, size s: CGFloat) {
        var dome = context
        dome.clip(to: Path(CGRect(x: p.x - s * 0.5, y: p.y - s * 0.7, width: s, height: s * 0.45)))
        dome.fill(Path(ellipseIn: CGRect(x: p.x - s * 0.45, y: p.y - s * 0.65, width: s * 0.9, height: s * 0.8)),
                  with: .color(Atomic.cream.opacity(0.9)))
        let hull = Path(ellipseIn: CGRect(x: p.x - s, y: p.y - s * 0.28, width: s * 2, height: s * 0.56))
        context.fill(hull, with: .color(Atomic.teal))
        context.stroke(hull, with: .color(Atomic.cream), lineWidth: 2)
        for d in [-0.6, 0.0, 0.6] {
            let x = p.x + CGFloat(d) * s
            context.fill(Path(ellipseIn: CGRect(x: x - 3, y: p.y + s * 0.05 - 3, width: 6, height: 6)), with: .color(Atomic.mustard))
        }
    }
}

/// The offset shadow of a panel, only where it sticks out past the panel, so a
/// see-through panel isn't tinted by it.
struct PanelShadow: Shape {
    var cornerRadius: CGFloat = 18
    var offset: CGFloat = 6

    func path(in rect: CGRect) -> Path {
        let panel = Path(roundedRect: rect, cornerRadius: cornerRadius, style: .continuous)
        return panel.offsetBy(dx: offset, dy: offset).subtracting(panel)
    }
}

/// A 50s atomic panel: dark navy, slightly see-through, with a cream outline, an
/// offset colour shadow, a faint starfield, and decorations kept to the edges so
/// text stays readable.
struct AtomicPanel: View, Equatable {
    let seed: String

    var body: some View {
        let number = stableSeed(seed)
        let shadow = [Atomic.teal, Atomic.orange, Atomic.lime, Atomic.mustard][Int(number % 4)]
        ZStack {
            PanelShadow().fill(shadow)
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Atomic.navy.opacity(0.9))
            Canvas { context, size in
                AtomicPanel.decorate(&context, size: size, seed: number)
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Atomic.cream, lineWidth: 2.5)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func decorate(_ context: inout GraphicsContext, size: CGSize, seed: UInt64) {
        var random = SeededRandom(seed)
        let w = size.width
        let h = size.height

        // A faint starfield.
        for _ in 0..<Int(w * h / 1800) {
            let r = random.range(0.3, 1.1)
            let x = random.range(0, w)
            let y = random.range(0, h)
            context.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)),
                         with: .color(.white.opacity(random.range(0.15, 0.55))))
        }

        // Sparkles along the edges.
        let count = max(3, Int((w + h) / 110))
        var sparkles = context
        sparkles.opacity = 0.8
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
            faint.opacity = 0.55
            let shape = Atomic.boomerang(at: CGPoint(x: w - 75, y: h - 45), size: 50, angle: random.range(-0.5, 0.3))
            faint.fill(shape, with: .color(Atomic.palette[Int(random.next() * 3) % 3]))
            faint.stroke(shape, with: .color(Atomic.cream), lineWidth: 2)
        }
        // An atom in the top-right corner.
        if w > 200 && h > 110 {
            var faint = context
            faint.opacity = 0.6
            Atomic.drawAtom(&faint, at: CGPoint(x: w - 40, y: 36), size: 24, line: Atomic.cream)
        }
        // A starburst low on tall panels.
        if h > 300 {
            var faint = context
            faint.opacity = 0.5
            Atomic.drawStarburst(&faint, at: CGPoint(x: 40, y: h - 46), size: 26, line: Atomic.cream)
        }
    }
}
