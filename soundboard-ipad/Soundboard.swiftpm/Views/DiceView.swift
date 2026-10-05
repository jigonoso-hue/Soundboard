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
    static func random(strength: Double) -> ThrowSpec {
        func r(_ a: Double, _ b: Double) -> Double { Double.random(in: a...b) }
        let q = simd_quatd(angle: r(0, .pi * 2), axis: simd_normalize(SIMD3(r(-1, 1), r(-1, 1), r(-1, 1)) + SIMD3(0, 0.001, 0)))
        return ThrowSpec(
            p: [r(-0.7, 0.7), r(0.55, 0.85)],
            h: r(2, 4.5),
            v: [r(-0.5, 0.5) * strength, -r(1.1, 1.7) * strength],
            w: [r(-1, 1) * 14 * strength, r(-1, 1) * 14 * strength, r(-1, 1) * 14 * strength],
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

    var json: LiveJSON {
        [
            "t": "roll", "id": id, "by": by, "mode": mode.rawValue, "modifier": modifier,
            "groups": groups.map { ["type": $0.type, "dice": $0.dice] as LiveJSON },
            "kinds": kinds.map(\.rawValue), "color": color, "dice": dice.map(\.json),
        ]
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
    }

    static func groups(_ value: Any?) -> [RollGroup] {
        ((value as? [Any]) ?? []).compactMap { item in
            guard let g = item as? LiveJSON, let type = LiveNet.string(g["type"]) else { return nil }
            let dice = ((g["dice"] as? [Any]) ?? []).compactMap { LiveNet.number($0).map(Int.init) }
            return dice.isEmpty ? nil : RollGroup(type: type, dice: dice)
        }
    }
}

struct RollEntry: Identifiable, Equatable {
    let id: String
    let by: String
    let title: String
    let detail: String
    let total: Int
    let at: Date
    let mine: Bool
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
            if kind == .d4 {
                for (i, text) in texts.enumerated() where i < uvs.count {
                    let p = at(uvs[i])
                    let point = CGPoint(x: center.x + (p.x - center.x) * 0.56, y: center.y + (p.y - center.y) * 0.56)
                    let angle = atan2(p.x - center.x, center.y - p.y)
                    draw(text, at: point, px: 58, angle: angle, underline: false)
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

    /// The materials for a die with numbers `values` (per face, or per corner on a d4).
    static func materials(_ kind: DieKind, values: [Int], color: String, dimmed: Bool = false) -> [SCNMaterial] {
        let shape = DiceGeometry.build(kind)
        return shape.faces.enumerated().map { index, face in
            let texts = kind == .d4
                ? face.corners.map { String(values[$0]) }
                : [DiceGeometry.label(kind, values[index])]
            let material = SCNMaterial()
            material.diffuse.contents = texture(kind, face: index, texts: texts, color: color)
            material.lightingModel = .physicallyBased
            material.roughness.contents = 0.38
            material.metalness.contents = 0.08
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

        init(kind: DieKind, node: SCNNode, values: [Int], color: String) {
            self.kind = kind
            self.node = node
            self.values = values
            self.color = color
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
        scene.rootNode.addChildNode(ground)
        layout(aspect: 0.6)
    }

    /// The floor's half-width and half-depth visible on screen.
    func extents() -> (hx: Float, hz: Float) {
        let hz = Self.cameraHeight * tan(Float(Self.fov) / 2 * .pi / 180)
        return (hz * aspect, hz)
    }

    /// Fits the walls to the screen.
    func layout(aspect newAspect: Float) {
        if !walls.isEmpty && abs(aspect - max(0.2, newAspect)) < 0.001 { return }
        aspect = max(0.2, newAspect)
        walls.forEach { $0.removeFromParentNode() }
        let (hx, hz) = extents()
        let inset: Float = 1
        func wall(x: Float, z: Float, width: CGFloat, length: CGFloat) -> SCNNode {
            let node = SCNNode()
            node.position = SCNVector3(x, 6, z)
            node.physicsBody = SCNPhysicsBody(type: .static, shape: SCNPhysicsShape(geometry: SCNBox(width: width, height: 14, length: length, chamferRadius: 0)))
            node.physicsBody?.friction = 0.25
            node.physicsBody?.restitution = 0.35
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
        scene.rootNode.addChildNode(lid)
        walls.append(lid)
    }

    /// Throws dice. A new roll by the same person clears their last one.
    @discardableResult
    func throwDice(id: String, owner: String, kinds: [DieKind], specs: [ThrowSpec], color: String, local: Bool,
                   holdUntilStill: Bool = false, onDone: @escaping ([Int]?) -> Void) -> Roll {
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
            let geometry = DiceArt.geometry(kind).copy() as! SCNGeometry
            geometry.materials = DiceArt.materials(kind, values: values, color: color)
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
            body.contactTestBitMask = 1
            body.categoryBitMask = 1
            node.physicsBody = body
            scene.rootNode.addChildNode(node)
            body.velocity = SCNVector3(Float(spec.v[0]) * hz, 0, Float(spec.v[1]) * hz)
            let spin = SIMD3<Float>(Float(spec.w[0]), Float(spec.w[1]), Float(spec.w[2]))
            let speed = simd_length(spin)
            if speed > 0.001 {
                let axis = spin / speed
                body.angularVelocity = SCNVector4(axis.x, axis.y, axis.z, speed)
            }
            roll.dice.append(Die(kind: kind, node: node, values: values, color: color))
        }
        rolls.append(roll)
        return roll
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
        die.node.geometry?.materials = DiceArt.materials(die.kind, values: die.values, color: die.color, dimmed: true)
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
            die.node.geometry?.materials = DiceArt.materials(die.kind, values: die.values, color: die.color)
        }
    }

    // MARK: Every physics step

    var isBusy: Bool { rolls.contains { !$0.done } }

    func tick() {
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
    static let colors: [(String, String)] = [
        ("Ruby", "#b3261e"), ("Sapphire", "#2a5bd7"), ("Jade", "#1f8a5b"), ("Amethyst", "#7b3fbf"),
        ("Amber", "#c47a12"), ("Onyx", "#1d1d24"), ("Ivory", "#e8e2d0"), ("Teal", "#0f8a8a"),
    ]

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
    @Published var showLog = false

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
    }

    private func save() {
        let defaults = UserDefaults.standard
        defaults.set(counts, forKey: "dice.counts")
        defaults.set(modifier, forKey: "dice.modifier")
        defaults.set(color, forKey: "dice.color")
        defaults.set(shakeToRoll, forKey: "dice.shake")
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

    /// Rolls the chosen dice (or 2d20 for advantage / disadvantage), harder with strength (1–3).
    func roll(_ mode: RollMode = .normal, strength: Double = 1, fromShake: Bool = false) {
        let plan = DiceGeometry.plan(counts, mode: mode)
        guard !plan.kinds.isEmpty else { return }
        let id = newId()
        mine.insert(id)
        let start = RollStart(id: id, by: myName(), mode: mode, modifier: modifier, groups: plan.groups, kinds: plan.kinds,
                              color: color, dice: plan.kinds.map { _ in ThrowSpec.random(strength: strength) })
        if !isOpen { open() }
        banner = nil
        scene.volume = volume()
        if fromShake { shakeRoll = id }
        scene.throwDice(id: id, owner: "me", kinds: start.kinds, specs: start.dice, color: color, local: true,
                        holdUntilStill: fromShake) { [weak self] values in
            guard let self, let values else { return }
            if self.shakeRoll == id { self.shakeRoll = nil }
            let summary = DiceGeometry.summarize(mode: start.mode, modifier: start.modifier, groups: start.groups, values: values)
            let entry = RollEntry(id: id, by: start.by, title: summary.title, detail: summary.detail, total: summary.total, at: Date(), mine: true)
            self.dimDropped(id: id, start: start, summary: summary)
            self.add(entry)
            self.banner = entry
            self.onResult?(id, values)
        }
        onStart?(start)
    }

    private func dimDropped(id: String, start: RollStart, summary: RollSummary) {
        guard let kept = summary.kept, let keptIndex = summary.scores.firstIndex(of: kept) else { return }
        for (i, group) in start.groups.enumerated() where i != keptIndex {
            if let die = group.dice.first { scene.dim(id: id, die: die) }
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
        scene.throwDice(id: start.id, owner: start.by, kinds: start.kinds, specs: start.dice, color: start.color, local: false) { [weak self] values in
            guard let self, let values else { return }
            self.finishRemote(start.id, values: values)
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
        let summary = DiceGeometry.summarize(mode: start.mode, modifier: start.modifier, groups: start.groups, values: values)
        let row = RollEntry(id: id, by: start.by, title: summary.title, detail: summary.detail, total: summary.total, at: Date(), mine: false)
        dimDropped(id: id, start: start, summary: summary)
        add(row)
        banner = row
        if watching {
            watchTask?.cancel()
            watchTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 4_500_000_000)
                guard let self, !Task.isCancelled, self.watching else { return }
                self.watching = false
                self.banner = nil
                self.scene.clear()
            }
        }
    }

    /// Rolls that happened before this device joined (no dice, just the log).
    func setHistory(_ list: [Any]) {
        for item in list {
            guard let json = item as? LiveJSON, let id = LiveNet.string(json["id"]), !log.contains(where: { $0.id == id }) else { continue }
            let values = ((json["values"] as? [Any]) ?? []).compactMap { LiveNet.number($0).map(Int.init) }
            let groups = RollStart.groups(json["groups"])
            let mode = RollMode(rawValue: LiveNet.string(json["mode"]) ?? "") ?? .normal
            let summary = DiceGeometry.summarize(mode: mode, modifier: Int(LiveNet.number(json["modifier"]) ?? 0), groups: groups, values: values)
            let at = Date(timeIntervalSince1970: (LiveNet.number(json["at"]) ?? LiveNet.now) / 1000)
            log.append(RollEntry(id: id, by: LiveNet.string(json["by"]) ?? "Someone", title: summary.title, detail: summary.detail,
                                 total: summary.total, at: at, mine: false))
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
    }
}

/// The result: who rolled, what, and the total.
struct DiceBanner: View {
    let entry: RollEntry

    var body: some View {
        VStack(spacing: 2) {
            Text("🎲 \(entry.mine ? "YOU" : entry.by.uppercased())")
                .font(.caption.weight(.bold))
                .tracking(1)
                .opacity(0.8)
            Text(entry.title).font(.footnote).opacity(0.85)
            Text("\(entry.total)").font(.system(size: 44, weight: .black, design: .rounded))
            Text(entry.detail).font(.footnote.monospacedDigit()).opacity(0.85)
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
                    DiceBanner(entry: banner).padding(.top, 70)
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

    var body: some View {
        ZStack {
            backdrop
            DiceStage(tray: tray)
            VStack(spacing: 0) {
                topBar
                if let banner = tray.banner {
                    DiceBanner(entry: banner).padding(.top, 8)
                }
                Spacer()
                controls
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
            if tray.showLog { logPanel }
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

    private var topBar: some View {
        HStack(spacing: 10) {
            Text("Dice").font(.title3.weight(.heavy)).foregroundStyle(Color.white).shadow(radius: 3)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(DiceTray.colors, id: \.1) { item in
                        Button {
                            tray.color = item.1
                        } label: {
                            Circle()
                                .fill(Color(hexString: item.1) ?? .red)
                                .frame(width: 22, height: 22)
                                .overlay(Circle().strokeBorder(Color.white, lineWidth: tray.color == item.1 ? 2.5 : 0.8))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(item.0) dice")
                    }
                }
            }
            .frame(maxWidth: 230)
            Spacer()
            pill(tray.log.isEmpty ? "Log" : "Log · \(tray.log.count)") { tray.showLog.toggle() }
            pill("Close") { tray.close() }
        }
        .padding(.top, 6)
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
                    ForEach(DiceGeometry.types, id: \.self) { type in dieButton(type) }
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

    private func dieButton(_ type: String) -> some View {
        let count = tray.counts[type] ?? 0
        return Button {
            tray.counts[type] = min(10, count + 1)
        } label: {
            Text(type)
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
        .accessibilityLabel("\(type), \(count) chosen")
        .accessibilityHint("Tap to add one. Touch and hold to remove.")
    }

    /// Tap to roll; hold to throw harder (strength grows over a second and a half).
    private var rollButton: some View {
        let empty = DiceGeometry.plan(tray.counts).kinds.isEmpty
        return Text("Roll \(DiceGeometry.describe(tray.counts, modifier: tray.modifier))")
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
            .accessibilityLabel("Roll \(DiceGeometry.describe(tray.counts, modifier: tray.modifier))")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { tray.roll() }
    }

    private var logPanel: some View {
        HStack {
            Spacer()
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Roll log").font(.headline)
                    Spacer()
                    Button("Done") { tray.showLog = false }
                }
                if tray.log.isEmpty {
                    Text("No rolls yet.").foregroundStyle(Color.white.opacity(0.7))
                }
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(tray.log) { entry in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(entry.mine ? "You" : entry.by).font(.subheadline.weight(.bold))
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
            }
            .foregroundStyle(Color.white)
            .padding(12)
            .frame(width: 290)
            .frame(maxHeight: 520)
            .background(Color.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 16))
            .padding(.trailing, 12)
            .padding(.top, 60)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .transition(.move(edge: .trailing).combined(with: .opacity))
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
            .fullScreenCover(isPresented: Binding(
                get: { active && tray.isOpen },
                set: { if !$0 { tray.close() } }
            )) {
                DiceView(tray: tray)
            }
    }
}
