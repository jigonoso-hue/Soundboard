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

/// A window onto deep space framed by hull plating and a chrome rim: teal and
/// violet nebulae, a starfield with bright spiked stars, and (on wide pictures,
/// below the header row) a spiral galaxy, a 70s gas station on an asteroid, a
/// ringed gas giant with a cratered moon, and a chrome saucer with its beam on.
/// The same as the Mac's theme-art.js spaceScene.
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
        space.fill(window, with: SpaceArt.linear([(0, Color(hex: 0x03050F)), (0.5, Color(hex: 0x0A1230)), (1, Color(hex: 0x170C33))],
                                                 from: .zero, to: CGPoint(x: w, y: h)))
        var random = SeededRandom(seed &* 31 &+ 77)
        SpaceArt.nebula(&space, size: size, random: &random,
                        palette: [(Atomic.teal, 0.22, 3), (Color(hex: 0x6A4CFF), 0.25, 3), (Atomic.pink, 0.12, 2), (Color(hex: 0x1D54D6), 0.2, 2)])
        SpaceArt.starfield(&space, size: size, random: &random)

        // The big pieces stay out of the header row (y ≥ 170) and off narrow
        // pictures (the sidebar, an iPhone), where buttons fill the width.
        // (The same rule as the Mac's theme-art.js.)
        if w >= 560 {
            SpaceArt.spiralGalaxy(&space, at: CGPoint(x: w * 0.3, y: max(200, h * 0.3)), size: min(150, w * 0.1), tilt: -0.4)
            SpaceArt.gasStation(&space, at: CGPoint(x: w * 0.5, y: max(330, h * 0.66)), size: min(110, w * 0.07))
            let r = max(30, min(w, h) * 0.13)
            SpaceArt.gasGiant(&space, at: CGPoint(x: w * 0.84, y: max(240, h * 0.66)), radius: r, tilt: -0.32,
                              bands: [0xE9A96B, 0xC97A44, 0xF3D1A2, 0xA8582E, 0xF7E2C0, 0xB5643A],
                              rings: [Atomic.cream, Color(hex: 0xD8C6A3), Color(hex: 0x9AA5B3)])
            SpaceArt.moon(&space, at: CGPoint(x: w * 0.72, y: max(200, h * 0.5)), radius: r * 0.22, seed: 7)
            SpaceArt.saucer(&space, at: CGPoint(x: w * 0.14, y: max(300, h * 0.72)), size: min(44, w * 0.04), beam: true)
        }

        // A chrome window frame.
        context.stroke(window, with: SpaceArt.linear([(0, Color(hex: 0xE9EEF5)), (0.3, Color(hex: 0x6B778A)), (0.5, Color(hex: 0xDFE5EE)),
                                                      (0.75, Color(hex: 0x4F5967)), (1, Color(hex: 0xC3CBD6))],
                                                     from: .zero, to: CGPoint(x: w, y: h)), lineWidth: 6)
        context.stroke(Path(roundedRect: viewport.insetBy(dx: 3.5, dy: 3.5), cornerRadius: radius - 3, style: .continuous),
                       with: .color(.black.opacity(0.5)), lineWidth: 1)
    }
}

/// The Space Age backdrop's pieces (theme-art.js nebula, starfield,
/// spiralGalaxy, gasGiant, moon, saucer and gasStation).
enum SpaceArt {
    static func disc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
    }

    static func oval(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat, _ rotation: CGFloat = 0) -> Path {
        Path(ellipseIn: CGRect(x: -rx, y: -ry, width: rx * 2, height: ry * 2))
            .applying(CGAffineTransform(rotationAngle: rotation).concatenating(CGAffineTransform(translationX: x, y: y)))
    }

    static func linear(_ stops: [(CGFloat, Color)], from: CGPoint, to: CGPoint) -> GraphicsContext.Shading {
        .linearGradient(Gradient(stops: stops.map { .init(color: $0.1, location: $0.0) }), startPoint: from, endPoint: to)
    }

    static func radial(_ stops: [(CGFloat, Color)], center: CGPoint, from start: CGFloat = 0, to end: CGFloat) -> GraphicsContext.Shading {
        .radialGradient(Gradient(stops: stops.map { .init(color: $0.1, location: $0.0) }), center: center, startRadius: start, endRadius: end)
    }

    static func rgba(_ r: Double, _ g: Double, _ b: Double, _ a: Double) -> Color {
        Color(red: r / 255, green: g / 255, blue: b / 255).opacity(a)
    }

    // MARK: Space

    /// Big soft clouds, brighter cores, then dark dust lanes.
    static func nebula(_ context: inout GraphicsContext, size: CGSize, random: inout SeededRandom, palette: [(Color, Double, Int)]) {
        let w = size.width
        let h = size.height
        let s = max(w, h) / 1100
        var soft = context
        soft.addFilter(.blur(radius: min(90, max(w, h) * 0.09)))
        for (color, alpha, count) in palette {
            for _ in 0..<count {
                let x = random.range(-0.1, 1.1) * w
                let y = random.range(-0.1, 1.1) * h
                let rx = random.range(160, 340) * s
                let ry = random.range(90, 200) * s
                let rotation = random.range(0, 3)
                soft.fill(oval(x, y, rx, ry, rotation), with: .color(color.opacity(alpha)))
            }
        }
        var cores = context
        cores.addFilter(.blur(radius: min(40, max(w, h) * 0.04)))
        cores.blendMode = .screen
        for (color, _, _) in palette {
            let x = random.range(0.1, 0.9) * w
            let y = random.range(0.2, 0.9) * h
            let rx = random.range(60, 140) * s
            let ry = random.range(30, 70) * s
            let rotation = random.range(0, 3)
            cores.fill(oval(x, y, rx, ry, rotation), with: .color(color.opacity(0.18)))
        }
        var dust = context
        dust.addFilter(.blur(radius: min(30, max(w, h) * 0.03)))
        for _ in 0..<5 {
            let x = random.range(0, w)
            let y = random.range(0, h)
            let rx = random.range(120, 260) * s
            let ry = random.range(10, 30) * s
            let rotation = random.range(-0.6, 0.6)
            dust.fill(oval(x, y, rx, ry, rotation), with: .color(Color(hex: 0x03040C).opacity(0.35)))
        }
    }

    static let starTints: [UInt32] = [0xFFFFFF, 0xFFFFFF, 0xCFE4FF, 0xFFF2D6, 0xFFD9C2, 0xD9F7FF]

    /// Faint dust, mid stars tinted by temperature, and a few bright stars with
    /// a glow and diffraction spikes.
    static func starfield(_ context: inout GraphicsContext, size: CGSize, random: inout SeededRandom, density: CGFloat = 1) {
        let w = size.width
        let h = size.height
        for _ in 0..<Int(w * h / 700 * density) {
            let alpha = random.range(0.08, 0.45)
            let x = random.range(0, w)
            let y = random.range(0, h)
            let sw = random.range(0.5, 1.1)
            let sh = random.range(0.5, 1.1)
            context.fill(Path(CGRect(x: x, y: y, width: sw, height: sh)), with: .color(.white.opacity(alpha)))
        }
        for _ in 0..<Int(w * h / 4000 * density) {
            let r = random.range(0.6, 1.5)
            let alpha = random.range(0.5, 1)
            let tint = starTints[Int(random.next() * CGFloat(starTints.count)) % starTints.count]
            let x = random.range(0, w)
            let y = random.range(0, h)
            context.fill(disc(x, y, r), with: .color(Color(hex: tint).opacity(alpha)))
        }
        for _ in 0..<Int(max(4, w * h / 90000) * density) {
            let x = random.range(0, w)
            let y = random.range(0, h)
            let tint = Color(hex: starTints[Int(random.next() * CGFloat(starTints.count)) % starTints.count])
            let r = random.range(1.4, 2.4)
            let spike = random.range(8, 18)
            context.fill(disc(x, y, r * 6), with: radial([(0, tint), (0.25, .white.opacity(0.35)), (1, .white.opacity(0))],
                                                         center: CGPoint(x: x, y: y), to: r * 6))
            var spikes = Path()
            let arms: [(CGFloat, CGFloat, CGFloat)] = [(1, 0, spike), (0, 1, spike), (0.7, 0.7, spike * 0.35), (0.7, -0.7, spike * 0.35)]
            for (dx, dy, length) in arms {
                spikes.move(to: CGPoint(x: x - dx * length, y: y - dy * length))
                spikes.addLine(to: CGPoint(x: x + dx * length, y: y + dy * length))
            }
            context.stroke(spikes, with: .color(tint.opacity(0.7)), lineWidth: 0.7)
            context.fill(disc(x, y, r * 0.8), with: .color(.white))
        }
    }

    static func spiralGalaxy(_ context: inout GraphicsContext, at p: CGPoint, size: CGFloat, tilt: CGFloat) {
        var galaxy = context
        galaxy.translateBy(x: p.x, y: p.y)
        galaxy.rotate(by: .radians(tilt))
        galaxy.scaleBy(x: 1, y: 0.42)
        var random = SeededRandom(77)
        var core = galaxy
        core.addFilter(.blur(radius: size * 0.12))
        core.fill(disc(0, 0, size * 0.25), with: .color(rgba(255, 230, 200, 0.5)))
        for arm in 0..<2 {
            for i in 0..<160 {
                let t = CGFloat(i) / 160
                let a = CGFloat(arm) * .pi + t * 4.2
                let d = t * size
                let red = 200 + random.range(0, 55)
                let green = 210 + random.range(0, 45)
                let x = cos(a) * d + random.range(-3, 3)
                let y = sin(a) * d + random.range(-3, 3)
                let r = random.range(0.4, 1.3)
                galaxy.fill(disc(x, y, r), with: .color(rgba(Double(red), Double(green), 255, Double((1 - t) * 0.6))))
            }
        }
        galaxy.fill(disc(0, 0, size * 0.06), with: .color(Color(hex: 0xFFF6E8)))
    }

    // MARK: Bodies

    /// A banded gas giant with a storm, terminator, atmosphere and rings with a
    /// gap, their shadow on the planet and the planet's shadow on them.
    static func gasGiant(_ context: inout GraphicsContext, at p: CGPoint, radius r: CGFloat, tilt: CGFloat, bands: [UInt32], rings ringColors: [Color]) {
        func ringBand(front: Bool) {
            var band = context
            band.translateBy(x: p.x, y: p.y)
            band.rotate(by: .radians(tilt))
            band.clip(to: Path(CGRect(x: -r * 4, y: front ? 0 : -r * 4, width: r * 8, height: r * 4)))
            let rings: [(CGFloat, CGFloat, Color, Double)] = [(1.35, 1.5, ringColors[0], 0.55), (1.52, 1.78, ringColors[1], 0.85),
                                                              (1.83, 1.88, ringColors[2], 0.3), (1.9, 2.2, ringColors[2], 0.7),
                                                              (2.24, 2.32, ringColors[0], 0.35)]
            for (a, b, color, alpha) in rings {
                var k = a
                while k < b {
                    band.stroke(oval(0, 0, r * k, r * k * 0.24), with: .color(color.opacity(alpha * Double(0.75 + 0.25 * sin(k * 90)))),
                                lineWidth: max(0.6, r * 0.012))
                    k += 0.012
                }
            }
            if !front {
                // The planet's shadow falling on the rings behind it.
                var shadow = band
                shadow.clip(to: oval(0, 0, r * 2.34, r * 2.34 * 0.24))
                var wedge = Path()
                wedge.move(to: CGPoint(x: r * 0.2, y: -r * 0.1))
                wedge.addLine(to: CGPoint(x: r * 2.4, y: -r * 0.55))
                wedge.addLine(to: CGPoint(x: r * 2.4, y: -r * 0.05))
                wedge.addLine(to: CGPoint(x: r * 0.6, y: r * 0.2))
                wedge.closeSubpath()
                shadow.fill(wedge, with: .color(.black.opacity(0.55)))
            }
        }
        ringBand(front: false)
        let body = disc(p.x, p.y, r)
        var planet = context
        planet.clip(to: body)
        planet.fill(Path(CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)), with: .color(Color(hex: bands[0])))
        var surface = planet
        surface.translateBy(x: p.x, y: p.y)
        surface.rotate(by: .radians(tilt))
        var random = SeededRandom(311)
        for _ in 0..<26 {
            let by = random.range(-r, r)
            let bh = random.range(r * 0.03, r * 0.16)
            let alpha = random.range(0.25, 0.8)
            let color = Color(hex: bands[1 + Int(random.next() * CGFloat(bands.count - 1)) % (bands.count - 1)])
            let amp = random.range(0, r * 0.03)
            let phase = random.range(0, 6)
            var strip = Path()
            strip.move(to: CGPoint(x: -r, y: by))
            var bx = -r
            while bx <= r { strip.addLine(to: CGPoint(x: bx, y: by + sin(bx / r * 6 + phase) * amp)); bx += r / 20 }
            bx = r
            while bx >= -r { strip.addLine(to: CGPoint(x: bx, y: by + bh + sin(bx / r * 5 + phase) * amp)); bx -= r / 20 }
            strip.closeSubpath()
            surface.fill(strip, with: .color(color.opacity(Double(alpha))))
        }
        // The storm.
        surface.fill(oval(r * 0.28, r * 0.32, r * 0.17, r * 0.09), with: .color(Color(hex: bands[bands.count - 1])))
        surface.stroke(oval(r * 0.28, r * 0.32, r * 0.2, r * 0.11), with: .color(.white.opacity(0.35)), lineWidth: r * 0.012)
        // Light and the night side.
        planet.fill(body, with: radial([(0, .white.opacity(0.35)), (1, .white.opacity(0))], center: CGPoint(x: p.x - r * 0.45, y: p.y - r * 0.45), to: r * 1.2))
        planet.fill(body, with: radial([(0, .clear), (0.45, rgba(0, 0, 10, 0.55)), (1, rgba(0, 0, 10, 0.92))],
                                       center: CGPoint(x: p.x - r * 0.35, y: p.y - r * 0.35), from: r * 0.6, to: r * 1.55))
        // The rings' shadow across the planet.
        var ringShadow = planet
        ringShadow.translateBy(x: p.x, y: p.y)
        ringShadow.rotate(by: .radians(tilt))
        ringShadow.stroke(oval(0, r * 0.12, r * 1.65, r * 0.3), with: .color(.black.opacity(0.35)), lineWidth: r * 0.1)
        var rim = context
        rim.addFilter(.blur(radius: r * 0.08))
        rim.stroke(disc(p.x - r * 0.04, p.y - r * 0.04, r * 0.98), with: .color(rgba(255, 220, 180, 0.35)), lineWidth: r * 0.06)
        ringBand(front: true)
    }

    static func moon(_ context: inout GraphicsContext, at p: CGPoint, radius r: CGFloat, seed: UInt64, base: UInt32 = 0xB9BCC4) {
        let body = disc(p.x, p.y, r)
        context.fill(body, with: radial([(0, Color(hex: 0xEEF0F4)), (0.5, Color(hex: base)), (1, Color(hex: 0x5F636D))],
                                        center: CGPoint(x: p.x - r * 0.4, y: p.y - r * 0.4), to: r * 1.1))
        var surface = context
        surface.clip(to: body)
        var random = SeededRandom(seed)
        for _ in 0..<14 {
            let cx = p.x + random.range(-r, r) * 0.85
            let cy = p.y + random.range(-r, r) * 0.85
            let cr = random.range(r * 0.05, r * 0.2)
            surface.fill(disc(cx + cr * 0.15, cy + cr * 0.15, cr), with: .color(rgba(60, 62, 70, 0.35)))
            var lip = Path()
            lip.addArc(center: CGPoint(x: cx, y: cy), radius: cr, startAngle: .radians(.pi * 0.9), endAngle: .radians(.pi * 1.7), clockwise: false)
            surface.stroke(lip, with: .color(.white.opacity(0.3)), lineWidth: cr * 0.18)
        }
        surface.fill(body, with: radial([(0, .clear), (1, rgba(0, 0, 10, 0.85))], center: CGPoint(x: p.x - r * 0.3, y: p.y - r * 0.3), from: r * 0.5, to: r * 1.4))
    }

    /// A chrome flying saucer: mirrored hull, glowing rim lights, a glass dome and a beam.
    static func saucer(_ context: inout GraphicsContext, at p: CGPoint, size s: CGFloat, beam: Bool) {
        let x = p.x
        let y = p.y
        if beam {
            var cone = Path()
            cone.move(to: CGPoint(x: x - s * 0.35, y: y + s * 0.2))
            cone.addLine(to: CGPoint(x: x + s * 0.35, y: y + s * 0.2))
            cone.addLine(to: CGPoint(x: x + s * 0.9, y: y + s * 2.4))
            cone.addLine(to: CGPoint(x: x - s * 0.9, y: y + s * 2.4))
            cone.closeSubpath()
            context.fill(cone, with: linear([(0, rgba(150, 255, 235, 0.4)), (1, rgba(150, 255, 235, 0))], from: CGPoint(x: x, y: y), to: CGPoint(x: x, y: y + s * 2.4)))
        }
        var glow = context
        glow.addFilter(.blur(radius: s * 0.25))
        glow.fill(oval(x, y + s * 0.18, s * 0.9, s * 0.18), with: .color(rgba(120, 255, 230, 0.45)))
        // Dome.
        var dome = context
        dome.clip(to: Path(CGRect(x: x - s, y: y - s, width: s * 2, height: s * 0.85)))
        dome.fill(oval(x, y - s * 0.2, s * 0.42, s * 0.36),
                  with: radial([(0, rgba(230, 255, 255, 0.95)), (0.4, rgba(120, 220, 230, 0.6)), (1, rgba(30, 80, 110, 0.85))],
                               center: CGPoint(x: x - s * 0.15, y: y - s * 0.38), from: s * 0.02, to: s * 0.45))
        var glint = Path()
        glint.addArc(center: CGPoint(x: x - s * 0.08, y: y - s * 0.25), radius: s * 0.26, startAngle: .radians(.pi * 1.1), endAngle: .radians(.pi * 1.45), clockwise: false)
        dome.stroke(glint, with: .color(.white.opacity(0.6)), lineWidth: 1)
        // Hull: chrome.
        let hull = oval(x, y, s, s * 0.26)
        context.fill(hull, with: linear([(0, Color(hex: 0x7D8794)), (0.18, Color(hex: 0xF4F7FB)), (0.32, Color(hex: 0x9AA5B3)), (0.5, Color(hex: 0xE6EBF2)),
                                         (0.68, Color(hex: 0x6D7785)), (0.85, Color(hex: 0xCFD6DF)), (1, Color(hex: 0x59626E))],
                                        from: CGPoint(x: x - s, y: y - s * 0.26), to: CGPoint(x: x + s, y: y + s * 0.26)))
        context.fill(hull, with: linear([(0, .clear), (1, rgba(0, 0, 20, 0.45))], from: CGPoint(x: x, y: y), to: CGPoint(x: x, y: y + s * 0.26)))
        context.stroke(oval(x, y - s * 0.02, s * 0.98, s * 0.22), with: .color(.white.opacity(0.7)), lineWidth: 1)
        // Rim lights.
        let lights: [UInt32] = [0xFF6B5E, 0xFFD34D, 0x5DFFD9, 0xFF6B5E, 0xFFD34D, 0x5DFFD9, 0xFF6B5E]
        for (i, light) in lights.enumerated() {
            let a = CGFloat.pi * (0.12 + CGFloat(i) * 0.127)
            let lx = x + cos(a) * s * 0.82
            let ly = y + sin(a) * s * 0.12 + s * 0.06
            var bulb = context
            bulb.addFilter(.blur(radius: 3))
            bulb.fill(disc(lx, ly, s * 0.07), with: .color(Color(hex: light)))
            context.fill(disc(lx, ly, s * 0.025), with: .color(.white))
        }
    }

    /// A 70s gas station on an asteroid: a striped canopy over two pumps, a
    /// rounded kiosk with a glowing window, fuel tanks, a FUEL sign on a pylon
    /// and an antenna with a beacon. `p` is the centre of the asteroid's top.
    static func gasStation(_ context: inout GraphicsContext, at p: CGPoint, size s: CGFloat) {
        let x = p.x
        let y = p.y
        var random = SeededRandom(1977)
        let stripes: [UInt32] = [0xF5A623, 0xF0643C, 0xC2410C, 0x7C2D12]
        let cream = Color(hex: 0xF6EFDD)
        // The asteroid.
        var rock = Path()
        let n = 22
        for i in 0...n {
            let a = CGFloat.pi + CGFloat(i) / CGFloat(n) * .pi
            let rx = s * 1.55 * random.range(0.92, 1.05)
            let ry = s * 0.75 * random.range(0.8, 1.1)
            let point = CGPoint(x: x + cos(a) * rx, y: y - sin(a) * ry)
            if i == 0 { rock.move(to: point) } else { rock.addLine(to: point) }
        }
        rock.addLine(to: CGPoint(x: x + s * 1.5, y: y - s * 0.06))
        for i in 0...8 {
            rock.addLine(to: CGPoint(x: x + s * 1.5 - CGFloat(i) / 8 * s * 3, y: y - s * 0.06 + random.range(-s * 0.05, s * 0.03)))
        }
        rock.closeSubpath()
        var warm = context
        warm.addFilter(.blur(radius: s * 0.25))
        warm.fill(oval(x, y + s * 0.2, s * 1.9, s * 0.9), with: .color(rgba(255, 170, 90, 0.18)))
        context.fill(rock, with: linear([(0, Color(hex: 0xA89580)), (0.45, Color(hex: 0x6B5A4A)), (1, Color(hex: 0x2A2119))],
                                        from: CGPoint(x: x - s, y: y - s * 0.2), to: CGPoint(x: x + s, y: y + s * 0.8)))
        var craters = context
        craters.clip(to: rock)
        for _ in 0..<12 {
            let cx = x + random.range(-s * 1.3, s * 1.3)
            let cy = y + random.range(s * 0.05, s * 0.6)
            let cr = random.range(s * 0.04, s * 0.14)
            craters.fill(oval(cx + cr * 0.2, cy + cr * 0.15, cr, cr * 0.7), with: .color(rgba(30, 22, 16, 0.45)))
            var lip = Path()
            lip.addArc(center: .zero, radius: 1, startAngle: .radians(.pi * 0.95), endAngle: .radians(.pi * 1.7), clockwise: false)
            craters.stroke(lip.applying(CGAffineTransform(scaleX: cr, y: cr * 0.7).concatenating(CGAffineTransform(translationX: cx, y: cy))),
                           with: .color(rgba(220, 200, 175, 0.35)), lineWidth: cr * 0.2)
        }
        // The concrete deck.
        let deck = y - s * 0.12
        context.fill(Path(roundedRect: CGRect(x: x - s * 1.35, y: deck, width: s * 2.7, height: s * 0.12), cornerRadius: s * 0.03),
                     with: linear([(0, Color(hex: 0xD9D2C4)), (1, Color(hex: 0x8F877A))], from: CGPoint(x: x, y: deck), to: CGPoint(x: x, y: y)))
        context.fill(Path(CGRect(x: x - s * 1.2, y: y - s * 0.075, width: s * 0.25, height: s * 0.02)), with: .color(Atomic.mustard))
        context.fill(Path(CGRect(x: x - s * 0.1, y: y - s * 0.075, width: s * 0.25, height: s * 0.02)), with: .color(Atomic.mustard))
        // Fuel tanks: two spheres on legs.
        for (tx, tr) in [(x - s * 1.12, s * 0.2), (x - s * 0.82, s * 0.16)] {
            var legs = Path()
            legs.move(to: CGPoint(x: tx - tr * 0.6, y: deck)); legs.addLine(to: CGPoint(x: tx - tr * 0.3, y: deck - tr))
            legs.move(to: CGPoint(x: tx + tr * 0.6, y: deck)); legs.addLine(to: CGPoint(x: tx + tr * 0.3, y: deck - tr))
            context.stroke(legs, with: .color(Color(hex: 0x59626E)), lineWidth: s * 0.025)
            context.fill(disc(tx, deck - tr * 1.25, tr), with: radial([(0, .white), (0.45, Color(hex: 0xE2E7EE)), (1, Color(hex: 0x7D8794))],
                                                                     center: CGPoint(x: tx - tr * 0.4, y: deck - tr * 1.6), to: tr * 1.1))
            context.fill(Path(CGRect(x: tx - tr, y: deck - tr * 1.3, width: tr * 2, height: tr * 0.14)), with: .color(Atomic.orange))
        }
        // The kiosk: a rounded 70s pod with a band of warm windows.
        let kx = x - s * 0.55
        let kw = s * 0.95
        let kh = s * 0.5
        let ky = deck - kh
        let pod = UnevenRoundedRectangle(topLeadingRadius: kh * 0.5, bottomLeadingRadius: s * 0.04, bottomTrailingRadius: s * 0.04, topTrailingRadius: kh * 0.5)
            .path(in: CGRect(x: kx, y: ky, width: kw, height: kh))
        context.fill(pod, with: linear([(0, cream), (1, Color(hex: 0xC9BFA8))], from: CGPoint(x: kx, y: ky), to: CGPoint(x: kx + kw, y: ky + kh)))
        let windows = CGRect(x: kx + kw * 0.12, y: ky + kh * 0.28, width: kw * 0.76, height: kh * 0.32)
        var windowGlow = context
        windowGlow.addFilter(.blur(radius: s * 0.06))
        windowGlow.fill(Path(windows), with: .color(rgba(255, 214, 120, 0.8)))
        context.fill(Path(roundedRect: windows, cornerRadius: s * 0.03),
                     with: linear([(0, Color(hex: 0xFFF3C4)), (1, Color(hex: 0xFFB347))], from: CGPoint(x: 0, y: windows.minY), to: CGPoint(x: 0, y: windows.maxY)))
        var mullions = Path()
        for i in 1..<4 {
            let wx = windows.minX + windows.width * CGFloat(i) / 4
            mullions.move(to: CGPoint(x: wx, y: windows.minY)); mullions.addLine(to: CGPoint(x: wx, y: windows.maxY))
        }
        context.stroke(mullions, with: .color(rgba(90, 55, 20, 0.6)), lineWidth: s * 0.012)
        for (i, stripe) in stripes.enumerated() {
            context.fill(Path(CGRect(x: kx, y: ky + kh * 0.7 + CGFloat(i) * kh * 0.06, width: kw, height: kh * 0.06)), with: .color(Color(hex: stripe)))
        }
        // The canopy over the pumps, with stripes and lights underneath.
        let cx0 = x + s * 0.15
        let cw = s * 1.15
        let cy0 = deck - s * 0.62
        for px in [cx0 + cw * 0.12, cx0 + cw * 0.88] {
            context.fill(Path(CGRect(x: px - s * 0.02, y: cy0, width: s * 0.04, height: deck - cy0)), with: .color(Color(hex: 0x9AA5B3)))
        }
        var underGlow = context
        underGlow.addFilter(.blur(radius: s * 0.1))
        underGlow.fill(oval(cx0 + cw / 2, deck - s * 0.1, cw * 0.55, s * 0.08), with: .color(rgba(255, 240, 200, 0.5)))
        let roof = Path(roundedRect: CGRect(x: cx0 - s * 0.08, y: cy0 - s * 0.14, width: cw + s * 0.16, height: s * 0.16), cornerRadius: s * 0.08)
        context.fill(roof, with: .color(cream))
        var roofStripes = context
        roofStripes.clip(to: roof)
        for (i, stripe) in stripes.enumerated() {
            roofStripes.fill(Path(CGRect(x: cx0 - s * 0.1, y: cy0 - s * 0.07 + CGFloat(i) * s * 0.022, width: cw + s * 0.2, height: s * 0.022)), with: .color(Color(hex: stripe)))
        }
        for i in 0..<4 {
            context.fill(disc(cx0 + cw * (0.2 + CGFloat(i) * 0.2), cy0 + s * 0.035, s * 0.022), with: .color(Color(hex: 0xFFFBE6)))
        }
        // Two pumps.
        for px in [cx0 + cw * 0.33, cx0 + cw * 0.67] {
            let pw = s * 0.16
            let ph = s * 0.32
            let pump = UnevenRoundedRectangle(topLeadingRadius: pw * 0.4, bottomLeadingRadius: 1, bottomTrailingRadius: 1, topTrailingRadius: pw * 0.4)
            context.fill(pump.path(in: CGRect(x: px - pw / 2, y: deck - ph, width: pw, height: ph)),
                         with: linear([(0, Color(hex: 0xC9BFA8)), (0.4, Color(hex: 0xFBF5E6)), (1, Color(hex: 0xA9A08C))],
                                      from: CGPoint(x: px - pw / 2, y: 0), to: CGPoint(x: px + pw / 2, y: 0)))
            let top = UnevenRoundedRectangle(topLeadingRadius: pw * 0.4, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: pw * 0.4)
            context.fill(top.path(in: CGRect(x: px - pw / 2, y: deck - ph, width: pw, height: ph * 0.25)), with: .color(Atomic.orange))
            context.fill(Path(CGRect(x: px - pw * 0.3, y: deck - ph * 0.65, width: pw * 0.6, height: ph * 0.16)), with: .color(Color(hex: 0x112233)))
            context.fill(Path(CGRect(x: px - pw * 0.24, y: deck - ph * 0.62, width: pw * 0.48, height: ph * 0.1)), with: .color(Color(hex: 0x7DFFB0)))
            var hose = Path()
            hose.move(to: CGPoint(x: px + pw / 2, y: deck - ph * 0.5))
            hose.addQuadCurve(to: CGPoint(x: px + pw * 0.75, y: deck - ph * 0.75), control: CGPoint(x: px + pw * 1.1, y: deck - ph * 0.1))
            context.stroke(hose, with: .color(Color(hex: 0x2B2B2B)), lineWidth: s * 0.018)
        }
        // The sign: a round FUEL sign on a tall pylon, glowing.
        let sx = x + s * 1.38
        let sy = deck - s * 1.15
        let sr = s * 0.24
        context.fill(Path(CGRect(x: sx - s * 0.025, y: sy, width: s * 0.05, height: deck - sy)), with: .color(Color(hex: 0x7D8794)))
        var signGlow = context
        signGlow.addFilter(.blur(radius: s * 0.18))
        signGlow.fill(disc(sx, sy, sr * 1.3), with: .color(rgba(245, 166, 35, 0.6)))
        context.fill(disc(sx, sy, sr), with: linear([(0, Color(hex: 0xF4F7FB)), (0.5, Color(hex: 0x8F9AA9)), (1, Color(hex: 0xE2E7EE))],
                                                    from: CGPoint(x: sx - sr, y: sy - sr), to: CGPoint(x: sx + sr, y: sy + sr)))
        context.fill(disc(sx, sy, sr * 0.85), with: radial([(0, Color(hex: 0xFFD27A)), (1, Atomic.orange)], center: CGPoint(x: sx - sr * 0.3, y: sy - sr * 0.3), to: sr * 0.85))
        let ink = Color(hex: 0xFFF6E0)
        context.stroke(oval(sx, sy - sr * 0.28, sr * 0.38, sr * 0.1, -0.3), with: .color(ink), lineWidth: sr * 0.06)
        context.fill(disc(sx, sy - sr * 0.28, sr * 0.18), with: .color(ink))
        context.draw(Text("FUEL").font(.system(size: sr * 0.42, weight: .heavy, design: .rounded)).foregroundColor(ink),
                     at: CGPoint(x: sx, y: sy + sr * 0.3))
        // The antenna and its red beacon.
        let ax = kx + kw * 0.75
        var antenna = Path()
        antenna.move(to: CGPoint(x: ax, y: ky + kh * 0.1)); antenna.addLine(to: CGPoint(x: ax, y: ky - s * 0.45))
        antenna.move(to: CGPoint(x: ax - s * 0.08, y: ky - s * 0.25)); antenna.addLine(to: CGPoint(x: ax + s * 0.08, y: ky - s * 0.25))
        antenna.move(to: CGPoint(x: ax - s * 0.05, y: ky - s * 0.35)); antenna.addLine(to: CGPoint(x: ax + s * 0.05, y: ky - s * 0.35))
        context.stroke(antenna, with: .color(Color(hex: 0x9AA5B3)), lineWidth: s * 0.018)
        var beacon = context
        beacon.addFilter(.blur(radius: s * 0.05))
        beacon.fill(disc(ax, ky - s * 0.47, s * 0.05), with: .color(Color(hex: 0xFF4A4A)))
        context.fill(disc(ax, ky - s * 0.47, s * 0.018), with: .color(Color(hex: 0xFFD0D0)))
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
            case 0: point = CGPoint(x: random.range(20, max(21, w * 0.45)), y: random.range(6, 12))
            case 1: point = CGPoint(x: random.range(max(12, w - 40), max(13, w - 12)), y: random.range(20, max(21, h - 20)))
            case 2: point = CGPoint(x: random.range(20, max(21, w - 20)), y: random.range(max(10, h - 34), max(11, h - 10)))
            default: point = CGPoint(x: random.range(10, 34), y: random.range(40, max(41, h - 20)))
            }
            let color = Atomic.palette[Int(random.next() * CGFloat(Atomic.palette.count)) % Atomic.palette.count]
            sparkles.fill(Atomic.sparkle(at: point, size: random.range(8, 18)), with: .color(color))
        }

        // Bigger ornaments sit low in tall panels, never in the header row where the buttons are.
        if w > 220 && h > 260 {
            var faint = context
            faint.opacity = 0.35
            let shape = Atomic.boomerang(at: CGPoint(x: w - 75, y: h - 45), size: 50, angle: random.range(-0.5, 0.3))
            faint.fill(shape, with: .color(Atomic.palette[Int(random.next() * 3) % 3]))
            faint.stroke(shape, with: .color(Atomic.cream), lineWidth: 2)
        }
        // A starburst low on tall panels.
        if h > 320 {
            var faint = context
            faint.opacity = 0.35
            Atomic.drawStarburst(&faint, at: CGPoint(x: 40, y: h - 46), size: 26, line: Atomic.cream)
        }
    }
}

/// Space Age: a planet in the sound's colour with moons circling it, over a
/// playing sound. `soft` is the smaller one for a full sound's row. The same
/// as the Mac's theme-art.js orbitPlanet.
struct OrbitPlanet: View {
    let color: Color
    var soft = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            Canvas { context, size in
                let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                OrbitPlanet.draw(&context, size: size, time: time, color: color, soft: soft)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func draw(_ context: inout GraphicsContext, size: CGSize, time: Double, color: Color, soft: Bool) {
        let w = size.width
        let h = size.height
        guard w > 30, h > 20 else { return }
        let t = CGFloat(time.truncatingRemainder(dividingBy: 10_000))
        func disc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path {
            Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
        }
        // Clear of the name (top left) and the Stop button (bottom right).
        let r = max(5, min(h * 0.2, w * 0.11))
        let cx = w * (soft ? 0.62 : 0.68)
        let cy = h * (soft ? 0.47 : 0.4)
        let tilt: CGFloat = -0.28
        // (orbit size, speed, moon size, colour)
        let moons: [(CGFloat, CGFloat, CGFloat, Color)] = [(1.9, 1.1, 0.26, Atomic.cream), (2.7, -0.7, 0.2, Atomic.teal), (3.5, 0.5, 0.17, Atomic.mustard)]
        struct Moon { let x: CGFloat; let y: CGFloat; let behind: Bool; let size: CGFloat; let color: Color; let rx: CGFloat; let ry: CGFloat }
        let spots = moons.enumerated().map { i, moon -> Moon in
            let a = t * moon.1 + CGFloat(i) * 2.1
            let rx = r * moon.0
            let ry = rx * 0.32
            let lx = cos(a) * rx
            let ly = sin(a) * ry
            return Moon(x: cx + lx * cos(tilt) - ly * sin(tilt), y: cy + lx * sin(tilt) + ly * cos(tilt),
                        behind: sin(a) < 0, size: max(1.8, r * moon.2), color: moon.3, rx: rx, ry: ry)
        }
        let turn = CGAffineTransform(rotationAngle: tilt).concatenating(CGAffineTransform(translationX: cx, y: cy))
        for moon in spots {
            let orbit = Path(ellipseIn: CGRect(x: -moon.rx, y: -moon.ry, width: moon.rx * 2, height: moon.ry * 2)).applying(turn)
            context.stroke(orbit, with: .color(Atomic.cream.opacity(0.35)), style: StrokeStyle(lineWidth: 0.8, dash: [2, 3]))
        }
        for moon in spots where moon.behind { context.fill(disc(moon.x, moon.y, moon.size), with: .color(moon.color)) }
        var glow = context
        glow.addFilter(.blur(radius: 8))
        glow.opacity = 0.6
        glow.fill(disc(cx, cy, r * 1.3), with: .color(color))
        let body = disc(cx, cy, r)
        context.fill(body, with: .color(color))
        var surface = context
        surface.clip(to: body)
        // Bands, a highlight and the night side, turning slowly.
        for b: CGFloat in [-0.45, 0.1, 0.55] {
            let y = cy + r * b + sin(t * 0.8 + b * 4) * r * 0.05
            surface.fill(Path(CGRect(x: cx - r, y: y, width: r * 2, height: r * 0.16)), with: .color(.white.opacity(0.18)))
        }
        let light = CGPoint(x: cx - r * 0.4, y: cy - r * 0.45)
        surface.fill(body, with: .radialGradient(Gradient(colors: [.white.opacity(0.45), .white.opacity(0)]),
                                                 center: light, startRadius: 0, endRadius: r * 1.2))
        surface.fill(disc(cx + r * 0.4, cy + r * 0.4, r), with: .color(.black.opacity(0.32)))
        for moon in spots where !moon.behind { context.fill(disc(moon.x, moon.y, moon.size), with: .color(moon.color)) }

        // A few twinkling sparkles around it.
        var random = SeededRandom(31)
        for i in 0..<5 {
            let x = random.range(w * 0.1, w * 0.95)
            let y = random.range(h * 0.15, h * 0.9)
            let rate = random.range(1.5, 3)
            let s = random.range(3, 5)
            var sparkle = context
            sparkle.opacity = Double(max(0, sin(t * rate + CGFloat(i) * 2)) * 0.9)
            sparkle.fill(Atomic.sparkle(at: CGPoint(x: x, y: y), size: s), with: .color(i % 2 == 1 ? .white : Atomic.mustard))
        }
    }
}

/// Space Age: a gunmetal trim with a rivet in each corner, around tiles, full
/// sounds and bashes (the Mac's styles.css).
struct MetalTrim: View {
    var cornerRadius: CGFloat = 10

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius)
        ZStack {
            shape.strokeBorder(LinearGradient(stops: [.init(color: Color(hex: 0xB9C2CE), location: 0),
                                                      .init(color: Color(hex: 0x5B6676), location: 0.3),
                                                      .init(color: Color(hex: 0x8F9AA9), location: 0.5),
                                                      .init(color: Color(hex: 0x3D4654), location: 0.75),
                                                      .init(color: Color(hex: 0x7E899A), location: 1)],
                                              startPoint: .top, endPoint: .bottom), lineWidth: 3)
            shape.inset(by: 3).strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            GeometryReader { geo in
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(RadialGradient(colors: [Color(hex: 0xF0F3F7), Color(hex: 0x3A4250)],
                                             center: UnitPoint(x: 0.35, y: 0.35), startRadius: 0, endRadius: 2.4))
                        .frame(width: 4.4, height: 4.4)
                        .position(x: i % 2 == 0 ? 9 : geo.size.width - 9, y: i < 2 ? 9 : geo.size.height - 9)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
