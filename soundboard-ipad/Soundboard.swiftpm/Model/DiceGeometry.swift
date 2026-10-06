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
    /// A coin: heads (1) on top, tails (2) underneath, and a ridged edge.
    case coin

    /// Circumradius, so the dice look about the same size.
    var radius: Double {
        switch self {
        case .d4: return 1.05
        case .d6: return 0.9
        case .d8: return 0.95
        case .d10, .d10t: return 0.92
        case .d12: return 0.98
        case .d20: return 1.02
        case .coin: return 1.05
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
        case .coin: return 2
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
    static let types = ["d4", "d6", "d8", "d10", "d12", "d20", "d100", "coin"]
    static let coinEdges = 20

    private static let phi = (1 + sqrt(5.0)) / 2
    private static var cache: [DieKind: DieShape] = [:]
    private static let lock = NSLock()

    private static func cornerPoints(_ kind: DieKind) -> [Vec3] {
        switch kind {
        case .coin:
            var p: [Vec3] = []
            for y in [0.1, -0.1] {
                for i in 0..<coinEdges {
                    let a = Double(i) * Double.pi * 2 / Double(coinEdges)
                    p.append(Vec3(cos(a), y, sin(a)))
                }
            }
            return p
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
        if kind == .coin { return value == 1 ? "Heads" : (value == 2 ? "Tails" : "") }
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
        let values = kind == .d4 || kind == .coin ? [] : number(faces, kind: kind)
        for i in faces.indices {
            if kind == .coin {
                // The flat faces are heads (up) and tails (down); the edge has no number.
                let y = faces[i].normal.y
                faces[i].value = y > 0.99 ? 1 : (y < -0.99 ? 2 : 0)
                faces[i].label = label(kind, faces[i].value)
            } else if kind != .d4 {
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
        if kind == .coin {
            // Heads or tails: whichever flat face is up. On its edge, it's cocked.
            let heads = shape.faces.firstIndex { $0.value == 1 } ?? 0
            let tails = shape.faces.firstIndex { $0.value == 2 } ?? 0
            let y = rotation.act(shape.faces[heads].normal).y
            return (y >= 0 ? heads : tails, abs(y) > 0.9)
        }
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

    /// Where the top face (on a d4, the top corner) points, in the world. A die
    /// leaning on something is tipped until this points straight up.
    static func upward(_ kind: DieKind, rotation: simd_quatd) -> SIMD3<Double> {
        let shape = build(kind)
        let index = top(kind, rotation: rotation).index
        let local = kind == .d4 ? shape.points[index] : shape.faces[index].normal
        return simd_normalize(rotation.act(local))
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

    /// The dice one choice puts on the table: d100 is a tens die and a d10; a
    /// custom die is the dN with its number of sides.
    static func diceFor(_ type: String, custom: CustomDie? = nil) -> [DieKind] {
        if type == "custom", let custom { return [DieKind(rawValue: "d\(custom.sides)") ?? .d6] }
        return type == "d100" ? [.d10t, .d10] : [DieKind(rawValue: type) ?? .d6]
    }
}

/// One choice in a roll (a d20, or a d100 made of two dice) and its dice.
struct RollGroup: Equatable {
    var type: String
    var dice: [Int]
    /// A custom die's id.
    var die: String? = nil
}

/// A die with your own words on its faces: the dN with that many sides; the
/// face printed with number k shows faces[k − 1] (on a d10, faces[k]).
struct CustomDie: Equatable, Codable, Identifiable {
    var id: String
    var name: String
    var sides: Int
    var faces: [String]

    func label(_ value: Int) -> String {
        let index = sides == 10 ? value : value - 1
        return faces.indices.contains(index) ? faces[index] : ""
    }

    var json: [String: Any] { ["id": id, "name": name, "sides": sides, "faces": faces] }

    /// A custom die, checked: a name, a shape and one short text per face.
    static func clean(_ value: Any?) -> CustomDie? {
        guard let m = value as? [String: Any] else { return nil }
        let id = (m["id"] as? String) ?? ""
        guard id.range(of: "^[A-Za-z0-9_-]{1,60}$", options: .regularExpression) != nil else { return nil }
        let sides = (m["sides"] as? NSNumber)?.intValue ?? 0
        guard DiceGeometry.customSides.contains(sides), let raw = m["faces"] as? [Any] else { return nil }
        let faces = (0..<sides).map { i in String((i < raw.count ? (raw[i] as? String) ?? "" : "").prefix(24)) }
        let name = String(((m["name"] as? String) ?? "Custom").prefix(30))
        return CustomDie(id: id, name: name.isEmpty ? "Custom" : name, sides: sides, faces: faces)
    }
}

enum RollMode: String {
    case normal, adv, dis
}

struct RollSummary {
    var scores: [Int]
    var kept: Int?
    /// nil when the dice show words rather than numbers.
    var total: Int?
    var title: String
    var detail: String
}

extension DiceGeometry {
    /// The shapes a custom die can have.
    static let customSides = [4, 6, 8, 10, 12, 20]

    /// Popular dice ready to use (shapes and words only).
    static let presets: [CustomDie] = [
        CustomDie(id: "preset-fate", name: "Fate", sides: 6, faces: ["+", "+", "−", "−", "", ""]),
        CustomDie(id: "preset-oracle", name: "Oracle", sides: 6, faces: ["Yes", "Yes, and…", "Yes, but…", "No, but…", "No, and…", "No"]),
        CustomDie(id: "preset-direction", name: "Direction", sides: 8, faces: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
        CustomDie(id: "preset-weather", name: "Weather", sides: 6, faces: ["Clear", "Cloudy", "Rain", "Storm", "Fog", "Snow"]),
        CustomDie(id: "preset-hit", name: "Hit location", sides: 6, faces: ["Head", "Chest", "L arm", "R arm", "L leg", "R leg"]),
        CustomDie(id: "preset-boost", name: "Boost", sides: 6, faces: ["", "", "Success", "Success + Adv", "Adv + Adv", "Advantage"]),
        CustomDie(id: "preset-setback", name: "Setback", sides: 6, faces: ["", "", "Failure", "Failure", "Threat", "Threat"]),
        CustomDie(id: "preset-ability", name: "Ability", sides: 8, faces: ["", "Success", "Success", "Success ×2", "Advantage", "Advantage", "Success + Adv", "Advantage ×2"]),
        CustomDie(id: "preset-difficulty", name: "Difficulty", sides: 8, faces: ["", "Failure", "Failure ×2", "Threat", "Threat", "Threat", "Threat ×2", "Failure + Threat"]),
        CustomDie(id: "preset-proficiency", name: "Proficiency", sides: 12, faces: ["", "Success", "Success", "Success ×2", "Success ×2", "Advantage", "Success + Adv", "Success + Adv", "Success + Adv", "Advantage ×2", "Advantage ×2", "Triumph"]),
        CustomDie(id: "preset-challenge", name: "Challenge", sides: 12, faces: ["", "Failure", "Failure", "Failure ×2", "Failure ×2", "Threat", "Threat", "Failure + Threat", "Failure + Threat", "Threat ×2", "Threat ×2", "Despair"]),
        CustomDie(id: "preset-food", name: "Dinner", sides: 6, faces: ["Pizza", "Tacos", "Sushi", "Burgers", "Pasta", "Chef's choice"]),
    ]

    /// A face's number, if it reads as one: "+" is 1, "−" is −1, blank is 0, "3" is 3.
    static func faceNumber(_ text: String) -> Int? {
        let t = text.trimmingCharacters(in: .whitespaces)
        if t.isEmpty || t == "0" || t == "blank" { return 0 }
        if t == "+" { return 1 }
        if t == "−" || t == "-" { return -1 }
        return Int(t.replacingOccurrences(of: "−", with: "-"))
    }

    /// The dice a roll puts on the table, in order, and which of them make up
    /// each choice. counts: ["d20": 2, "custom:<id>": 1]; customs: the custom
    /// dice it may use. Advantage and disadvantage are 2d20.
    static func plan(_ counts: [String: Int], mode: RollMode = .normal, customs: [CustomDie] = []) -> (groups: [RollGroup], kinds: [DieKind], custom: [CustomDie]) {
        var groups: [RollGroup] = []
        var kinds: [DieKind] = []
        var used: [CustomDie] = []
        let pool = mode == .normal ? counts : ["d20": 2]
        func add(_ type: String, _ def: CustomDie?) {
            var dice: [Int] = []
            for kind in diceFor(type, custom: def) {
                kinds.append(kind)
                dice.append(kinds.count - 1)
            }
            groups.append(RollGroup(type: type, dice: dice, die: def?.id))
        }
        for type in types {
            for _ in 0..<max(0, pool[type] ?? 0) { add(type, nil) }
        }
        if mode == .normal {
            for def in customs {
                let n = max(0, pool["custom:\(def.id)"] ?? 0)
                if n > 0 { used.append(def) }
                for _ in 0..<n { add("custom", def) }
            }
        }
        return (groups, kinds, used)
    }

    private static func modifierText(_ modifier: Int) -> String {
        modifier > 0 ? " + \(modifier)" : (modifier < 0 ? " − \(-modifier)" : "")
    }

    /// "2d20 + 1d6 + 3", "coin", "2 Oracle"
    static func describe(_ counts: [String: Int], modifier: Int, customs: [CustomDie] = []) -> String {
        var parts = types.filter { (counts[$0] ?? 0) > 0 }.map { type -> String in
            let n = counts[type] ?? 0
            if type == "coin" { return n > 1 ? "\(n) coins" : "coin" }
            return "\(n)\(type)"
        }
        for def in customs {
            let n = counts["custom:\(def.id)"] ?? 0
            if n > 0 { parts.append(n > 1 ? "\(n) \(def.name)" : def.name) }
        }
        let text = parts.isEmpty ? "nothing" : parts.joined(separator: " + ")
        return text + modifierText(modifier)
    }

    /// A finished roll's numbers. `values`: what each die shows, as printed.
    /// `total` is nil when the dice show words rather than numbers.
    static func summarize(mode: RollMode, modifier: Int, groups: [RollGroup], values: [Int], customs: [CustomDie] = []) -> RollSummary {
        var numeric = true
        var labels: [Int: String] = [:]
        let defs = Dictionary(customs.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var scores: [Int] = []
        for (i, g) in groups.enumerated() {
            guard let first = g.dice.first, first < values.count else { scores.append(0); continue }
            if g.type == "d100", g.dice.count == 2, g.dice[1] < values.count {
                let n = values[g.dice[0]] * 10 + values[g.dice[1]]
                scores.append(n == 0 ? 100 : n)
            } else if g.type == "custom" {
                let def = g.die.flatMap { defs[$0] }
                let text = def?.label(values[first]) ?? "?"
                labels[i] = text.isEmpty ? "—" : text
                // A die of numbers (like Fate's + − and blank) adds up; a die of words doesn't.
                if let def, def.faces.allSatisfy({ faceNumber($0) != nil }) {
                    scores.append(faceNumber(text) ?? 0)
                } else {
                    numeric = false
                    scores.append(0)
                }
            } else if g.type == "coin" {
                numeric = false
                labels[i] = label(.coin, values[first])
                scores.append(values[first])
            } else {
                scores.append(score(DieKind(rawValue: g.type) ?? .d6, values[first]))
            }
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
        for g in groups { counts[g.type == "custom" ? "custom:\(g.die ?? "")" : g.type, default: 0] += 1 }
        let title = describe(counts, modifier: numeric ? modifier : 0, customs: customs)
        if !numeric {
            // Words: list them; any numbers are shown as they are.
            let detail = scores.indices.map { labels[$0] ?? String(scores[$0]) }.joined(separator: ", ")
            return RollSummary(scores: scores, kept: nil, total: nil, title: title, detail: detail)
        }
        let sum = scores.reduce(0, +)
        let shown = scores.map { $0 < 0 ? "(−\(-$0))" : String($0) }
        return RollSummary(
            scores: scores,
            kept: nil,
            total: sum + modifier,
            title: title,
            detail: "\(shown.joined(separator: " + "))\(mod) = \(sum + modifier)"
        )
    }

    // MARK: The table: who rolled best, statistics

    /// Every d20 a roll showed (both with advantage or disadvantage).
    static func d20s(groups: [RollGroup], values: [Int]) -> [Int] {
        groups.filter { $0.type == "d20" }.compactMap { g in g.dice.first.flatMap { $0 < values.count ? values[$0] : nil } }
    }

    /// The d20s that count: all of them, or the kept one with advantage / disadvantage.
    static func countedD20s(mode: RollMode, groups: [RollGroup], values: [Int]) -> [Int] {
        let faces = d20s(groups: groups, values: values)
        switch mode {
        case .adv: return faces.max().map { [$0] } ?? []
        case .dis: return faces.min().map { [$0] } ?? []
        case .normal: return faces
        }
    }

    struct PersonStats: Identifiable {
        var name: String
        var rolls = 0
        var d20 = 0
        var sum = 0
        var nat20 = 0
        var nat1 = 0
        var id: String { name }
        var average: Double? { d20 > 0 ? (Double(sum) / Double(d20) * 10).rounded() / 10 : nil }
    }

    /// Per person: rolls, d20s rolled and their average, natural 20s and 1s; and
    /// the luckiest and unluckiest (highest and lowest d20 average, 3+ d20s each).
    static func stats(_ entries: [(by: String, d20s: [Int], nat20: Int, nat1: Int)]) -> (people: [PersonStats], luckiest: String?, unluckiest: String?) {
        var people: [String: PersonStats] = [:]
        var order: [String] = []
        for e in entries {
            if people[e.by] == nil { order.append(e.by) }
            var p = people[e.by] ?? PersonStats(name: e.by)
            p.rolls += 1
            for v in e.d20s { p.d20 += 1; p.sum += v }
            p.nat20 += e.nat20
            p.nat1 += e.nat1
            people[e.by] = p
        }
        let list = order.compactMap { people[$0] }.sorted { $0.rolls != $1.rolls ? $0.rolls > $1.rolls : $0.name < $1.name }
        let ranked = list.filter { $0.d20 >= 3 }.sorted { ($0.average ?? 0) > ($1.average ?? 0) }
        return (list, ranked.count > 1 ? ranked.first?.name : nil, ranked.count > 1 ? ranked.last?.name : nil)
    }

    /// Who won a "highest (or lowest) roll wins": best first, and the winners
    /// (more than one on a tie).
    static func rank<T>(_ results: [T], total: (T) -> Int?, name: (T) -> String, lowest: Bool = false) -> (ranking: [T], winners: [T]) {
        let ranking = results.filter { total($0) != nil }.sorted { a, b in
            let x = total(a) ?? 0
            let y = total(b) ?? 0
            if x != y { return lowest ? x < y : x > y }
            return name(a) < name(b)
        }
        let best = ranking.first.flatMap(total)
        return (ranking, ranking.filter { total($0) == best })
    }

    /// Initiative order: highest total first; ties go to the higher modifier, then by name.
    static func initiativeOrder<T>(_ entries: [T], total: (T) -> Int, modifier: (T) -> Int, name: (T) -> String) -> [T] {
        entries.sorted { a, b in
            if total(a) != total(b) { return total(a) > total(b) }
            if modifier(a) != modifier(b) { return modifier(a) > modifier(b) }
            return name(a) < name(b)
        }
    }
}
