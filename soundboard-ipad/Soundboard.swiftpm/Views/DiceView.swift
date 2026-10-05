import AVFoundation
import CoreMotion
import SceneKit
import SwiftUI
import UIKit

// Dice: real 3D dice that tumble with physics (SceneKit), in a tray the size
// of the screen. Matches the Mac app's dice.js.
//
// Pick dice, then tap Roll (hold it to throw harder), or A / DA for a d20 with
// advantage or disadvantage. On an iPhone you can also shake to roll: the dice
// follow the phone's motion until they settle. In a Live Session every roll
// shows on everyone's screen: each device throws the same dice in its own tray,
// and as they come to rest the faces are renumbered so they land on the
// roller's real result. The roll log lists who rolled what.

// MARK: - A roll's start, as it travels

struct ThrowSpec {
    var p: [Double]   // position: fractions of the floor's half-size
    var h: Double     // height
    var v: [Double]   // velocity: fractions of the floor's half-depth per second
    var w: [Double]   // spin, radians per second
    var q: [Double]   // starting rotation (x, y, z, w)

    var json: LiveJSON { ["p": p, "h": h, "v": v, "w": w, "q": q] }

    init(p: [Double], h: Double, v: [Double], w: [Double], q: [Double]) {
        self.p = p
        self.h = h
        self.v = v
        self.w = w
        self.q = q
    }

    init(json: LiveJSON) {
        func list(_ key: String, _ count: Int) -> [Double] {
            let raw = (json[key] as? [Any]) ?? []
            return (0..<count).map { $0 < raw.count ? (LiveNet.number(raw[$0]) ?? 0) : 0 }
        }
        p = list("p", 2)
        h = LiveNet.number(json["h"]) ?? 3
        v = list("v", 2)
        w = list("w", 3)
        q = list("q", 4)
    }

    /// A random throw from the bottom of the screen towards the top, harder with strength (1–3).
    static func random(strength: Double, kind: DieKind = .d6) -> ThrowSpec {
        func r(_ a: Double, _ b: Double) -> Double { Double.random(in: a...b) }
        let q = simd_quatd(angle: r(0, .pi * 2), axis: simd_normalize(SIMD3(r(-1, 1), r(-1, 1), r(-1, 1)) + SIMD3(0, 0.001, 0)))
        // Coins flip end over end.
        let spin = kind == .coin
            ? [r(18, 26) * (Bool.random() ? -1 : 1), r(-3, 3), r(-4, 4)]
            : [r(-1, 1) * 14, r(-1, 1) * 14, r(-1, 1) * 14]
        return ThrowSpec(
            p: [r(-0.7, 0.7), r(0.55, 0.85)],
            h: r(2, 4.5),
            v: [r(-0.5, 0.5) * strength, -r(1.1, 1.7) * strength],
            w: spin.map { $0 * strength },
            q: [q.imag.x, q.imag.y, q.imag.z, q.real]
        )
    }
}

struct RollStart {
    var id: String
    var by: String
    var mode: RollMode
    var modifier: Int
    var groups: [RollGroup]
    var kinds: [DieKind]
    var color: String
    var dice: [ThrowSpec]
    /// The custom dice in the roll, so every device can draw their words.
    var custom: [CustomDie] = []
    /// The request it answers (a check, initiative, who goes first).
    var ask: String?
    /// The broadcaster's hidden roll: listeners see the dice, never the numbers.
    var hidden = false
    /// Who rolled, from the broadcaster ("host" for the broadcaster).
    var peer: String?

    var json: LiveJSON {
        var m: LiveJSON = [
            "t": "roll", "id": id, "by": by, "mode": mode.rawValue, "modifier": modifier,
            "groups": groups.map { g -> LiveJSON in
                var group: LiveJSON = ["type": g.type, "dice": g.dice]
                if let die = g.die { group["die"] = die }
                return group
            },
            "kinds": kinds.map(\.rawValue), "color": color, "dice": dice.map(\.json),
        ]
        if !custom.isEmpty { m["custom"] = custom.map(\.json) }
        if let ask { m["ask"] = ask }
        if hidden { m["hidden"] = true }
        return m
    }

    init(id: String, by: String, mode: RollMode, modifier: Int, groups: [RollGroup], kinds: [DieKind], color: String, dice: [ThrowSpec]) {
        self.id = id
        self.by = by
        self.mode = mode
        self.modifier = modifier
        self.groups = groups
        self.kinds = kinds
        self.color = color
        self.dice = dice
    }

    init?(json: LiveJSON) {
        guard let id = LiveNet.string(json["id"]) else { return nil }
        let kinds = ((json["kinds"] as? [Any]) ?? []).compactMap { LiveNet.string($0).flatMap(DieKind.init(rawValue:)) }
        let dice = ((json["dice"] as? [Any]) ?? []).compactMap { $0 as? LiveJSON }.map(ThrowSpec.init(json:))
        guard !kinds.isEmpty, dice.count == kinds.count else { return nil }
        self.id = id
        by = LiveNet.string(json["by"]) ?? "Someone"
        mode = RollMode(rawValue: LiveNet.string(json["mode"]) ?? "") ?? .normal
        modifier = Int(LiveNet.number(json["modifier"]) ?? 0)
        groups = RollStart.groups(json["groups"])
        self.kinds = kinds
        color = LiveNet.string(json["color"]) ?? "#2a5bd7"
        self.dice = dice
        custom = RollStart.customs(json["custom"])
        ask = LiveNet.string(json["ask"])
        hidden = (json["hidden"] as? Bool) ?? false
        peer = LiveNet.string(json["peer"])
    }

    static func groups(_ value: Any?) -> [RollGroup] {
        ((value as? [Any]) ?? []).compactMap { item in
            guard let g = item as? LiveJSON, let type = LiveNet.string(g["type"]) else { return nil }
            let dice = ((g["dice"] as? [Any]) ?? []).compactMap { LiveNet.number($0).map(Int.init) }
            return dice.isEmpty ? nil : RollGroup(type: type, dice: dice, die: LiveNet.string(g["die"]))
        }
    }

    static func customs(_ value: Any?) -> [CustomDie] {
        ((value as? [Any]) ?? []).compactMap(CustomDie.clean)
    }

    func summarize(_ values: [Int]) -> RollSummary {
        DiceGeometry.summarize(mode: mode, modifier: modifier, groups: groups, values: values, customs: custom)
    }
}

/// Changes to a roll from the tray's own settings: a roll request's dice, an
/// enemy's initiative.
struct RollOptions {
    var counts: [String: Int]? = nil
    var modifier: Int? = nil
    var ask: String? = nil
    var by: String? = nil
    var owner: String? = nil
    var hidden: Bool? = nil
    /// Tumble over whatever is on screen (like other people's rolls) instead of opening the tray.
    var overlay = false
}

/// A finished roll, for whoever is watching (roll requests, natural 20 sounds).
struct RollOutcome {
    let id: String
    let start: RollStart
    let values: [Int]
    let summary: RollSummary
    let entry: RollEntry
}

struct RollEntry: Identifiable, Equatable {
    let id: String
    let by: String
    let title: String
    let detail: String
    /// nil when the dice show words.
    let total: Int?
    var at: Date
    let mine: Bool
    var hidden = false
    var ask: String?
    /// For the statistics: every d20, and the natural 20s and 1s that counted.
    var d20s: [Int] = []
    var nat20 = 0
    var nat1 = 0

    init(id: String, start: RollStart, values: [Int], summary: RollSummary, mine: Bool) {
        self.id = id
        by = start.by
        title = summary.title
        detail = summary.detail
        total = summary.total
        at = Date()
        self.mine = mine
        hidden = start.hidden
        ask = start.ask
        d20s = DiceGeometry.d20s(groups: start.groups, values: values)
        let counted = DiceGeometry.countedD20s(mode: start.mode, groups: start.groups, values: values)
        nat20 = counted.filter { $0 == 20 }.count
        nat1 = counted.filter { $0 == 1 }.count
    }
}

/// How a die looks: a custom die's words, or (someone else's hidden roll) no numbers at all.
struct DieLook {
    var blank = false
    var custom: CustomDie?
}

// MARK: - Face textures and dice geometry

enum DiceArt {
    // Used from the main thread and SceneKit's render thread.
    private static var textures: [String: UIImage] = [:]
    private static var geometries: [DieKind: SCNGeometry] = [:]
    private static let lock = NSRecursiveLock()

    static func color(_ hex: String) -> UIColor {
        UIColor(Color(hexString: hex) ?? Color(hex: 0x2A5BD7))
    }

    private static func luminance(_ color: UIColor) -> CGFloat {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        return 0.299 * r + 0.587 * g + 0.114 * b
    }

    private static func shade(_ color: UIColor, _ amount: CGFloat) -> UIColor {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        return UIColor(red: min(1, max(0, r + amount)), green: min(1, max(0, g + amount)), blue: min(1, max(0, b + amount)), alpha: 1)
    }

    /// A face: the die's colour, a bevel line just inside the edges, and its number
    /// (or, on a d4, a number near each corner, its top towards the corner).
    static func texture(_ kind: DieKind, face index: Int, texts: [String], color hex: String) -> UIImage {
        let key = "\(kind.rawValue)|\(index)|\(texts.joined(separator: ","))|\(hex)"
        lock.lock()
        defer { lock.unlock() }
        if let image = textures[key] { return image }
        let shape = DiceGeometry.build(kind)
        let face = shape.faces[index]
        let uvs = DiceGeometry.faceUVs(shape, face)
        let size: CGFloat = 256
        let base = color(hex)
        let ink = luminance(base) > 0.59 ? UIColor(red: 0.1, green: 0.1, blue: 0.13, alpha: 1) : UIColor(red: 0.98, green: 0.97, blue: 0.93, alpha: 1)
        let image = UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { context in
            let cg = context.cgContext
            let colors = [shade(base, 0.08).cgColor, shade(base, -0.08).cgColor] as CFArray
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                cg.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size, y: size), options: [])
            }
            func at(_ uv: SIMD2<Double>) -> CGPoint { CGPoint(x: CGFloat(uv.x) * size, y: CGFloat(1 - uv.y) * size) }
            let center = CGPoint(x: size / 2, y: size / 2)
            let bevel = UIBezierPath()
            for (i, uv) in uvs.enumerated() {
                let p = at(uv)
                let inner = CGPoint(x: center.x + (p.x - center.x) * 0.9, y: center.y + (p.y - center.y) * 0.9)
                if i == 0 { bevel.move(to: inner) } else { bevel.addLine(to: inner) }
            }
            bevel.close()
            shade(base, 0.16).setStroke()
            bevel.lineWidth = 3
            bevel.stroke()

            func font(_ px: CGFloat) -> UIFont {
                let descriptor = UIFont.systemFont(ofSize: px, weight: .bold).fontDescriptor.withDesign(.serif)
                return descriptor.map { UIFont(descriptor: $0, size: px) } ?? UIFont.boldSystemFont(ofSize: px)
            }
            func draw(_ text: String, at point: CGPoint, px: CGFloat, angle: CGFloat, underline: Bool) {
                let attributes: [NSAttributedString.Key: Any] = [.font: font(px), .foregroundColor: ink]
                let string = NSAttributedString(string: text, attributes: attributes)
                let bounds = string.size()
                cg.saveGState()
                cg.translateBy(x: point.x, y: point.y)
                cg.rotate(by: angle)
                string.draw(at: CGPoint(x: -bounds.width / 2, y: -bounds.height / 2))
                if underline {
                    ink.setFill()
                    cg.fill(CGRect(x: -18, y: px * 0.42, width: 36, height: 6))
                }
                cg.restoreGState()
            }
            // Writes text centred at a point, as large as fits in `width` (up to
            // `px`), on one line or, if it has spaces, two.
            func fit(_ text: String, at point: CGPoint, width: CGFloat, px: CGFloat, angle: CGFloat = 0) {
                guard !text.isEmpty else { return }
                func widthOf(_ line: String, _ size: CGFloat) -> CGFloat {
                    NSAttributedString(string: line, attributes: [.font: font(size)]).size().width
                }
                var lines = [text]
                if widthOf(text, px) > width && text.contains(" ") {
                    let words = text.split(separator: " ").map(String.init)
                    var best = [text]
                    var bestWidth = CGFloat.infinity
                    for i in 1..<words.count {
                        let pair = [words[..<i].joined(separator: " "), words[i...].joined(separator: " ")]
                        let w = pair.map { widthOf($0, px) }.max() ?? 0
                        if w < bestWidth {
                            bestWidth = w
                            best = pair
                        }
                    }
                    lines = best
                }
                var size = px
                while size > 16 && (lines.map { widthOf($0, size) }.max() ?? 0) > width { size -= 2 }
                let step = size * 1.05
                for (i, line) in lines.enumerated() {
                    let offset = (CGFloat(i) - CGFloat(lines.count - 1) / 2) * step
                    let dx = -sin(angle) * offset
                    let dy = cos(angle) * offset
                    draw(line, at: CGPoint(x: point.x + dx, y: point.y + dy), px: size, angle: angle, underline: false)
                }
            }
            let words = kind != .d4 && texts.contains { text in text.count > 3 || text.contains { !"0123456789+−-".contains($0) } }
            if kind == .coin {
                // A coin's flat faces: a raised ring and HEADS or TAILS; its edge is plain.
                if face.value != 0 {
                    let ring = UIBezierPath(arcCenter: center, radius: size * 0.4, startAngle: 0, endAngle: .pi * 2, clockwise: true)
                    shade(base, 0.22).setStroke()
                    ring.lineWidth = 7
                    ring.stroke()
                    draw(face.value == 1 ? "★" : "⚜", at: CGPoint(x: center.x, y: center.y - 18), px: 96, angle: 0, underline: false)
                    fit((texts.first ?? "").uppercased(), at: CGPoint(x: center.x, y: center.y + 62), width: size * 0.62, px: 40)
                }
            } else if words, let text = texts.first {
                // Words (custom dice): as large as fits, on up to two lines.
                let widths: [DieKind: CGFloat] = [.d6: 0.74, .d8: 0.5, .d10: 0.42, .d12: 0.6, .d20: 0.46]
                let sizes: [DieKind: CGFloat] = [.d6: 86, .d8: 64, .d10: 56, .d12: 64, .d20: 56]
                let y: CGFloat = (kind == .d8 || kind == .d20) ? center.y + 16 : (kind == .d10 ? center.y - 4 : center.y)
                fit(text, at: CGPoint(x: center.x, y: y), width: size * (widths[kind] ?? 0.5), px: sizes[kind] ?? 56)
            } else if kind == .d4 {
                for (i, text) in texts.enumerated() where i < uvs.count {
                    let p = at(uvs[i])
                    let point = CGPoint(x: center.x + (p.x - center.x) * 0.56, y: center.y + (p.y - center.y) * 0.56)
                    let angle = atan2(p.x - center.x, center.y - p.y)
                    // Words (a custom d4) shrink to fit.
                    fit(text, at: point, width: size * 0.3, px: 58, angle: angle)
                }
            } else if let text = texts.first {
                let px: CGFloat
                switch kind {
                case .d6: px = 120
                case .d8, .d12: px = 92
                case .d10: px = 74
                case .d10t: px = 62
                default: px = 74
                }
                let y: CGFloat = (kind == .d8 || kind == .d20) ? center.y + 14 : ((kind == .d10 || kind == .d10t) ? center.y - 6 : center.y)
                draw(text, at: CGPoint(x: center.x, y: y), px: text.count > 1 ? px * 0.85 : px, angle: 0,
                     underline: (text == "6" || text == "9") && kind != .d6)
            }
        }
        textures[key] = image
        return image
    }

    /// The text on each face of a die showing numbers `values` (per face, or
    /// per corner on a d4).
    static func faceTexts(_ kind: DieKind, values: [Int], look: DieLook) -> [[String]] {
        let shape = DiceGeometry.build(kind)
        return shape.faces.enumerated().map { index, face in
            if look.blank { return kind == .d4 ? ["", "", ""] : [""] }
            if kind == .d4 { return face.corners.map { look.custom?.label(values[$0]) ?? String(values[$0]) } }
            if let custom = look.custom { return [custom.label(values[index])] }
            return [DiceGeometry.label(kind, values[index])]
        }
    }

    /// The materials for a die with numbers `values` (per face, or per corner on a d4).
    static func materials(_ kind: DieKind, values: [Int], color: String, look: DieLook = DieLook(), dimmed: Bool = false) -> [SCNMaterial] {
        faceTexts(kind, values: values, look: look).enumerated().map { index, texts in
            let material = SCNMaterial()
            material.diffuse.contents = texture(kind, face: index, texts: texts, color: color)
            material.lightingModel = .physicallyBased
            // Coins are metal.
            material.roughness.contents = kind == .coin ? 0.32 : 0.38
            material.metalness.contents = kind == .coin ? 0.55 : 0.08
            material.transparency = dimmed ? 0.35 : 1
            return material
        }
    }

    /// The die's shape: one flat-shaded part per face, so each face has its own texture.
    static func geometry(_ kind: DieKind) -> SCNGeometry {
        lock.lock()
        defer { lock.unlock() }
        if let geometry = geometries[kind] { return geometry }
        let shape = DiceGeometry.build(kind)
        var positions: [SCNVector3] = []
        var normals: [SCNVector3] = []
        var uvs: [CGPoint] = []
        var elements: [SCNGeometryElement] = []
        for face in shape.faces {
            let corners = face.corners.map { shape.points[$0] }
            let faceUVs = DiceGeometry.faceUVs(shape, face)
            var indices: [UInt16] = []
            for k in 1..<(corners.count - 1) {
                for j in [0, k, k + 1] {
                    indices.append(UInt16(positions.count))
                    let p = corners[j]
                    positions.append(SCNVector3(Float(p.x), Float(p.y), Float(p.z)))
                    normals.append(SCNVector3(Float(face.normal.x), Float(face.normal.y), Float(face.normal.z)))
                    // SceneKit's texture coordinates start at the top left.
                    uvs.append(CGPoint(x: faceUVs[j].x, y: 1 - faceUVs[j].y))
                }
            }
            elements.append(SCNGeometryElement(indices: indices, primitiveType: .triangles))
        }
        let geometry = SCNGeometry(sources: [
            SCNGeometrySource(vertices: positions),
            SCNGeometrySource(normals: normals),
            SCNGeometrySource(textureCoordinates: uvs),
        ], elements: elements)
        geometries[kind] = geometry
        return geometry
    }
}

// MARK: - Sound and touch

/// A short click when dice hit something, and (on iPhone) a tap you can feel.
@MainActor
final class DiceClack {
    static let shared = DiceClack()
    private var players: [AVAudioPlayer] = []
    private var next = 0
    private var last = Date.distantPast
    private let haptics = UIImpactFeedbackGenerator(style: .rigid)

    private init() {
        let data = Self.clackWAV()
        players = (0..<6).compactMap { _ in try? AVAudioPlayer(data: data) }
        for player in players {
            player.enableRate = true
            player.prepareToPlay()
        }
    }

    func play(strength: Double, volume: Double) {
        guard Date().timeIntervalSince(last) > 0.035, !players.isEmpty else { return }
        last = Date()
        let player = players[next % players.count]
        next += 1
        player.volume = Float(min(1, strength / 14) * 0.6 * volume)
        player.rate = Float.random(in: 0.85...1.25)
        player.currentTime = 0
        player.play()
        if UIDevice.current.userInterfaceIdiom == .phone { haptics.impactOccurred(intensity: min(1, strength / 10)) }
    }

    /// 50 ms of filtered noise that dies away fast.
    private static func clackWAV() -> Data {
        let rate = 44_100
        let count = rate / 20
        var samples = [Int16](repeating: 0, count: count)
        var previous = 0.0
        for i in 0..<count {
            let noise = Double.random(in: -1...1) * exp(-Double(i) / (Double(count) * 0.12))
            // A rough band-pass: take out the low rumble.
            let value = noise - previous * 0.6
            previous = noise
            samples[i] = Int16(max(-1, min(1, value)) * 26_000)
        }
        var data = Data()
        func append<T>(_ value: T) { withUnsafeBytes(of: value) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8)); append(UInt32(36 + count * 2).littleEndian)
        data.append(contentsOf: Array("WAVEfmt ".utf8)); append(UInt32(16).littleEndian); append(UInt16(1).littleEndian)
        append(UInt16(1).littleEndian); append(UInt32(rate).littleEndian); append(UInt32(rate * 2).littleEndian)
        append(UInt16(2).littleEndian); append(UInt16(16).littleEndian)
        data.append(contentsOf: Array("data".utf8)); append(UInt32(count * 2).littleEndian)
        samples.forEach { append($0.littleEndian) }
        return data
    }
}

// MARK: - The scene

/// The 3D tray: a floor the size of the screen, walls at its edges, the dice.
/// SceneKit runs the physics; `tick()` (sixty times a second, on the main
/// thread) watches the dice settle. Only collision sounds come from SceneKit's
/// own thread.
final class DiceScene: NSObject, SCNPhysicsContactDelegate, @unchecked Sendable {
    static let cameraHeight: Float = 28
    /// The table's narrower half-size, at least: on a tall, narrow phone screen
    /// the camera pulls back so the dice aren't huge and have room to land.
    static let minHalfExtent: Float = 6.4
    private var cameraHeight: Float = DiceScene.cameraHeight
    static let fov: CGFloat = 30
    static let gravity: Float = 60

    let scene = SCNScene()
    private let camera = SCNNode()
    private var walls: [SCNNode] = []
    private var aspect: Float = 0.6

    final class Die {
        let kind: DieKind
        let node: SCNNode
        var values: [Int]
        let color: String
        let look: DieLook

        init(kind: DieKind, node: SCNNode, values: [Int], color: String, look: DieLook) {
            self.kind = kind
            self.node = node
            self.values = values
            self.color = color
            self.look = look
        }
    }

    final class Roll {
        let id: String
        let owner: String
        let local: Bool
        var dice: [Die] = []
        var target: [Int]?
        var done = false
        var quietFrames = 0
        var nudges = 0
        /// Shake rolls wait for the phone to be still before they count.
        var holdUntilStill = false
        let started = Date()
        var onDone: (([Int]?) -> Void)?

        init(id: String, owner: String, local: Bool) {
            self.id = id
            self.owner = owner
            self.local = local
        }
    }

    private var rolls: [Roll] = []
    /// Set from the main thread in shake mode: phone motion as scene forces.
    var motionGravity: SIMD3<Float>?
    var motionPush: SIMD3<Float> = .zero
    var phoneStill = true
    var volume: Double = 1

    override init() {
        super.init()
        scene.physicsWorld.gravity = SCNVector3(0, -Self.gravity, 0)
        scene.physicsWorld.timeStep = 1.0 / 120
        scene.physicsWorld.contactDelegate = self
        scene.background.contents = UIColor.clear

        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = Self.fov
        camera.camera?.zNear = 1
        camera.camera?.zFar = 100
        camera.position = SCNVector3(0, Self.cameraHeight, 0)
        camera.eulerAngles = SCNVector3(-Float.pi / 2, 0, 0)
        scene.rootNode.addChildNode(camera)

        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.intensity = 500
        scene.rootNode.addChildNode(ambient)
        let sun = SCNNode()
        sun.light = SCNLight()
        sun.light?.type = .directional
        sun.light?.intensity = 1200
        sun.light?.castsShadow = true
        sun.light?.shadowMode = .deferred
        sun.light?.shadowColor = UIColor.black.withAlphaComponent(0.35)
        sun.light?.shadowRadius = 4
        sun.light?.orthographicScale = 30
        sun.position = SCNVector3(-6, 20, -8)
        sun.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(sun)

        // A floor you can't see that still shows the dice's shadows.
        let plane = SCNPlane(width: 200, height: 200)
        let catcher = SCNMaterial()
        catcher.lightingModel = .shadowOnly
        plane.materials = [catcher]
        let floor = SCNNode(geometry: plane)
        floor.eulerAngles = SCNVector3(-Float.pi / 2, 0, 0)
        scene.rootNode.addChildNode(floor)
        let ground = SCNNode()
        ground.position = SCNVector3(0, -0.5, 0)
        ground.physicsBody = SCNPhysicsBody(type: .static, shape: SCNPhysicsShape(geometry: SCNBox(width: 200, height: 1, length: 200, chamferRadius: 0)))
        ground.physicsBody?.friction = 0.25
        ground.physicsBody?.restitution = 0.35
        ground.physicsBody?.categoryBitMask = 1
        scene.rootNode.addChildNode(ground)
        layout(aspect: 0.6)
    }

    /// The floor's half-width and half-depth visible on screen.
    func extents() -> (hx: Float, hz: Float) {
        let hz = cameraHeight * tan(Float(Self.fov) / 2 * .pi / 180)
        return (hz * aspect, hz)
    }

    /// Fits the walls to the screen.
    func layout(aspect newAspect: Float) {
        if !walls.isEmpty && abs(aspect - max(0.2, newAspect)) < 0.001 { return }
        aspect = max(0.2, newAspect)
        let tanHalf = tan(Float(Self.fov) / 2 * .pi / 180)
        cameraHeight = max(Self.cameraHeight, Self.minHalfExtent / min(1, aspect) / tanHalf)
        camera.position = SCNVector3(0, cameraHeight, 0)
        camera.camera?.zFar = Double(cameraHeight + 40)
        walls.forEach { $0.removeFromParentNode() }
        let (hx, hz) = extents()
        let inset: Float = 1
        func wall(x: Float, z: Float, width: CGFloat, length: CGFloat) -> SCNNode {
            let node = SCNNode()
            node.position = SCNVector3(x, 6, z)
            node.physicsBody = SCNPhysicsBody(type: .static, shape: SCNPhysicsShape(geometry: SCNBox(width: width, height: 14, length: length, chamferRadius: 0)))
            node.physicsBody?.friction = 0.25
            node.physicsBody?.restitution = 0.35
            node.physicsBody?.categoryBitMask = 1
            scene.rootNode.addChildNode(node)
            return node
        }
        let w = CGFloat(hx * 2 + 4)
        let l = CGFloat(hz * 2 + 4)
        walls = [
            wall(x: -hx + inset - 1, z: 0, width: 2, length: l),
            wall(x: hx - inset + 1, z: 0, width: 2, length: l),
            wall(x: 0, z: -hz + inset - 1, width: w, length: 2),
            wall(x: 0, z: hz - inset + 1, width: w, length: 2),
        ]
        let lid = SCNNode()
        lid.position = SCNVector3(0, 13, 0)
        lid.physicsBody = SCNPhysicsBody(type: .static, shape: SCNPhysicsShape(geometry: SCNBox(width: w, height: 2, length: l, chamferRadius: 0)))
        lid.physicsBody?.categoryBitMask = 1
        scene.rootNode.addChildNode(lid)
        walls.append(lid)
    }

    /// Throws dice. A new roll by the same person clears their last one.
    @discardableResult
    func throwDice(id: String, owner: String, kinds: [DieKind], specs: [ThrowSpec], color: String, local: Bool,
                   looks: [DieLook] = [], holdUntilStill: Bool = false, onDone: @escaping ([Int]?) -> Void) -> Roll {
        for roll in rolls where roll.owner == owner { remove(roll) }
        rolls.removeAll { $0.owner == owner }
        while rolls.reduce(0, { $0 + $1.dice.count }) + kinds.count > 40, !rolls.isEmpty {
            remove(rolls.removeFirst())
        }
        let (hx, hz) = extents()
        let roll = Roll(id: id, owner: owner, local: local)
        roll.holdUntilStill = holdUntilStill
        roll.onDone = onDone
        for (i, kind) in kinds.enumerated() {
            let spec = specs[i]
            let values = DiceGeometry.defaultValues(kind)
            let look = i < looks.count ? looks[i] : DieLook()
            let geometry = DiceArt.geometry(kind).copy() as! SCNGeometry
            geometry.materials = DiceArt.materials(kind, values: values, color: color, look: look)
            let node = SCNNode(geometry: geometry)
            node.castsShadow = true
            node.position = SCNVector3(Float(spec.p[0]) * (hx - 1.6), Float(spec.h), Float(spec.p[1]) * (hz - 1.6))
            node.simdOrientation = simd_quatf(ix: Float(spec.q[0]), iy: Float(spec.q[1]), iz: Float(spec.q[2]), r: Float(spec.q[3])).normalized
            let body = SCNPhysicsBody(type: .dynamic, shape: SCNPhysicsShape(geometry: DiceArt.geometry(kind), options: [.type: SCNPhysicsShape.ShapeType.convexHull]))
            body.mass = 1
            body.friction = 0.25
            body.rollingFriction = 0.02
            body.restitution = 0.4
            body.damping = 0.05
            body.angularDamping = 0.12
            body.allowsResting = true
            // Each person's dice only hit their own dice (and the tray), never someone else's.
            let group = groupFor(owner)
            body.categoryBitMask = group
            body.collisionBitMask = 1 | group
            body.contactTestBitMask = 1 | group
            node.physicsBody = body
            scene.rootNode.addChildNode(node)
            body.velocity = SCNVector3(Float(spec.v[0]) * hz, 0, Float(spec.v[1]) * hz)
            let spin = SIMD3<Float>(Float(spec.w[0]), Float(spec.w[1]), Float(spec.w[2]))
            let speed = simd_length(spin)
            if speed > 0.001 {
                let axis = spin / speed
                body.angularVelocity = SCNVector4(axis.x, axis.y, axis.z, speed)
            }
            roll.dice.append(Die(kind: kind, node: node, values: values, color: color, look: look))
        }
        rolls.append(roll)
        return roll
    }

    private var groups: [String: Int] = [:]

    /// A collision group of its own for each person rolling (bit 1 is the tray).
    private func groupFor(_ owner: String) -> Int {
        if let bit = groups[owner] { return bit }
        let used = Set(rolls.compactMap { groups[$0.owner] })
        let bit = (1..<16).map { 1 << $0 }.first { !used.contains($0) } ?? 2
        groups[owner] = bit
        return bit
    }

    // MARK: Natural 1s and 20s

    /// A skull and crossbones over a natural 1; fireworks over a natural 20.
    func celebrate(id: String, die index: Int, natural: Int) {
        guard let roll = rolls.first(where: { $0.id == id }), index < roll.dice.count else { return }
        let at = roll.dice[index].node.presentation.position
        if natural == 1 { skull(at: at) } else if natural == 20 { fireworks(at: at) }
    }

    private static func emojiImage(_ text: String, size: CGFloat) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
            let string = NSAttributedString(string: text, attributes: [.font: UIFont.systemFont(ofSize: size * 0.8)])
            let bounds = string.size()
            string.draw(at: CGPoint(x: (size - bounds.width) / 2, y: (size - bounds.height) / 2))
        }
    }

    private static let sparkImage: UIImage = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32)).image { context in
        let colors = [UIColor.white.cgColor, UIColor.white.withAlphaComponent(0).cgColor] as CFArray
        if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
            context.cgContext.drawRadialGradient(gradient, startCenter: CGPoint(x: 16, y: 16), startRadius: 0,
                                                 endCenter: CGPoint(x: 16, y: 16), endRadius: 16, options: [])
        }
    }

    /// The skull pops up beside the die (towards the top of the screen), bobs, then floats away.
    private func skull(at p: SCNVector3) {
        let plane = SCNPlane(width: 2.2, height: 2.2)
        let material = SCNMaterial()
        material.diffuse.contents = Self.emojiImage("☠️", size: 256)
        material.lightingModel = .constant
        material.isDoubleSided = true
        plane.materials = [material]
        let node = SCNNode(geometry: plane)
        node.position = SCNVector3(p.x, 4, p.z - 0.6)
        node.eulerAngles = SCNVector3(-Float.pi / 2, 0, 0)
        node.scale = SCNVector3(0.2, 0.2, 0.2)
        node.opacity = 0
        scene.rootNode.addChildNode(node)
        let pop = SCNAction.group([
            SCNAction.fadeIn(duration: 0.3),
            SCNAction.scale(to: 1.25, duration: 0.35),
            SCNAction.move(by: SCNVector3(0, 0, -1.6), duration: 0.35),
        ])
        let wobble = SCNAction.sequence([
            SCNAction.rotateBy(x: 0, y: 0.25, z: 0, duration: 0.25),
            SCNAction.rotateBy(x: 0, y: -0.5, z: 0, duration: 0.5),
            SCNAction.rotateBy(x: 0, y: 0.25, z: 0, duration: 0.25),
        ])
        let away = SCNAction.group([SCNAction.fadeOut(duration: 0.5), SCNAction.move(by: SCNVector3(0, 0, -1.2), duration: 0.5)])
        node.runAction(SCNAction.sequence([
            pop, SCNAction.scale(to: 1, duration: 0.15), SCNAction.repeat(wobble, count: 2), away, SCNAction.removeFromParentNode(),
        ]))
    }

    /// Light fireworks: three bursts of sparks at and around the die.
    private func fireworks(at p: SCNVector3) {
        let colors: [UIColor] = [
            UIColor(red: 1, green: 0.96, blue: 0.78, alpha: 1), UIColor(red: 1, green: 0.82, blue: 0.48, alpha: 1),
            .white, UIColor(red: 1, green: 0.7, blue: 0.28, alpha: 1), UIColor(red: 0.6, green: 0.9, blue: 1, alpha: 1),
            UIColor(red: 1, green: 0.62, blue: 0.81, alpha: 1),
        ]
        for (dx, dz, delay) in [(Float(0), Float(-0.8), 0.0), (-1.6, -2.0, 0.26), (1.8, -1.4, 0.52)] {
            let node = SCNNode()
            node.position = SCNVector3(p.x + dx, 5, p.z + dz)
            scene.rootNode.addChildNode(node)
            let color = colors.randomElement() ?? .white
            node.runAction(SCNAction.sequence([
                SCNAction.wait(duration: delay),
                SCNAction.run { node in
                    let burst = SCNParticleSystem()
                    burst.loops = false
                    burst.emissionDuration = 0.05
                    burst.birthRate = 840
                    burst.particleLifeSpan = 1.1
                    burst.particleLifeSpanVariation = 0.4
                    burst.emittingDirection = SCNVector3(0, 1, 0)
                    burst.spreadingAngle = 180
                    burst.particleVelocity = 7
                    burst.particleVelocityVariation = 3
                    burst.acceleration = SCNVector3(0, 0, 4)
                    burst.dampingFactor = 1.2
                    burst.particleImage = DiceScene.sparkImage
                    burst.particleSize = 0.16
                    burst.particleSizeVariation = 0.06
                    burst.particleColor = color
                    burst.particleColorVariation = SCNVector4(0.08, 0.2, 0, 0)
                    burst.blendMode = .additive
                    burst.isLightingEnabled = false
                    let fade = CAKeyframeAnimation()
                    fade.values = [1, 1, 0]
                    fade.keyTimes = [0, 0.6, 1]
                    burst.propertyControllers = [.opacity: SCNParticlePropertyController(animation: fade)]
                    node.addParticleSystem(burst)
                },
                SCNAction.wait(duration: 2.2),
                SCNAction.removeFromParentNode(),
            ]))
        }
    }

    private func remove(_ roll: Roll) {
        roll.dice.forEach { $0.node.removeFromParentNode() }
    }

    func clear() {
        rolls.forEach(remove)
        rolls.removeAll()
    }

    /// The result arrived for someone else's roll: land on it.
    func setTarget(id: String, values: [Int]) {
        guard let roll = rolls.first(where: { $0.id == id }) else { return }
        roll.target = values
        if roll.done { land(roll, force: true) }
    }

    func isDone(_ id: String) -> Bool {
        return rolls.first(where: { $0.id == id })?.done ?? false
    }

    /// Dims the d20 that didn't count in an advantage or disadvantage roll.
    func dim(id: String, die index: Int) {
        guard let roll = rolls.first(where: { $0.id == id }), index < roll.dice.count else { return }
        let die = roll.dice[index]
        die.node.geometry?.materials = DiceArt.materials(die.kind, values: die.values, color: die.color, look: die.look, dimmed: true)
    }

    private func rotation(_ node: SCNNode) -> simd_quatd {
        let q = node.presentation.simdOrientation
        return simd_quatd(ix: Double(q.imag.x), iy: Double(q.imag.y), iz: Double(q.imag.z), r: Double(q.real))
    }

    /// Renumbers someone else's dice so the faces now on top show the result.
    /// While they're slowing down this happens out of sight on the sides that will land.
    private func land(_ roll: Roll, force: Bool) {
        guard let target = roll.target else { return }
        for (i, die) in roll.dice.enumerated() where i < target.count {
            guard let body = die.node.physicsBody else { continue }
            let spin = body.angularVelocity.w
            let speed = simd_length(SIMD3<Float>(body.velocity.x, body.velocity.y, body.velocity.z))
            if !force && (abs(spin) > 3 || speed > 3) { continue }
            let top = DiceGeometry.top(die.kind, rotation: rotation(die.node))
            if die.values[top.index] == target[i] { continue }
            die.values = DiceGeometry.relabel(die.kind, values: die.values, index: top.index, wanted: target[i])
            die.node.geometry?.materials = DiceArt.materials(die.kind, values: die.values, color: die.color, look: die.look)
        }
    }

    // MARK: Keeping dice in view

    private struct Slide {
        let node: SCNNode
        let from: SIMD2<Float>
        let to: SIMD2<Float>
        let started: Date
    }
    private var slides: [Slide] = []
    private var afterSlides: (() -> Void)?

    /// Slides settled dice out from under things on screen (the result banner,
    /// the controls), so none is hidden. Only where they sit changes, never how
    /// they lie: the face on top, and so the roll, stays the same.
    /// rects: boxes as fractions of the screen (0…1, top left first).
    func clearOf(_ rects: [CGRect], then: @escaping () -> Void) {
        let (hx, hz) = extents()
        func screen(_ x: Float, _ z: Float) -> CGPoint {
            CGPoint(x: CGFloat((x / hx + 1) / 2), y: CGFloat((z / hz + 1) / 2))
        }
        func hits(_ x: Float, _ z: Float, _ r: Float) -> Bool {
            let p = screen(x, z)
            let rx = CGFloat(r / (2 * hx))
            let rz = CGFloat(r / (2 * hz))
            return rects.contains { p.x + rx > $0.minX && p.x - rx < $0.maxX && p.y + rz > $0.minY && p.y - rz < $0.maxY }
        }
        let settled = rolls.filter(\.done).flatMap(\.dice)
        func radius(_ d: Die) -> Float { Float(d.kind.radius) * 1.15 }
        let covered = settled.filter { hits($0.node.presentation.position.x, $0.node.presentation.position.z, radius($0)) }
        guard !covered.isEmpty else {
            then()
            return
        }
        var placed: [(x: Float, z: Float, r: Float)] = settled.filter { d in !covered.contains { $0 === d } }
            .map { ($0.node.presentation.position.x, $0.node.presentation.position.z, radius($0)) }
        slides = covered.map { d in
            let r = radius(d)
            let from = SIMD2(d.node.presentation.position.x, d.node.presentation.position.z)
            let maxX = hx - 1 - r
            let maxZ = hz - 1 - r
            // The nearest free spot: in view, inside the walls, clear of the other dice.
            var best: SIMD2<Float>?
            var bestDist = Float.infinity
            let step = r * 0.7
            var x = -maxX
            while x <= maxX {
                var z = -maxZ
                while z <= maxZ {
                    let dist = simd_length(SIMD2(x, z) - from)
                    if dist < bestDist && !hits(x, z, r) && !placed.contains(where: { hypot($0.x - x, $0.z - z) < $0.r + r }) {
                        best = SIMD2(x, z)
                        bestDist = dist
                    }
                    z += step
                }
                x += step
            }
            let to = best ?? from
            placed.append((to.x, to.y, r))
            // Held in place while it slides, so physics doesn't move or turn it.
            d.node.physicsBody?.velocity = SCNVector3Zero
            d.node.physicsBody?.angularVelocity = SCNVector4Zero
            d.node.physicsBody?.isAffectedByGravity = false
            return Slide(node: d.node, from: from, to: to, started: Date())
        }
        afterSlides = then
    }

    /// Moves sliding dice along (from tick()).
    private func stepSlides() {
        guard !slides.isEmpty else { return }
        var finished = true
        for slide in slides {
            let t = Float(min(1, Date().timeIntervalSince(slide.started) / 0.38))
            let e = 1 - pow(1 - t, 3) // ease out
            let p = slide.from + (slide.to - slide.from) * e
            let y = slide.node.presentation.position.y
            let rotation = slide.node.presentation.orientation
            slide.node.position = SCNVector3(p.x, y, p.y)
            slide.node.orientation = rotation
            slide.node.physicsBody?.velocity = SCNVector3Zero
            slide.node.physicsBody?.angularVelocity = SCNVector4Zero
            slide.node.physicsBody?.resetTransform()
            if t < 1 { finished = false }
        }
        if finished {
            for slide in slides { slide.node.physicsBody?.isAffectedByGravity = true }
            slides = []
            let then = afterSlides
            afterSlides = nil
            then?()
        }
    }

    // MARK: Every physics step

    var isBusy: Bool { rolls.contains { !$0.done } || !slides.isEmpty }

    func tick() {
        stepSlides()
        if let g = motionGravity {
            scene.physicsWorld.gravity = SCNVector3(g.x, g.y, g.z)
        } else if scene.physicsWorld.gravity.y != -Self.gravity || scene.physicsWorld.gravity.x != 0 {
            scene.physicsWorld.gravity = SCNVector3(0, -Self.gravity, 0)
        }
        if simd_length(motionPush) > 0.01 {
            let push = motionPush
            for roll in rolls where roll.local && !roll.done {
                for die in roll.dice { die.node.physicsBody?.applyForce(SCNVector3(push.x, push.y, push.z), asImpulse: true) }
            }
            motionPush = .zero
        }
        for roll in rolls where !roll.done {
            if !roll.local { land(roll, force: false) }
            let still = roll.dice.allSatisfy { die in
                guard let body = die.node.physicsBody else { return true }
                if body.isResting { return true }
                let speed = simd_length(SIMD3<Float>(body.velocity.x, body.velocity.y, body.velocity.z))
                return speed < 0.08 && abs(body.angularVelocity.w) < 0.08
            }
            roll.quietFrames = still && (!roll.holdUntilStill || phoneStill) ? roll.quietFrames + 1 : 0
            let timedOut = Date().timeIntervalSince(roll.started) > (roll.holdUntilStill ? 60 : 9)
            if roll.quietFrames < 24 && !timedOut { continue }
            if roll.local && !timedOut && roll.nudges < 4 {
                // A die leaning on another or on a wall: give it a nudge.
                let cocked = roll.dice.filter { !DiceGeometry.top($0.kind, rotation: rotation($0.node)).flat }
                if !cocked.isEmpty {
                    roll.nudges += 1
                    roll.quietFrames = 0
                    for die in cocked {
                        die.node.physicsBody?.velocity = SCNVector3(Float.random(in: -1.5...1.5), 6, Float.random(in: -1.5...1.5))
                        die.node.physicsBody?.angularVelocity = SCNVector4(Float.random(in: -1...1), Float.random(in: -1...1), Float.random(in: -1...1), 10)
                    }
                    continue
                }
            }
            roll.done = true
            let result: [Int]?
            if roll.local {
                result = roll.dice.map { die in die.values[DiceGeometry.top(die.kind, rotation: rotation(die.node)).index] }
            } else {
                land(roll, force: true)
                result = roll.target
            }
            roll.onDone?(result)
        }
    }

    func physicsWorld(_ world: SCNPhysicsWorld, didBegin contact: SCNPhysicsContact) {
        let impulse = Double(contact.collisionImpulse)
        guard impulse > 2.5 else { return }
        let volume = self.volume
        DispatchQueue.main.async {
            MainActor.assumeIsolated { DiceClack.shared.play(strength: impulse, volume: volume) }
        }
    }
}

// MARK: - The tray's state

@MainActor
final class DiceTray: ObservableObject {
    /// The same sixteen colours as the Mac. In a Live Session no two people share one.
    static let colors: [(String, String)] = [
        ("Ruby", "#b3261e"), ("Sapphire", "#2a5bd7"), ("Jade", "#1f8a5b"), ("Amethyst", "#7b3fbf"),
        ("Amber", "#c47a12"), ("Onyx", "#1d1d24"), ("Ivory", "#e8e2d0"), ("Teal", "#0f8a8a"),
        ("Rose", "#d6457a"), ("Lime", "#7cb518"), ("Tangerine", "#e3611c"), ("Sky", "#4fb3e8"),
        ("Gold", "#d4a017"), ("Plum", "#5b2a6e"), ("Silver", "#9aa3ad"), ("Bronze", "#8a5a2b"),
    ]

    struct ColorClaim: Equatable {
        let peer: String
        let name: String
        let color: String
    }

    /// In a Live Session: who has which colour, and which entry is this device.
    /// nil when not in a session.
    @Published private(set) var sessionColors: [ColorClaim]?
    private var myPeer = ""
    /// Bumped when someone tries to roll without a colour, to point at the swatches.
    @Published private(set) var needColor = 0
    /// Asks the session for a colour.
    var onClaim: ((String) -> Void)?

    /// This device's dice colour: chosen freely alone, claimed in a session.
    var currentColor: String? {
        guard let claims = sessionColors else { return color }
        return claims.first { $0.peer == myPeer }?.color
    }

    /// Whose colour this is, if someone else in the session has it.
    func takenBy(_ hex: String) -> ColorClaim? {
        sessionColors?.first { $0.color == hex && $0.peer != myPeer }
    }

    /// The colour list from the session (or nil when it ends). If you haven't a
    /// colour yet, ask for the one you used last, if it's free.
    func setSessionColors(_ list: [Any]?, you: String) {
        let was = sessionColors != nil
        guard let list else {
            sessionColors = nil
            sharedCustom = []
            hiddenArmed = false
            return
        }
        sessionColors = list.compactMap { item in
            guard let json = item as? LiveJSON, let peer = LiveNet.string(json["peer"]), let color = LiveNet.string(json["color"]) else { return nil }
            return ColorClaim(peer: peer, name: LiveNet.string(json["name"]) ?? "Someone", color: color)
        }
        myPeer = you
        if !was && currentColor == nil && takenBy(color) == nil { claim(color) }
    }

    func claim(_ hex: String) {
        color = hex
        if sessionColors != nil { onClaim?(hex) }
    }

    @Published var counts: [String: Int] { didSet { save() } }
    @Published var modifier: Int { didSet { save() } }
    @Published var color: String { didSet { save() } }
    @Published var shakeToRoll: Bool { didSet { save(); updateMotion() } }
    /// The tray is open (full screen with controls).
    @Published var isOpen = false { didSet { updateMotion(); updateTicker() } }
    /// Someone else's roll is showing over the screen, with the tray closed.
    @Published var watching = false { didSet { updateTicker() } }
    @Published private(set) var banner: RollEntry?
    @Published private(set) var log: [RollEntry] = []
    /// Which side panel is open: "log", "stats", "custom", or the broadcaster's
    /// "ask", "initiative" and "contest".
    @Published var panel: String?
    /// Your own custom dice (the broadcaster's are shared with listeners).
    @Published var customDice: [CustomDie] { didSet { save() } }
    /// The broadcaster's custom dice, in a session.
    @Published private(set) var sharedCustom: [CustomDie] = []
    @Published var initiativeModifier: Int { didSet { save() } }
    /// Hidden: the broadcaster's next roll shows everyone the dice but not the numbers.
    @Published var hiddenArmed = false
    /// The end-of-session recap is showing.
    @Published var showRecap = false
    /// The broadcaster's table: roll requests, initiative, who goes first.
    let table = DiceTable()
    var hosting: () -> Bool = { false }
    /// The broadcaster's custom dice changed: share them with listeners.
    var onShareCustom: (([CustomDie]) -> Void)?
    private var resultHooks: [(RollOutcome) -> Void] = []
    private var naturalHooks: [(Int, RollStart) -> Void] = []

    let scene = DiceScene()
    /// In a Live Session: send a roll's start and result to everyone.
    var onStart: ((RollStart) -> Void)?
    var onResult: ((String, [Int]) -> Void)?
    var myName: () -> String = { "You" }
    var volume: () -> Double = { 1 }

    private var mine: Set<String> = []
    private var remote: [String: (start: RollStart, values: [Int]?, finished: Bool)] = [:]
    private var watchTask: Task<Void, Never>?
    private let motion = CMMotionManager()
    private var ticker: Timer?
    private var lastShake = Date.distantPast
    private var shakeRoll: String?

    var canShake: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    init() {
        let defaults = UserDefaults.standard
        counts = (defaults.dictionary(forKey: "dice.counts") as? [String: Int]) ?? ["d20": 1]
        modifier = defaults.integer(forKey: "dice.modifier")
        color = defaults.string(forKey: "dice.color") ?? DiceTray.colors[0].1
        shakeToRoll = defaults.bool(forKey: "dice.shake")
        customDice = (defaults.data(forKey: "dice.custom").flatMap { try? JSONDecoder().decode([CustomDie].self, from: $0) }) ?? []
        initiativeModifier = defaults.integer(forKey: "dice.initiative")
        table.tray = self
        addResultHook { [weak self] outcome in self?.table.collect(outcome) }
    }

    private func save() {
        let defaults = UserDefaults.standard
        defaults.set(counts, forKey: "dice.counts")
        defaults.set(modifier, forKey: "dice.modifier")
        defaults.set(color, forKey: "dice.color")
        defaults.set(shakeToRoll, forKey: "dice.shake")
        if let data = try? JSONEncoder().encode(customDice) { defaults.set(data, forKey: "dice.custom") }
        defaults.set(initiativeModifier, forKey: "dice.initiative")
    }

    // MARK: Custom dice

    /// Your own custom dice, the broadcaster's (in a session), then the ready-made ones.
    var allCustom: [CustomDie] {
        var seen: Set<String> = []
        return (customDice + sharedCustom + DiceGeometry.presets).filter { seen.insert($0.id).inserted }
    }

    func setSharedCustom(_ list: [Any]) {
        sharedCustom = list.compactMap(CustomDie.clean)
    }

    func saveCustom(_ die: CustomDie) {
        if let i = customDice.firstIndex(where: { $0.id == die.id }) { customDice[i] = die } else { customDice.append(die) }
        shareCustom()
    }

    func deleteCustom(_ id: String) {
        customDice.removeAll { $0.id == id }
        counts["custom:\(id)"] = nil
        shareCustom()
    }

    /// The broadcaster's custom dice go to listeners so they can roll them too.
    func shareCustom() {
        if hosting() { onShareCustom?(customDice) }
    }

    // MARK: Watching rolls

    /// Every finished roll (yours and others').
    func addResultHook(_ hook: @escaping (RollOutcome) -> Void) { resultHooks.append(hook) }
    /// A natural 20 or 1 that counts.
    func addNaturalHook(_ hook: @escaping (Int, RollStart) -> Void) { naturalHooks.append(hook) }

    private func finished(_ outcome: RollOutcome) {
        for hook in resultHooks { hook(outcome) }
    }

    /// Everyone's numbers: rolls, d20 average, natural 20s and 1s, luckiest and unluckiest.
    /// Hidden rolls only count on the broadcaster's own device.
    var stats: (people: [DiceGeometry.PersonStats], luckiest: String?, unluckiest: String?) {
        DiceGeometry.stats(log.map { (by: $0.by, d20s: $0.d20s, nat20: $0.nat20, nat1: $0.nat1) })
    }

    /// The end-of-session recap, if anyone rolled.
    func recap() {
        if !log.isEmpty { showRecap = true }
    }

    func open() {
        watchTask?.cancel()
        watching = false
        isOpen = true
    }

    func close() {
        isOpen = false
        banner = nil
        scene.clear()
    }

    private func newId() -> String {
        "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6))".lowercased()
    }

    // MARK: Rolling

    /// How each die of a roll looks: a custom die's words, or (someone else's
    /// hidden roll) no numbers at all.
    private func looks(_ start: RollStart, blank: Bool) -> [DieLook] {
        var looks = start.kinds.map { _ in DieLook(blank: blank) }
        if blank { return looks }
        let defs = Dictionary(start.custom.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for g in start.groups where g.type == "custom" {
            guard let def = g.die.flatMap({ defs[$0] }) else { continue }
            for i in g.dice where i < looks.count { looks[i] = DieLook(custom: def) }
        }
        return looks
    }

    /// Rolls the chosen dice (or 2d20 for advantage / disadvantage), harder with
    /// strength (1–3). `options` override the tray's own (a roll request, an enemy).
    /// Returns the roll's id, or nil if nothing rolled.
    @discardableResult
    func roll(_ mode: RollMode = .normal, strength: Double = 1, fromShake: Bool = false, options: RollOptions = RollOptions()) -> String? {
        let plan = DiceGeometry.plan(options.counts ?? counts, mode: mode, customs: allCustom)
        guard !plan.kinds.isEmpty else { return nil }
        guard let color = currentColor else {
            // Everyone needs their own colour, so the table can tell whose dice are whose.
            if !isOpen { open() }
            needColor += 1
            return nil
        }
        // Like Whisper and Emphasis, hidden is for the next roll only.
        let hidden = options.hidden ?? (hiddenArmed && hosting())
        if options.hidden == nil { hiddenArmed = false }
        let id = newId()
        mine.insert(id)
        var start = RollStart(id: id, by: options.by ?? myName(), mode: mode, modifier: options.modifier ?? modifier, groups: plan.groups,
                              kinds: plan.kinds, color: color, dice: plan.kinds.map { ThrowSpec.random(strength: strength, kind: $0) })
        start.custom = plan.custom
        start.ask = options.ask
        start.hidden = hidden
        if options.overlay && !isOpen {
            watchTask?.cancel()
            watching = true
        } else if !isOpen {
            open()
        }
        banner = nil
        scene.volume = volume()
        if fromShake { shakeRoll = id }
        scene.throwDice(id: id, owner: options.owner ?? options.by ?? "me", kinds: start.kinds, specs: start.dice, color: color, local: true,
                        looks: looks(start, blank: false), holdUntilStill: fromShake) { [weak self] values in
            guard let self, let values else { return }
            if self.shakeRoll == id { self.shakeRoll = nil }
            let summary = start.summarize(values)
            let entry = RollEntry(id: id, start: start, values: values, summary: summary, mine: true)
            self.dimDropped(id: id, start: start, summary: summary)
            self.add(entry)
            self.reveal(id: id, start: start, summary: summary, entry: entry)
            self.onResult?(id, values)
            self.finished(RollOutcome(id: id, start: start, values: values, summary: summary, entry: entry))
            self.endWatch(after: 4.5)
        }
        onStart?(start)
        return id
    }

    /// Where things sit on screen that dice shouldn't hide under (the banner, the
    /// controls, the top bar, a side panel), and the dice stage, in global points.
    var covers: [String: CGRect] = [:]
    var stageFrame: CGRect = .zero

    /// Shows a result: the banner, then any dice it (or the controls) would cover
    /// slide into view, then the natural 20 / 1 effects over where they end up.
    private func reveal(id: String, start: RollStart, summary: RollSummary, entry: RollEntry) {
        banner = entry
        Task { @MainActor [weak self] in
            // Once the banner has been laid out and measured.
            try? await Task.sleep(nanoseconds: 80_000_000)
            guard let self else { return }
            let stage = self.stageFrame
            guard stage.width > 0, stage.height > 0 else {
                self.celebrate(id: id, start: start, summary: summary)
                return
            }
            // In the tray: its banner, controls, top bar and panel. Over the screen
            // (someone's roll, or yours from a request card): the banner, the
            // stage's own buttons and the request and result cards.
            let keys = self.isOpen ? ["banner", "controls", "top", "panel"]
                : ["banner", "stageTop", "stageBottom"] + self.covers.keys.filter { $0.hasPrefix("card-") }
            let rects = keys.compactMap { self.covers[$0] }.map { r in
                CGRect(x: (r.minX - stage.minX - 8) / stage.width, y: (r.minY - stage.minY - 8) / stage.height,
                       width: (r.width + 16) / stage.width, height: (r.height + 16) / stage.height)
            }
            self.scene.clearOf(rects) { [weak self] in self?.celebrate(id: id, start: start, summary: summary) }
        }
    }

    private func dimDropped(id: String, start: RollStart, summary: RollSummary) {
        guard let kept = summary.kept, let keptIndex = summary.scores.firstIndex(of: kept) else { return }
        for (i, group) in start.groups.enumerated() where i != keptIndex {
            if let die = group.dice.first { scene.dim(id: id, die: die) }
        }
    }

    /// A skull over a natural 1, fireworks over a natural 20: the d20s that count
    /// (all of them, or the kept one with advantage or disadvantage).
    private func celebrate(id: String, start: RollStart, summary: RollSummary) {
        let keptIndex = summary.kept.flatMap { summary.scores.firstIndex(of: $0) }
        for (i, group) in start.groups.enumerated() where group.type == "d20" {
            if let keptIndex, keptIndex != i { continue }
            let score = summary.scores[i]
            if (score == 1 || score == 20), let die = group.dice.first {
                scene.celebrate(id: id, die: die, natural: score)
                if !start.hidden { for hook in naturalHooks { hook(score, start) } }
            }
        }
    }

    private func add(_ entry: RollEntry) {
        guard !log.contains(where: { $0.id == entry.id }) else { return }
        log.insert(entry, at: 0)
        if log.count > 100 { log.removeLast() }
    }

    // MARK: Rolls from the Live Session

    func remoteStart(_ json: LiveJSON) {
        guard let start = RollStart(json: json), !mine.contains(start.id), remote[start.id] == nil,
              !log.contains(where: { $0.id == start.id }) else { return }
        remote[start.id] = (start, nil, false)
        if !isOpen {
            watchTask?.cancel()
            watching = true
        }
        scene.volume = volume()
        // The broadcaster's hidden roll: you see the dice, never the numbers.
        scene.throwDice(id: start.id, owner: start.by, kinds: start.kinds, specs: start.dice, color: start.color, local: false,
                        looks: looks(start, blank: start.hidden)) { [weak self] values in
            guard let self else { return }
            if start.hidden {
                self.endWatch(after: 1.5)
                return
            }
            guard let values else { return }
            self.finishRemote(start.id, values: values)
        }
    }

    /// Someone else's roll over the screen fades away after a moment.
    private func endWatch(after seconds: Double) {
        guard watching else { return }
        watchTask?.cancel()
        watchTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard let self, !Task.isCancelled, self.watching else { return }
            self.watching = false
            self.banner = nil
            self.scene.clear()
        }
    }

    func remoteResult(_ json: LiveJSON) {
        guard let id = LiveNet.string(json["id"]), remote[id] != nil else { return }
        let values = ((json["values"] as? [Any]) ?? []).compactMap { LiveNet.number($0).map(Int.init) }
        remote[id]?.values = values
        scene.setTarget(id: id, values: values)
        // The dice may already have stopped: finish now.
        if scene.isDone(id) { finishRemote(id, values: values) }
    }

    private func finishRemote(_ id: String, values: [Int]) {
        guard let entry = remote[id], !entry.finished else { return }
        remote[id]?.finished = true
        let start = entry.start
        let summary = start.summarize(values)
        let row = RollEntry(id: id, start: start, values: values, summary: summary, mine: false)
        dimDropped(id: id, start: start, summary: summary)
        add(row)
        reveal(id: id, start: start, summary: summary, entry: row)
        endWatch(after: 4.5)
        finished(RollOutcome(id: id, start: start, values: values, summary: summary, entry: row))
    }

    /// Rolls that happened before this device joined (no dice, just the log).
    func setHistory(_ list: [Any]) {
        for item in list {
            guard let json = item as? LiveJSON, let id = LiveNet.string(json["id"]), !log.contains(where: { $0.id == id }) else { continue }
            let values = ((json["values"] as? [Any]) ?? []).compactMap { LiveNet.number($0).map(Int.init) }
            var start = RollStart(id: id, by: LiveNet.string(json["by"]) ?? "Someone",
                                  mode: RollMode(rawValue: LiveNet.string(json["mode"]) ?? "") ?? .normal,
                                  modifier: Int(LiveNet.number(json["modifier"]) ?? 0), groups: RollStart.groups(json["groups"]),
                                  kinds: [], color: "", dice: [])
            start.custom = RollStart.customs(json["custom"])
            start.ask = LiveNet.string(json["ask"])
            var entry = RollEntry(id: id, start: start, values: values, summary: start.summarize(values), mine: false)
            entry.at = Date(timeIntervalSince1970: (LiveNet.number(json["at"]) ?? LiveNet.now) / 1000)
            log.append(entry)
        }
        log.sort { $0.at > $1.at }
    }

    func resetLog() {
        log = []
        remote = [:]
    }

    /// Watches the dice sixty times a second while they're on screen.
    private func updateTicker() {
        let on = isOpen || watching
        if on && ticker == nil {
            let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.scene.tick() }
            }
            RunLoop.main.add(timer, forMode: .common)
            ticker = timer
        } else if !on {
            ticker?.invalidate()
            ticker = nil
        }
    }

    // MARK: Shake to roll (iPhone)

    private func updateMotion() {
        let on = isOpen && shakeToRoll && canShake && motion.isDeviceMotionAvailable
        if on && !motion.isDeviceMotionActive {
            motion.deviceMotionUpdateInterval = 1.0 / 60
            motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
                guard let data else { return }
                MainActor.assumeIsolated { self?.handle(data) }
            }
        } else if !on && motion.isDeviceMotionActive {
            motion.stopDeviceMotionUpdates()
            scene.motionGravity = nil
            scene.phoneStill = true
        }
    }

    /// The phone's axes as the screen's: right, up and out of the screen.
    private func screenAxes(_ v: CMAcceleration) -> SIMD3<Float> {
        let orientation = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.interfaceOrientation ?? .portrait
        let x = Float(v.x)
        let y = Float(v.y)
        let z = Float(v.z)
        switch orientation {
        case .portraitUpsideDown: return SIMD3(-x, -y, z)
        case .landscapeRight: return SIMD3(-y, x, z)
        case .landscapeLeft: return SIMD3(y, -x, z)
        default: return SIMD3(x, y, z)
        }
    }

    /// The dice follow the phone: tilting it tips them, shaking it throws them
    /// about. When it's been still for a moment and they've settled, that's the roll.
    private func handle(_ data: CMDeviceMotion) {
        // Screen right → scene +x, screen up → scene −z, out of the screen → scene +y.
        let g = screenAxes(data.gravity)
        scene.motionGravity = SIMD3(g.x, g.z, -g.y) * DiceScene.gravity
        let a = screenAxes(data.userAcceleration)
        let shaking = simd_length(a) > 1.1
        if simd_length(a) > 0.25 {
            // The dice lag behind the phone's movement.
            scene.motionPush = scene.motionPush + SIMD3(-a.x, max(0, -a.z), a.y) * 1.6
        }
        if shaking {
            lastShake = Date()
            if shakeRoll == nil { roll(.normal, strength: 1.5, fromShake: true) }
        }
        scene.phoneStill = Date().timeIntervalSince(lastShake) > 0.6
    }
}

// MARK: - Views

/// The SceneKit view showing the tray's scene, see-through.
struct DiceSceneView: UIViewRepresentable {
    let tray: DiceTray

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.backgroundColor = .clear
        view.antialiasingMode = .multisampling4X
        view.rendersContinuously = true
        view.preferredFramesPerSecond = 60
        view.isUserInteractionEnabled = false
        view.scene = tray.scene.scene
        view.pointOfView = tray.scene.scene.rootNode.childNodes.first { $0.camera != nil }
        view.isPlaying = true
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        if view.scene !== tray.scene.scene { view.scene = tray.scene.scene }
        let size = view.bounds.size
        if size.width > 0, size.height > 0 { tray.scene.layout(aspect: Float(size.width / size.height)) }
    }

    static func dismantleUIView(_ view: SCNView, coordinator: ()) {
        view.isPlaying = false
        view.scene = nil
    }
}

/// Keeps the walls at the edges of the screen when it rotates or resizes.
private struct DiceStage: View {
    @ObservedObject var tray: DiceTray

    var body: some View {
        GeometryReader { geo in
            DiceSceneView(tray: tray)
                .onAppear { tray.scene.layout(aspect: Float(geo.size.width / max(1, geo.size.height))) }
                .onChange(of: geo.size) { _, size in tray.scene.layout(aspect: Float(size.width / max(1, size.height))) }
        }
        .ignoresSafeArea()
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { tray.stageFrame = $0 }
    }
}

extension View {
    /// Tells the tray where this sits on screen, so landed dice slide out from under it.
    func diceCover(_ tray: DiceTray, _ key: String) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { tray.covers[key] = $0 }
            .onDisappear { tray.covers[key] = nil }
    }
}

/// The result: who rolled, what, and the total.
struct DiceBanner: View {
    let entry: RollEntry

    var body: some View {
        VStack(spacing: 2) {
            Text("🎲 \(entry.by.uppercased())\(entry.hidden ? " · HIDDEN" : "")")
                .font(.caption.weight(.bold))
                .tracking(1)
                .opacity(0.8)
            Text(entry.title).font(.footnote).opacity(0.85)
            if let total = entry.total {
                Text("\(total)").font(.system(size: 44, weight: .black, design: .rounded))
                Text(entry.detail).font(.footnote.monospacedDigit()).opacity(0.85)
            } else {
                // Words (a coin, custom dice).
                Text(entry.detail).font(.system(size: 26, weight: .black, design: .rounded)).multilineTextAlignment(.center).padding(.vertical, 4)
            }
        }
        .foregroundStyle(Color.white)
        .padding(.horizontal, 22)
        .padding(.vertical, 12)
        .background(Color(red: 0.04, green: 0.04, blue: 0.06).opacity(0.75), in: RoundedRectangle(cornerRadius: 18))
        .shadow(color: .black.opacity(0.4), radius: 14, y: 6)
        .transition(.scale(scale: 0.8).combined(with: .opacity))
        .allowsHitTesting(false)
    }
}

/// Someone else's roll over whatever is on screen.
struct DiceWatchOverlay: View {
    @ObservedObject var tray: DiceTray

    var body: some View {
        if tray.watching && !tray.isOpen {
            ZStack(alignment: .top) {
                DiceStage(tray: tray)
                if let banner = tray.banner {
                    DiceBanner(entry: banner).diceCover(tray, "banner").padding(.top, 70)
                }
            }
            .allowsHitTesting(false)
            .transition(.opacity)
        }
    }
}

/// The dice tray: full screen, with the controls and the roll log.
struct DiceView: View {
    @ObservedObject var tray: DiceTray
    @Environment(\.appTheme) private var theme
    @State private var charging: Date?
    @State private var charge: Double = 0
    @State private var pulse = false
    @State private var showColors = false

    var body: some View {
        ZStack {
            backdrop
            DiceStage(tray: tray)
            VStack(spacing: 0) {
                topBar.diceCover(tray, "top")
                // The turn order, between the top bar and the result.
                TurnStripSlot(table: tray.table)
                if let banner = tray.banner {
                    DiceBanner(entry: banner).diceCover(tray, "banner").padding(.top, 8)
                }
                Spacer()
                controls.diceCover(tray, "controls")
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
            if tray.panel != nil { sidePanel }
            TableOverlay(table: tray.table, showStrip: false)
            if tray.showRecap { DiceRecap(tray: tray) }
        }
        .animation(.easeOut(duration: 0.25), value: tray.banner)
        .statusBarHidden(false)
    }

    @ViewBuilder
    private var backdrop: some View {
        if theme.hasBackdrop {
            Color.black.themedBackground(theme, page: nil).ignoresSafeArea()
        } else {
            RadialGradient(colors: [Color(hex: 0x1F5A3D), Color(hex: 0x0D2A1C)], center: .center, startRadius: 20, endRadius: 700)
                .ignoresSafeArea()
        }
    }

    @Environment(\.horizontalSizeClass) private var sizeClass

    private var topBar: some View {
        Group {
            if sizeClass == .compact {
                // iPhone: every button on show, in rows, rather than scrolling out of sight.
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        colorButton
                        Spacer()
                        pill("Close") { tray.close() }
                    }
                    if tray.hosting() { tableTools.frame(maxWidth: .infinity) }
                    HStack(spacing: 8) { everydayPills }
                }
            } else {
                HStack(spacing: 10) {
                    Text("Dice").font(.title3.weight(.heavy)).foregroundStyle(Color.white).shadow(radius: 3)
                    colorButton
                    Spacer(minLength: 4)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            if tray.hosting() { tableTools }
                            everydayPills
                            pill("Close") { tray.close() }
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(-1)
                }
            }
        }
        .padding(.top, 6)
    }

    /// The broadcaster's table tools (roll requests, initiative, who wins), grouped.
    private var tableTools: some View {
        HStack(spacing: 6) {
            panelPill("Ask a roll", "ask")
            panelPill("Initiative", "initiative")
            panelPill("Who wins?", "contest")
        }
        .padding(3)
        .background(Color(hex: 0xFFD27A).opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(Color(hex: 0xFFD27A).opacity(0.35)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Table")
    }

    @ViewBuilder
    private var everydayPills: some View {
        panelPill("Custom dice", "custom")
        panelPill("Stats", "stats")
        panelPill(tray.log.isEmpty ? "Log" : "Log · \(tray.log.count)", "log")
    }

    private func panelPill(_ title: String, _ name: String) -> some View {
        TablePill(title: title, on: tray.panel == name) {
            withAnimation(.easeOut(duration: 0.2)) { tray.panel = tray.panel == name ? nil : name }
        }
    }

    /// One swatch with your colour; tap it to choose from all of them.
    private var colorButton: some View {
        let current = tray.currentColor
        let name = DiceTray.colors.first { $0.1 == current }?.0
        return Button {
            showColors.toggle()
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(current.flatMap { Color(hexString: $0) } ?? Color.clear)
                    .frame(width: 22, height: 22)
                    .overlay(Circle().strokeBorder(Color.white, style: StrokeStyle(lineWidth: 2, dash: current == nil ? [3, 3] : [])))
                Text(name ?? "Pick your dice colour").font(.callout.weight(.semibold))
                Image(systemName: "chevron.down").font(.caption2.weight(.bold)).opacity(0.7)
            }
            .foregroundStyle(Color.white)
            .padding(.leading, 6)
            .padding(.trailing, 12)
            .padding(.vertical, 5)
            .background(Color.black.opacity(0.45), in: Capsule())
            .overlay(Capsule().strokeBorder(pulse ? Color(hex: 0xFFD27A) : Color.white.opacity(0.2), lineWidth: pulse ? 2 : 1))
        }
        .buttonStyle(.plain)
        .scaleEffect(pulse ? 1.08 : 1)
        .animation(.easeInOut(duration: 0.2).repeatCount(3, autoreverses: true), value: pulse)
        .accessibilityLabel(name.map { "Your dice: \($0). Change colour" } ?? "Pick your dice colour")
        .popover(isPresented: $showColors) {
            colorPicker.presentationCompactAdaptation(.popover)
        }
        .onChange(of: tray.needColor) { _, _ in
            showColors = true
            pulse = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                pulse = false
            }
        }
    }

    private var colorPicker: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(30), spacing: 10), count: 8), spacing: 10) {
            ForEach(DiceTray.colors, id: \.1) { item in
                let owner = tray.takenBy(item.1)
                Button {
                    tray.claim(item.1)
                    showColors = false
                } label: {
                    Circle()
                        .fill(Color(hexString: item.1) ?? .red)
                        .frame(width: 30, height: 30)
                        .overlay(Circle().strokeBorder(Color.primary, lineWidth: tray.currentColor == item.1 ? 3 : 0))
                        .overlay {
                            if owner != nil {
                                Image(systemName: "xmark").font(.caption.weight(.heavy)).foregroundStyle(Color.white)
                            }
                        }
                        .opacity(owner == nil ? 1 : 0.35)
                }
                .buttonStyle(.plain)
                .disabled(owner != nil)
                .accessibilityLabel(owner.map { "\(item.0): \($0.name)'s dice" } ?? "\(item.0) dice")
            }
        }
        .padding(16)
    }

    private func pill(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.callout.weight(.semibold))
                .foregroundStyle(Color.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Color.black.opacity(0.45), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.2)))
        }
        .buttonStyle(.plain)
    }

    private var controls: some View {
        VStack(spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(DiceGeometry.types, id: \.self) { type in dieButton(type, label: type == "coin" ? "Coin" : type) }
                    // Custom dice in the roll, with their counts.
                    ForEach(tray.allCustom.filter { (tray.counts["custom:\($0.id)"] ?? 0) > 0 }) { def in
                        dieButton("custom:\(def.id)", label: def.name)
                    }
                    pill("Clear") { tray.counts = [:] }
                }
                .padding(.top, 8)
                .padding(.horizontal, 4)
            }
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    pill("−") { tray.modifier = max(-30, tray.modifier - 1) }
                    Text(tray.modifier > 0 ? "+\(tray.modifier)" : "\(tray.modifier)")
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(Color.white)
                        .frame(minWidth: 34)
                        .accessibilityLabel("Modifier \(tray.modifier)")
                    pill("+") { tray.modifier = min(30, tray.modifier + 1) }
                }
                Button { tray.roll(.adv) } label: {
                    Text("A").font(.headline.weight(.black)).foregroundStyle(Color.white)
                        .frame(width: 46, height: 42)
                        .background(Color(hex: 0x1F9D55), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Advantage: roll two d20s and keep the higher")
                Button { tray.roll(.dis) } label: {
                    Text("DA").font(.headline.weight(.black)).foregroundStyle(Color.white)
                        .frame(width: 46, height: 42)
                        .background(Color(hex: 0xC62828), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Disadvantage: roll two d20s and keep the lower")
                if tray.hosting() {
                    // Like Whisper and Emphasis: for the next roll only.
                    Button { tray.hiddenArmed.toggle() } label: {
                        Text(tray.hiddenArmed ? "🙈 Hidden" : "🙈 Hide").font(.headline.weight(.heavy)).foregroundStyle(Color.white)
                            .padding(.horizontal, 10)
                            .frame(minWidth: 46, minHeight: 42)
                            .background(tray.hiddenArmed ? Color(hex: 0x5B3FA0) : Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(tray.hiddenArmed ? Color(hex: 0xB9A2FF) : Color.white.opacity(0.25)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Hidden roll")
                    .accessibilityHint("Listeners see your next roll's dice but not the numbers")
                    .accessibilityAddTraits(tray.hiddenArmed ? .isSelected : [])
                }
                rollButton
            }
            if tray.canShake {
                Toggle(isOn: $tray.shakeToRoll) {
                    Label("Shake to roll", systemImage: "iphone.radiowaves.left.and.right")
                        .foregroundStyle(Color.white)
                }
                .tint(Color(hex: 0x1F9D55))
                .padding(.horizontal, 6)
            }
        }
        .padding(12)
        .background(.ultraThinMaterial.opacity(0.9), in: RoundedRectangle(cornerRadius: 18))
        .environment(\.colorScheme, .dark)
    }

    private func dieButton(_ type: String, label: String) -> some View {
        let count = tray.counts[type] ?? 0
        return Button {
            tray.counts[type] = min(10, count + 1)
        } label: {
            Text(label)
                .font(.callout.weight(.bold))
                .foregroundStyle(Color.white)
                .frame(minWidth: 50)
                .padding(.vertical, 9)
                .background(count > 0 ? Color.accentColor.opacity(0.55) : Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(count > 0 ? Color.accentColor : Color.white.opacity(0.2)))
                .overlay(alignment: .topTrailing) {
                    if count > 0 {
                        Text("\(count)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Color.black)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Color.white, in: Capsule())
                            .offset(x: 6, y: -7)
                    }
                }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Remove one") { tray.counts[type] = max(0, count - 1) }
            Button("Remove all") { tray.counts[type] = 0 }
        }
        .accessibilityLabel("\(label), \(count) chosen")
        .accessibilityHint("Tap to add one. Touch and hold to remove.")
    }

    /// Tap to roll; hold to throw harder (strength grows over a second and a half).
    private var rollButton: some View {
        let empty = DiceGeometry.plan(tray.counts, customs: tray.allCustom).kinds.isEmpty
        let what = DiceGeometry.describe(tray.counts, modifier: tray.modifier, customs: tray.allCustom)
        return Text("Roll \(what)")
            .font(.headline.weight(.heavy))
            .foregroundStyle(Color.white)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal, 10)
            .background(alignment: .leading) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Color.accentColor
                        Color.white.opacity(0.35).frame(width: geo.size.width * charge)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .opacity(empty ? 0.45 : 1)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !empty, charging == nil else { return }
                        charging = Date()
                        Task { @MainActor in
                            while let started = charging {
                                charge = min(1, Date().timeIntervalSince(started) / 1.5)
                                try? await Task.sleep(nanoseconds: 16_000_000)
                            }
                        }
                    }
                    .onEnded { _ in
                        guard let started = charging else { return }
                        let f = min(1, Date().timeIntervalSince(started) / 1.5)
                        charging = nil
                        charge = 0
                        tray.roll(.normal, strength: 1 + 2 * f)
                    }
            )
            .accessibilityElement()
            .accessibilityLabel("Roll \(what)")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { tray.roll() }
    }

    /// The side panel: the roll log, statistics, custom dice, or the broadcaster's table.
    private var sidePanel: some View {
        HStack {
            Spacer()
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    switch tray.panel ?? "log" {
                    case "stats": DiceStatsView(tray: tray, title: "Statistics")
                    case "custom": CustomDicePanel(tray: tray)
                    case "ask": AskPanel(table: tray.table)
                    case "initiative": InitiativePanel(table: tray.table)
                    case "contest": ContestPanel(table: tray.table)
                    default: logList
                    }
                }
                .padding(12)
            }
            .foregroundStyle(Color.white)
            // On an iPhone it takes the screen's width, less a margin.
            .frame(width: min(tray.panel == "log" || tray.panel == "stats" ? 290 : 340, UIScreen.main.bounds.width - 24))
            .frame(maxHeight: 560)
            .fixedSize(horizontal: false, vertical: true)
            .background(Color.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 16))
            // Just the panel itself, not the space around it.
            .diceCover(tray, "panel")
            .environment(\.colorScheme, .dark)
            .padding(.trailing, 12)
            .padding(.top, sizeClass == .compact ? 130 : 60)
            // Clear of the dice controls at the bottom.
            .padding(.bottom, 180)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .transition(.move(edge: .trailing).combined(with: .opacity))
    }

    @ViewBuilder
    private var logList: some View {
        Text("Roll log").font(.headline)
        if tray.log.isEmpty {
            Text("No rolls yet.").foregroundStyle(Color.white.opacity(0.7))
        }
        ForEach(tray.log) { entry in
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(entry.by + (entry.hidden ? " 🙈" : "")).font(.subheadline.weight(.bold))
                    Spacer()
                    Text(entry.at, style: .time).font(.caption2).opacity(0.6)
                }
                Text(entry.title).font(.caption).opacity(0.8)
                Text(entry.detail).font(.subheadline.weight(.bold).monospacedDigit())
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(entry.mine ? Color.accentColor.opacity(0.3) : Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

/// Everyone's rolls: how many, the d20 average, natural 20s and 1s, and the
/// luckiest and unluckiest of the night.
struct DiceStatsView: View {
    @ObservedObject var tray: DiceTray
    var title: String?

    var body: some View {
        let stats = tray.stats
        VStack(alignment: .leading, spacing: 8) {
            if let title { Text(title).font(.headline) }
            if stats.people.isEmpty {
                Text("No rolls yet.").opacity(0.7)
            } else {
                if let luckiest = stats.luckiest, let unluckiest = stats.unluckiest {
                    Text("🍀 Luckiest: \(luckiest)").font(.subheadline.weight(.bold)).padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(red: 0.18, green: 0.63, blue: 0.26).opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
                    Text("🌧 Unluckiest: \(unluckiest)").font(.subheadline.weight(.bold)).padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(red: 0.35, green: 0.43, blue: 0.63).opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
                }
                Grid(alignment: .trailing, horizontalSpacing: 10, verticalSpacing: 6) {
                    GridRow {
                        Text("").gridColumnAlignment(.leading)
                        Text("ROLLS")
                        Text("D20 AVG")
                        Text("20S")
                        Text("1S")
                    }
                    .font(.caption2.weight(.bold))
                    .opacity(0.7)
                    ForEach(stats.people) { p in
                        GridRow {
                            Text(p.name).font(.subheadline.weight(.bold)).lineLimit(1)
                            Text("\(p.rolls)")
                            Text(p.average.map { String(format: "%g", $0) } ?? "—")
                            Text("\(p.nat20)").foregroundStyle(Color(red: 0.62, green: 0.94, blue: 0.66))
                            Text("\(p.nat1)").foregroundStyle(Color(red: 1, green: 0.62, blue: 0.62))
                        }
                        .font(.subheadline.monospacedDigit())
                    }
                }
            }
        }
        .foregroundStyle(Color.white)
    }
}

/// The end-of-session recap card.
struct DiceRecap: View {
    @ObservedObject var tray: DiceTray

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 12) {
                Text("🎲 Session recap").font(.title2.weight(.black))
                ScrollView { DiceStatsView(tray: tray) }.frame(maxHeight: 420).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Spacer()
                    Button("Done") { tray.showRecap = false }
                        .buttonStyle(.borderedProminent)
                }
            }
            .foregroundStyle(Color.white)
            .padding(20)
            .frame(maxWidth: 440)
            .background(LinearGradient(colors: [Color(hex: 0x1F5A3D), Color(hex: 0x0D2A1C)], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color.white.opacity(0.15)))
            .shadow(color: .black.opacity(0.6), radius: 30, y: 12)
            .padding(16)
        }
        .transition(.opacity)
    }
}

/// Custom dice: yours (to edit), the broadcaster's and the ready-made ones.
struct CustomDicePanel: View {
    @ObservedObject var tray: DiceTray
    @State private var editing: CustomDie?
    @State private var isNew = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Custom dice").font(.headline)
            if let binding = Binding($editing) {
                editor(binding)
            } else {
                TablePill(title: "＋ New custom die") {
                    editing = CustomDie(id: "c-\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))", name: "", sides: 6, faces: Array(repeating: "", count: 6))
                    isNew = true
                }
                section(tray.hosting() ? "Your dice (shared with listeners)" : "Your dice", tray.customDice, own: true)
                section("The broadcaster's dice", tray.sharedCustom.filter { d in !tray.customDice.contains { $0.id == d.id } }, own: false)
                section("Ready-made", DiceGeometry.presets, own: false)
            }
        }
        .foregroundStyle(Color.white)
    }

    @ViewBuilder
    private func section(_ title: String, _ list: [CustomDie], own: Bool) -> some View {
        if !list.isEmpty {
            Text(title.uppercased()).font(.caption2.weight(.heavy)).tracking(0.6).opacity(0.7).padding(.top, 8)
            ForEach(list) { def in
                let count = tray.counts["custom:\(def.id)"] ?? 0
                HStack(spacing: 6) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(def.name) · d\(def.sides)").font(.subheadline.weight(.bold))
                        Text(def.faces.map { $0.isEmpty ? "—" : $0 }.joined(separator: " · ")).font(.caption2).opacity(0.7).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    TablePill(title: count > 0 ? "＋ (\(count))" : "＋", small: true) { tray.counts["custom:\(def.id)"] = min(10, count + 1) }
                        .accessibilityLabel("Add a \(def.name) die to your roll")
                    if own {
                        TablePill(title: "Edit", small: true) {
                            editing = def
                            isNew = false
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func editor(_ die: Binding<CustomDie>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NAME").font(.caption2.weight(.bold)).opacity(0.75)
            TextField("Name, e.g. Dinner", text: die.name).textFieldStyle(.roundedBorder)
            Text("SHAPE").font(.caption2.weight(.bold)).opacity(0.75)
            Picker("Shape", selection: Binding(get: { die.wrappedValue.sides }, set: { sides in
                die.wrappedValue.faces = (0..<sides).map { $0 < die.wrappedValue.faces.count ? die.wrappedValue.faces[$0] : "" }
                die.wrappedValue.sides = sides
            })) {
                ForEach(DiceGeometry.customSides, id: \.self) { Text("d\($0) (\($0) faces)").tag($0) }
            }
            .pickerStyle(.menu)
            Text("FACES").font(.caption2.weight(.bold)).opacity(0.75)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                ForEach(die.wrappedValue.faces.indices, id: \.self) { i in
                    TextField("Face \(i + 1)", text: Binding(get: { i < die.wrappedValue.faces.count ? die.wrappedValue.faces[i] : "" },
                                                            set: { if i < die.wrappedValue.faces.count { die.wrappedValue.faces[i] = String($0.prefix(24)) } }))
                        .textFieldStyle(.roundedBorder)
                }
            }
            HStack(spacing: 8) {
                Button("Save") {
                    var def = die.wrappedValue
                    def.name = String(def.name.trimmingCharacters(in: .whitespaces).prefix(30))
                    if def.name.isEmpty { def.name = "Custom" }
                    if let clean = CustomDie.clean(def.json) { tray.saveCustom(clean) }
                    editing = nil
                }
                .buttonStyle(.borderedProminent)
                TablePill(title: "Cancel") { editing = nil }
                if !isNew {
                    TablePill(title: "Delete", danger: true) {
                        tray.deleteCustom(die.wrappedValue.id)
                        editing = nil
                    }
                }
            }
            .padding(.top, 6)
        }
    }
}

/// Shows the dice tray (full screen) and other people's rolls over the screen.
struct DicePresenter: ViewModifier {
    @ObservedObject var tray: DiceTray
    /// Off where something else covers the screen (the listener's stage shows its own).
    let active: Bool

    func body(content: Content) -> some View {
        content
            .overlay {
                if active { DiceWatchOverlay(tray: tray) }
            }
            .overlay {
                // Roll requests, results and the turn order; the session recap.
                if active {
                    ZStack {
                        TableOverlay(table: tray.table)
                        if tray.showRecap && !tray.isOpen { DiceRecap(tray: tray) }
                    }
                }
            }
            .fullScreenCover(isPresented: Binding(
                get: { active && tray.isOpen },
                set: { if !$0 { tray.close() } }
            )) {
                DiceView(tray: tray)
            }
    }
}
