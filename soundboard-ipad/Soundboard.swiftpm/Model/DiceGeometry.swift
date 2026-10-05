import Foundation
import simd

// The dice: their shapes, which number is on which face, where the numbers go
// on each face, and how to read a die once it stops. A copy of the Mac app's
// dice-geometry.js; keep the two the same.
//
// Every die is built the same way: a set of corner points, the convex hull
// around them (its faces), and numbers given to faces so opposite faces add up
// as on real dice (7 on a d6, 21 on a d20, 9 on a d10). A d4 has its numbers on
// its corners instead: the one pointing up is the roll.

typealias Vec3 = SIMD3<Double>

enum DieKind: String, CaseIterable {
    case d4, d6, d8, d10, d10t, d12, d20

    /// Circumradius, so the dice look about the same size.
    var radius: Double {
        switch self {
        case .d4: return 1.05
        case .d6: return 0.9
        case .d8: return 0.95
        case .d10, .d10t: return 0.92
        case .d12: return 0.98
        case .d20: return 1.02
        }
    }

    var faceCount: Int {
        switch self {
        case .d4: return 4
        case .d6: return 6
        case .d8: return 8
        case .d10, .d10t: return 10
        case .d12: return 12
        case .d20: return 20
        }
    }

    /// The lowest and highest number on the die (a d10t's 0–9 mean 00–90).
    var range: ClosedRange<Int> {
        switch self {
        case .d10, .d10t: return 0...9
        default: return 1...faceCount
        }
    }
}

struct DieFace {
    var corners: [Int]
    var normal: Vec3
    var center: Vec3
    var value: Int = 0
    var label: String = ""
    /// The direction the face's number reads upwards, and to its right.
    var up = Vec3(0, 1, 0)
    var right = Vec3(1, 0, 0)
}

struct DieShape {
    let kind: DieKind
    let points: [Vec3]
    let faces: [DieFace]
    /// On a d4, each corner's number.
    let cornerValues: [Int]
}

enum DiceGeometry {
    static let types = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"]

    private static let phi = (1 + sqrt(5.0)) / 2
    private static var cache: [DieKind: DieShape] = [:]
    private static let lock = NSLock()

    private static func cornerPoints(_ kind: DieKind) -> [Vec3] {
        switch kind {
        case .d4:
            return [Vec3(1, 1, 1), Vec3(-1, -1, 1), Vec3(-1, 1, -1), Vec3(1, -1, -1)]
        case .d6:
            var p: [Vec3] = []
            for x in [-1.0, 1] { for y in [-1.0, 1] { for z in [-1.0, 1] { p.append(Vec3(x, y, z)) } } }
            return p
        case .d8:
            return [Vec3(1, 0, 0), Vec3(-1, 0, 0), Vec3(0, 1, 0), Vec3(0, -1, 0), Vec3(0, 0, 1), Vec3(0, 0, -1)]
        case .d10, .d10t:
            // A pentagonal trapezohedron: two apexes and a zig-zag ring of ten
            // corners. The apex height keeps each kite face flat.
            let z = 0.12
            let c = cos(Double.pi / 5)
            let apex = z * (1 + c) / (1 - c)
            var p = [Vec3(0, apex, 0), Vec3(0, -apex, 0)]
            for i in 0..<10 {
                let a = Double(i) * Double.pi / 5
                p.append(Vec3(cos(a), i % 2 == 1 ? -z : z, sin(a)))
            }
            return p
        case .d12:
            var p: [Vec3] = []
            for x in [-1.0, 1] { for y in [-1.0, 1] { for z in [-1.0, 1] { p.append(Vec3(x, y, z)) } } }
            for a in [-1.0, 1] {
                for b in [-1.0, 1] {
                    p.append(Vec3(0, a / phi, b * phi))
                    p.append(Vec3(a / phi, b * phi, 0))
                    p.append(Vec3(a * phi, 0, b / phi))
                }
            }
            return p
        case .d20:
            var p: [Vec3] = []
            for a in [-1.0, 1] {
                for b in [-1.0, 1] {
                    p.append(Vec3(0, a, b * phi))
                    p.append(Vec3(a, b * phi, 0))
                    p.append(Vec3(a * phi, 0, b))
                }
            }
            return p
        }
    }

    /// The faces of the convex hull around `points`: corners counter-clockwise
    /// seen from outside, with outward normals.
    static func hull(_ points: [Vec3]) -> [DieFace] {
        var faces: [DieFace] = []
        var seen: [Vec3] = []
        let n = points.count
        for i in 0..<n {
            for j in (i + 1)..<n {
                for k in (j + 1)..<n {
                    var normal = simd_cross(points[j] - points[i], points[k] - points[i])
                    if simd_length(normal) < 1e-9 { continue }
                    normal = simd_normalize(normal)
                    var d = simd_dot(normal, points[i])
                    var above = 0
                    var below = 0
                    for p in points {
                        let side = simd_dot(normal, p) - d
                        if side > 1e-6 { above += 1 } else if side < -1e-6 { below += 1 }
                    }
                    if above > 0 && below > 0 { continue }
                    if above > 0 {
                        normal = -normal
                        d = -d
                    }
                    if seen.contains(where: { simd_dot($0, normal) > 1 - 1e-6 }) { continue }
                    seen.append(normal)
                    var on: [Int] = []
                    for (index, p) in points.enumerated() where abs(simd_dot(normal, p) - d) < 1e-6 { on.append(index) }
                    let center = on.reduce(Vec3.zero) { $0 + points[$1] } / Double(on.count)
                    let axisU = simd_normalize(points[on[0]] - center)
                    let axisV = simd_cross(normal, axisU)
                    on.sort { a, b in
                        let pa = points[a] - center
                        let pb = points[b] - center
                        return atan2(simd_dot(pa, axisV), simd_dot(pa, axisU)) < atan2(simd_dot(pb, axisV), simd_dot(pb, axisU))
                    }
                    faces.append(DieFace(corners: on, normal: normal, center: center))
                }
            }
        }
        return faces
    }

    /// Numbers for faces so opposite ones add up as on real dice.
    private static func number(_ faces: [DieFace], kind: DieKind) -> [Int] {
        let order = faces.indices.sorted { a, b in
            let na = faces[a].normal
            let nb = faces[b].normal
            if nb.y != na.y { return nb.y - na.y < 0 }
            return atan2(na.z, na.x) - atan2(nb.z, nb.x) < 0
        }
        var values = [Int?](repeating: nil, count: faces.count)
        let low = kind.range.lowerBound
        let high = kind.range.upperBound
        // Spread the numbers around so neighbours differ a lot, as on real dice.
        let firsts = (low...high).filter { $0 <= low + high - $0 }
        let pattern = firsts.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
            + firsts.enumerated().filter { $0.offset % 2 == 1 }.map(\.element)
        var next = 0
        for index in order where values[index] == nil {
            var opposite = -1
            var best = 0.0
            for (j, f) in faces.enumerated() where j != index && values[j] == nil {
                let d = simd_dot(f.normal, faces[index].normal)
                if d < best {
                    best = d
                    opposite = j
                }
            }
            let v = pattern[next]
            next += 1
            values[index] = v
            if opposite >= 0 { values[opposite] = low + high - v }
        }
        return values.map { $0 ?? 0 }
    }

    static func label(_ kind: DieKind, _ value: Int) -> String {
        if kind == .d10t { return value == 0 ? "00" : String(value * 10) }
        return String(value)
    }

    /// Everything about one kind of die, scaled to its size.
    static func build(_ kind: DieKind) -> DieShape {
        lock.lock()
        defer { lock.unlock() }
        if let shape = cache[kind] { return shape }
        let raw = cornerPoints(kind)
        let r = raw.map { simd_length($0) }.max() ?? 1
        let points = raw.map { $0 * (kind.radius / r) }
        var faces = hull(points)
        let values = kind == .d4 ? [] : number(faces, kind: kind)
        for i in faces.indices {
            if kind != .d4 {
                faces[i].value = values[i]
                faces[i].label = label(kind, values[i])
            }
            // Text reads towards a corner on triangles and kites (the far corner),
            // towards an edge on squares and pentagons.
            let corners = faces[i].corners.map { points[$0] }
            let center = faces[i].center
            let target: Vec3
            if kind == .d6 || corners.count == 5 {
                target = (corners[0] + corners[1]) / 2
            } else {
                target = corners.reduce(corners[0]) { simd_length($1 - center) > simd_length($0 - center) + 1e-6 ? $1 : $0 }
            }
            faces[i].up = simd_normalize(target - center)
            faces[i].right = simd_cross(faces[i].up, faces[i].normal)
        }
        let shape = DieShape(kind: kind, points: points, faces: faces, cornerValues: kind == .d4 ? Array(1...4) : [])
        cache[kind] = shape
        return shape
    }

    /// Where each corner of a face sits on its square texture (0…1, v up).
    static func faceUVs(_ shape: DieShape, _ face: DieFace) -> [SIMD2<Double>] {
        let rel = face.corners.map { shape.points[$0] - face.center }
        let radius = (rel.map { simd_length($0) }.max() ?? 1) * 1.04
        return rel.map { SIMD2(0.5 + simd_dot($0, face.right) / (2 * radius), 0.5 + simd_dot($0, face.up) / (2 * radius)) }
    }

    /// Which face (or, on a d4, which corner) points up for a die rotated by
    /// `rotation`, and whether it's lying flat (not cocked against something).
    static func top(_ kind: DieKind, rotation: simd_quatd) -> (index: Int, flat: Bool) {
        let shape = build(kind)
        if kind == .d4 {
            let ys = shape.points.map { rotation.act($0).y }
            let index = ys.indices.max { ys[$0] < ys[$1] } ?? 0
            let sorted = ys.sorted(by: >)
            return (index, sorted[0] - sorted[1] > 0.5)
        }
        var index = 0
        var best = -Double.infinity
        for (i, face) in shape.faces.enumerated() {
            let y = rotation.act(face.normal).y
            if y > best {
                best = y
                index = i
            }
        }
        return (index, best > 0.9)
    }

    /// The numbers printed on a die as made: one per face, or per corner on a d4.
    static func defaultValues(_ kind: DieKind) -> [Int] {
        let shape = build(kind)
        return kind == .d4 ? shape.cornerValues : shape.faces.map(\.value)
    }

    /// Renumbers a die so face (or corner) `index` shows `wanted`, keeping
    /// opposite faces adding up as before.
    static func relabel(_ kind: DieKind, values: [Int], index: Int, wanted: Int) -> [Int] {
        let current = values[index]
        if current == wanted { return values }
        let sum = kind.range.lowerBound + kind.range.upperBound
        var swap: [Int: Int] = [current: wanted, wanted: current]
        if kind != .d4 && wanted != sum - current {
            swap[sum - current] = sum - wanted
            swap[sum - wanted] = sum - current
        }
        return values.map { swap[$0] ?? $0 }
    }

    /// A die's score: d10 shows 0 as 10; a d10t's 0–9 are 00–90.
    static func score(_ kind: DieKind, _ value: Int) -> Int {
        switch kind {
        case .d10: return value == 0 ? 10 : value
        case .d10t: return value * 10
        default: return value
        }
    }

    /// The dice one choice puts on the table: d100 is a tens die and a d10.
    static func diceFor(_ type: String) -> [DieKind] {
        type == "d100" ? [.d10t, .d10] : [DieKind(rawValue: type) ?? .d6]
    }
}

/// One choice in a roll (a d20, or a d100 made of two dice) and its dice.
struct RollGroup: Equatable {
    var type: String
    var dice: [Int]
}

enum RollMode: String {
    case normal, adv, dis
}

struct RollSummary {
    var scores: [Int]
    var kept: Int?
    var total: Int
    var title: String
    var detail: String
}

extension DiceGeometry {
    /// The dice a roll puts on the table, in order, and which of them make up
    /// each choice. Advantage and disadvantage are 2d20.
    static func plan(_ counts: [String: Int], mode: RollMode = .normal) -> (groups: [RollGroup], kinds: [DieKind]) {
        var groups: [RollGroup] = []
        var kinds: [DieKind] = []
        let pool = mode == .normal ? counts : ["d20": 2]
        for type in types {
            for _ in 0..<(pool[type] ?? 0) {
                var dice: [Int] = []
                for kind in diceFor(type) {
                    kinds.append(kind)
                    dice.append(kinds.count - 1)
                }
                groups.append(RollGroup(type: type, dice: dice))
            }
        }
        return (groups, kinds)
    }

    private static func modifierText(_ modifier: Int) -> String {
        modifier > 0 ? " + \(modifier)" : (modifier < 0 ? " − \(-modifier)" : "")
    }

    /// "2d20 + 1d6 + 3"
    static func describe(_ counts: [String: Int], modifier: Int) -> String {
        let parts = types.filter { (counts[$0] ?? 0) > 0 }.map { "\(counts[$0] ?? 0)\($0)" }
        let text = parts.isEmpty ? "nothing" : parts.joined(separator: " + ")
        return text + modifierText(modifier)
    }

    /// A finished roll's numbers. `values`: what each die shows, as printed.
    static func summarize(mode: RollMode, modifier: Int, groups: [RollGroup], values: [Int]) -> RollSummary {
        let scores: [Int] = groups.map { g in
            guard let first = g.dice.first, first < values.count else { return 0 }
            if g.type == "d100", g.dice.count == 2, g.dice[1] < values.count {
                let n = values[g.dice[0]] * 10 + values[g.dice[1]]
                return n == 0 ? 100 : n
            }
            return score(DieKind(rawValue: g.type) ?? .d6, values[first])
        }
        let mod = modifierText(modifier)
        if mode != .normal {
            let kept = (mode == .adv ? scores.max() : scores.min()) ?? 0
            return RollSummary(
                scores: scores,
                kept: kept,
                total: kept + modifier,
                title: "d20 with \(mode == .adv ? "advantage" : "disadvantage")\(mod)",
                detail: "\(kept) (\(scores.map(String.init).joined(separator: " | ")))\(mod) = \(kept + modifier)"
            )
        }
        var counts: [String: Int] = [:]
        for g in groups { counts[g.type, default: 0] += 1 }
        let sum = scores.reduce(0, +)
        return RollSummary(
            scores: scores,
            kept: nil,
            total: sum + modifier,
            title: describe(counts, modifier: modifier),
            detail: "\(scores.map(String.init).joined(separator: " + "))\(mod) = \(sum + modifier)"
        )
    }
}
