import SwiftUI

/// One stroke (or filled detail) of an icon, on a 24×24 grid. `path` uses
/// only absolute M, L, C and Z commands (see tools/generate-ios-icons.py).
struct IconShape {
    let path: String
    var fill: Bool = false
    var opacity: Double = 1
}

struct IconDefinition: Identifiable {
    let id: String
    let name: String
    let category: String
    let shapes: [IconShape]
}

/// The app's own 100-icon set (the same icons as the Mac app), used for the
/// interface and for decorating bashes and scene kits.
enum Icons {
    static let fallback = "sparkle"

    static let byId: [String: IconDefinition] = {
        var map: [String: IconDefinition] = [:]
        for icon in IconData.all { map[icon.id] = icon }
        return map
    }()

    static let categories: [String] = {
        var out: [String] = []
        for icon in IconData.all where !out.contains(icon.category) { out.append(icon.category) }
        return out
    }()

    /// A known icon id; old emoji are mapped to their icon.
    static func resolve(_ id: String?) -> String {
        guard let id else { return fallback }
        if byId[id] != nil { return id }
        if let mapped = IconData.fromEmoji[id] { return mapped }
        return fallback
    }

    struct Parsed {
        let path: Path
        let fill: Bool
        let opacity: Double
    }

    static let parsed: [String: [Parsed]] = {
        var map: [String: [Parsed]] = [:]
        for icon in IconData.all {
            map[icon.id] = icon.shapes.map { Parsed(path: parse($0.path), fill: $0.fill, opacity: $0.opacity) }
        }
        return map
    }()

    /// Reads "M x y L x y C x1 y1 x2 y2 x y Z".
    static func parse(_ d: String) -> Path {
        let tokens = d.split(separator: " ").map(String.init)
        var path = Path()
        var index = 0
        func number() -> CGFloat {
            guard index < tokens.count, let value = Double(tokens[index]) else {
                index += 1
                return 0
            }
            index += 1
            return CGFloat(value)
        }
        func point() -> CGPoint {
            let x = number()
            let y = number()
            return CGPoint(x: x, y: y)
        }
        while index < tokens.count {
            let command = tokens[index]
            index += 1
            switch command {
            case "M":
                path.move(to: point())
            case "L":
                path.addLine(to: point())
            case "C":
                let c1 = point()
                let c2 = point()
                let end = point()
                path.addCurve(to: end, control1: c1, control2: c2)
            case "Z":
                path.closeSubpath()
            default:
                break
            }
        }
        return path
    }
}

/// Draws an icon in the current foreground style (set it with `.foregroundStyle`).
struct AppIcon: View {
    let id: String?
    var size: CGFloat? = 18
    var lineWidth: CGFloat = 1.8

    var body: some View {
        let shapes = Icons.parsed[Icons.resolve(id)] ?? []
        Canvas { context, canvasSize in
            let side = min(canvasSize.width, canvasSize.height)
            let scale = side / 24
            let transform = CGAffineTransform(translationX: (canvasSize.width - side) / 2, y: (canvasSize.height - side) / 2)
                .scaledBy(x: scale, y: scale)
            for shape in shapes {
                var layer = context
                layer.opacity = shape.opacity
                let path = shape.path.applying(transform)
                if shape.fill {
                    layer.fill(path, with: .foreground)
                } else {
                    layer.stroke(path, with: .foreground, style: StrokeStyle(lineWidth: lineWidth * scale, lineCap: .round, lineJoin: .round))
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// An icon on a coloured rounded square: bash covers, scene kit badges.
struct IconBadge: View {
    let icon: String?
    let color: String
    let iconColor: String
    var size: CGFloat = 28

    var body: some View {
        let background = Color(hexString: color) ?? Color(hex: 0x7C6CFF)
        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [background, background.opacity(0.55)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .background(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous).fill(Color.black))
            .overlay(
                AppIcon(id: icon, size: size * 0.58, lineWidth: size >= 48 ? 1.6 : 1.9)
                    .foregroundStyle(Color(hexString: iconColor) ?? .white)
                    .shadow(color: .black.opacity(0.35), radius: 2, y: 1)
            )
            .frame(width: size, height: size)
    }
}

/// An icon followed by a text label, for buttons and headers.
struct IconLabel: View {
    let title: String
    let icon: String
    var size: CGFloat = 16

    init(_ title: String, icon: String, size: CGFloat = 16) {
        self.title = title
        self.icon = icon
        self.size = size
    }

    var body: some View {
        Label {
            Text(title)
        } icon: {
            AppIcon(id: icon, size: size)
        }
    }
}
