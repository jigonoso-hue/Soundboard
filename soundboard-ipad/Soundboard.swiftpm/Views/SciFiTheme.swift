import SwiftUI

// The Sci-Fi theme: a glowing holographic HUD. A dark blue grid with soft light,
// big radar rings, an edge ruler and corner brackets behind everything, and
// panels with cut corners, a cyan glow, a header tab, hatching and status dots.

enum HUD {
    static let cyan = Color(hex: 0x3FD2FF)
    static let bright = Color(hex: 0xBFF1FF)
    static let red = Color(hex: 0xFF4A5A)

    /// A rectangle with its top-left and bottom-right corners cut off.
    static func chamfer(_ r: CGRect, cut k: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: r.minX + k, y: r.minY))
        path.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        path.addLine(to: CGPoint(x: r.maxX, y: r.maxY - k))
        path.addLine(to: CGPoint(x: r.maxX - k, y: r.maxY))
        path.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        path.addLine(to: CGPoint(x: r.minX, y: r.minY + k))
        path.closeSubpath()
        return path
    }

    static func cut(for size: CGSize) -> CGFloat {
        max(4, min(18, size.width * 0.12, size.height * 0.25))
    }
}

struct ChamferShape: Shape {
    func path(in rect: CGRect) -> Path {
        HUD.chamfer(rect, cut: HUD.cut(for: rect.size))
    }
}

/// The HUD behind everything: grid, glow, radar rings, ruler, brackets and chevrons.
struct HUDBackdrop: View, Equatable {
    var body: some View {
        Canvas { context, size in
            HUDBackdrop.draw(&context, size: size)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func draw(_ context: inout GraphicsContext, size: CGSize) {
        let w = size.width
        let h = size.height
        let all = Path(CGRect(origin: .zero, size: size))
        context.fill(all, with: .linearGradient(
            Gradient(colors: [Color(hex: 0x03101F), Color(hex: 0x071F38)]),
            startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))

        // Grid.
        var grid = Path()
        var x: CGFloat = 0
        while x < w {
            grid.move(to: CGPoint(x: x + 0.5, y: 0))
            grid.addLine(to: CGPoint(x: x + 0.5, y: h))
            x += 32
        }
        var y: CGFloat = 0
        while y < h {
            grid.move(to: CGPoint(x: 0, y: y + 0.5))
            grid.addLine(to: CGPoint(x: w, y: y + 0.5))
            y += 32
        }
        context.stroke(grid, with: .color(HUD.cyan.opacity(0.07)), lineWidth: 1)

        // Soft light.
        var glow = context
        glow.addFilter(.blur(radius: min(70, max(w, h) * 0.07)))
        let glowRadius = min(140, max(w, h) * 0.14)
        let lights: [(CGPoint, Double)] = [(CGPoint(x: w * 0.3, y: h * 0.15), 0.35), (CGPoint(x: w * 0.8, y: h * 0.7), 0.25)]
        for (point, alpha) in lights {
            glow.fill(Path(ellipseIn: CGRect(x: point.x - glowRadius, y: point.y - glowRadius, width: glowRadius * 2, height: glowRadius * 2)),
                      with: .color(HUD.cyan.opacity(alpha)))
        }

        // Radar rings.
        let center = CGPoint(x: w * 0.62, y: h * 0.52)
        let radius = min(w, h) * 0.36
        let ringColor = GraphicsContext.Shading.color(HUD.cyan.opacity(0.16))
        func circle(_ r: CGFloat) -> Path {
            Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
        }
        context.stroke(circle(radius), with: ringColor, lineWidth: 1.5)
        context.stroke(circle(radius * 0.86), with: ringColor, style: StrokeStyle(lineWidth: 6, dash: [2, 6]))
        context.stroke(circle(radius * 0.7), with: ringColor, style: StrokeStyle(lineWidth: 1, dash: [18, 8]))
        context.stroke(circle(radius * 0.55), with: ringColor, lineWidth: 1)
        var ticks = Path()
        for i in 0..<90 {
            let angle = CGFloat(i) / 90 * .pi * 2
            let length: CGFloat = i % 5 == 0 ? 14 : 6
            let inner = radius * 1.04
            ticks.move(to: CGPoint(x: center.x + cos(angle) * inner, y: center.y + sin(angle) * inner))
            ticks.addLine(to: CGPoint(x: center.x + cos(angle) * (inner + length), y: center.y + sin(angle) * (inner + length)))
        }
        context.stroke(ticks, with: ringColor, lineWidth: 1)
        for (start, end) in [(-0.6, 0.4), (2.4, 3.1)] {
            var arc = Path()
            arc.addArc(center: center, radius: radius * 0.93, startAngle: .radians(start), endAngle: .radians(end), clockwise: false)
            context.stroke(arc, with: .color(HUD.cyan.opacity(0.22)), lineWidth: 5)
        }

        // Ruler down the left edge.
        var ruler = Path()
        var mark: CGFloat = 40
        while mark < h - 40 {
            ruler.move(to: CGPoint(x: 6, y: mark))
            ruler.addLine(to: CGPoint(x: Int(mark) % 40 == 0 ? 18 : 12, y: mark))
            mark += 8
        }
        context.stroke(ruler, with: .color(HUD.cyan.opacity(0.35)), lineWidth: 1)

        // Corner brackets.
        var brackets = Path()
        let corners: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [(8, 8, 1, 1), (w - 8, 8, -1, 1), (8, h - 8, 1, -1), (w - 8, h - 8, -1, -1)]
        for (cx, cy, sx, sy) in corners {
            brackets.move(to: CGPoint(x: cx, y: cy + sy * 30))
            brackets.addLine(to: CGPoint(x: cx, y: cy))
            brackets.addLine(to: CGPoint(x: cx + sx * 30, y: cy))
        }
        context.stroke(brackets, with: .color(HUD.cyan.opacity(0.6)), lineWidth: 2)

        // Chevrons in the bottom-right corner.
        for i in 0..<4 {
            let cx = w - 130 + CGFloat(i) * 22
            let cy = h - 26
            var chevron = Path()
            chevron.move(to: CGPoint(x: cx, y: cy - 7))
            chevron.addLine(to: CGPoint(x: cx + 10, y: cy))
            chevron.addLine(to: CGPoint(x: cx, y: cy + 7))
            chevron.addLine(to: CGPoint(x: cx + 5, y: cy))
            chevron.closeSubpath()
            context.fill(chevron, with: .color(HUD.cyan.opacity(0.3 * (0.3 + Double(i) * 0.2))))
        }
    }
}

/// A HUD panel: cut corners, a cyan glow and outline, an inner line, a header
/// tab, hatching, status dots, bright corner accents and side ticks.
struct HUDPanel: View, Equatable {
    let seed: String

    var body: some View {
        let number = stableSeed(seed)
        ZStack {
            ChamferShape()
                .fill(LinearGradient(colors: [Color(hex: 0x0A2846).opacity(0.88), Color(hex: 0x05162A).opacity(0.9)],
                                     startPoint: .top, endPoint: .bottom))
            ChamferShape()
                .stroke(HUD.cyan.opacity(0.7), lineWidth: 3)
                .blur(radius: 6)
            Canvas { context, size in
                HUDPanel.decorate(&context, size: size, seed: number)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func decorate(_ context: inout GraphicsContext, size: CGSize, seed: UInt64) {
        let r = CGRect(origin: .zero, size: size).insetBy(dx: 1.5, dy: 1.5)
        guard r.width > 20, r.height > 20 else { return }
        let w = r.width
        let h = r.height
        let k = HUD.cut(for: size)
        context.stroke(HUD.chamfer(r, cut: k), with: .color(HUD.cyan), lineWidth: 1.5)
        context.stroke(HUD.chamfer(r.insetBy(dx: 5, dy: 5), cut: max(2, k - 3)), with: .color(HUD.cyan.opacity(0.3)), lineWidth: 1)

        // Header tab.
        if w > 180 {
            let tabWidth = min(w * 0.4, 220)
            let left = r.minX + (w - tabWidth) / 2
            var tab = Path()
            tab.move(to: CGPoint(x: left, y: r.minY))
            tab.addLine(to: CGPoint(x: left + tabWidth, y: r.minY))
            tab.addLine(to: CGPoint(x: left + tabWidth - 10, y: r.minY + 9))
            tab.addLine(to: CGPoint(x: left + 10, y: r.minY + 9))
            tab.closeSubpath()
            context.fill(tab, with: .color(HUD.cyan.opacity(0.18)))
            context.stroke(tab, with: .color(HUD.cyan), lineWidth: 1)
        }

        // Hatching in the bottom-right corner.
        if w > 120 && h > 40 {
            var hatch = Path()
            for i in 0..<6 {
                let x = r.maxX - 30 - CGFloat(i) * 7
                hatch.move(to: CGPoint(x: x, y: r.maxY - 6))
                hatch.addLine(to: CGPoint(x: x + 5, y: r.maxY - 13))
            }
            context.stroke(hatch, with: .color(HUD.cyan.opacity(0.55)), lineWidth: 2)
        }

        // Status dots, sometimes with a red one.
        if w > 80 && h > 40 {
            for i in 0..<3 {
                let x = r.minX + k + 10 + CGFloat(i) * 9
                let color = i == 0 && seed % 2 == 1 ? HUD.red : HUD.cyan
                context.fill(Path(ellipseIn: CGRect(x: x - 2.3, y: r.maxY - 12.3, width: 4.6, height: 4.6)), with: .color(color))
            }
        }

        // Bright corner accents.
        let accent = min(24, w * 0.2, h * 0.3)
        var corners = Path()
        corners.move(to: CGPoint(x: r.maxX - accent, y: r.minY))
        corners.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        corners.addLine(to: CGPoint(x: r.maxX, y: r.minY + accent))
        corners.move(to: CGPoint(x: r.minX, y: r.maxY - accent))
        corners.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        corners.addLine(to: CGPoint(x: r.minX + accent, y: r.maxY))
        context.stroke(corners, with: .color(HUD.bright), lineWidth: 3)

        // Ticks down the right side of tall panels.
        if h > 200 {
            var ticks = Path()
            for i in 0..<8 {
                let y = r.minY + h * 0.35 + CGFloat(i) * 6
                ticks.move(to: CGPoint(x: r.maxX - 3, y: y))
                ticks.addLine(to: CGPoint(x: r.maxX - 9, y: y))
            }
            context.stroke(ticks, with: .color(HUD.cyan.opacity(0.5)), lineWidth: 1)
        }
    }
}
