import SwiftUI
import UIKit

// The broadcaster's table, on top of the dice (DiceView.swift): roll requests
// ("Everyone: Dexterity save, DC 14"), initiative with a shared turn order and
// a "your turn" nudge, and "who goes first / who pays" (everyone rolls, the
// highest wins). The broadcaster runs them from panels in the dice tray;
// listeners get a card to roll from, and everyone sees the results.
// Matches the Mac app's table.js.

// MARK: - State

/// A value for JSON, or null.
private func orNull<T>(_ value: T?) -> Any { value.map { $0 as Any } ?? NSNull() }

@MainActor
final class DiceTable: ObservableObject {
    /// What a request rolls.
    static let diceChoices: [(String, [String: Int])] = [
        ("d20", ["d20": 1]), ("d12", ["d12": 1]), ("d10", ["d10": 1]), ("d8", ["d8": 1]), ("d6", ["d6": 1]),
        ("2d6", ["d6": 2]), ("d4", ["d4": 1]), ("d100", ["d100": 1]), ("Coin", ["coin": 1]),
    ]
    static let quickChecks = ["Dexterity save", "Wisdom save", "Constitution save", "Perception check", "Stealth check"]
    static let contests = ["Who goes first?", "Who pays?", "Who takes watch?", "Who opens the door?"]

    /// A request: kind is "check" (a save or check), "initiative" or "contest" (highest wins).
    struct Ask: Identifiable {
        let id: String
        var kind: String
        var label: String
        var counts: [String: Int]
        var dc: Int?
        var showDC = true
        var lowest = false
        var to: [String]?
        var includeMe = false
        var results: [Result] = []

        var json: LiveJSON {
            var m: LiveJSON = ["t": "ask", "id": id, "kind": kind, "label": label, "counts": counts]
            if kind == "check", let dc, showDC { m["dc"] = dc }
            if kind == "contest" { m["lowest"] = lowest }
            if let to { m["to"] = to }
            return m
        }

        init(id: String, kind: String, label: String, counts: [String: Int], dc: Int? = nil, showDC: Bool = true,
             lowest: Bool = false, to: [String]? = nil, includeMe: Bool = false) {
            self.id = id
            self.kind = kind
            self.label = label
            self.counts = counts
            self.dc = dc
            self.showDC = showDC
            self.lowest = lowest
            self.to = to
            self.includeMe = includeMe
        }

        init?(json: LiveJSON) {
            guard let id = LiveNet.string(json["id"]) else { return nil }
            self.id = id
            kind = LiveNet.string(json["kind"]) ?? "check"
            label = LiveNet.string(json["label"]) ?? "Roll"
            var counts: [String: Int] = [:]
            for (key, value) in (json["counts"] as? LiveJSON) ?? [:] {
                if let n = LiveNet.number(value) { counts[key] = max(0, min(10, Int(n))) }
            }
            self.counts = counts.isEmpty ? ["d20": 1] : counts
            dc = LiveNet.number(json["dc"]).map(Int.init)
            lowest = (json["lowest"] as? Bool) ?? false
        }
    }

    /// Someone's roll answering a request.
    struct Result: Identifiable {
        let key: String
        let name: String
        let peer: String?
        let total: Int?
        let detail: String
        let modifier: Int
        var id: String { key }
    }

    /// A place in the turn order.
    struct Turn: Identifiable, Equatable {
        let name: String
        let peer: String?
        let total: Int
        let modifier: Int
        let enemy: Bool
        var id: String { peer ?? "name:\(name)" }

        var json: LiveJSON {
            ["name": name, "total": total, "modifier": modifier, "enemy": enemy, "peer": orNull(peer)]
        }

        init(name: String, peer: String?, total: Int, modifier: Int, enemy: Bool) {
            self.name = name
            self.peer = peer
            self.total = total
            self.modifier = modifier
            self.enemy = enemy
        }

        init?(json: Any) {
            guard let m = json as? LiveJSON, let name = LiveNet.string(m["name"]) else { return nil }
            self.name = name
            peer = LiveNet.string(m["peer"])
            total = Int(LiveNet.number(m["total"]) ?? 0)
            modifier = Int(LiveNet.number(m["modifier"]) ?? 0)
            enemy = (m["enemy"] as? Bool) ?? false
        }
    }

    /// The turn order as everyone sees it.
    struct Turns: Equatable {
        var phase: String // rolling | running
        var round: Int
        var current: Int
        var order: [Turn]
    }

    /// A finished request, on everyone's screen.
    struct ResultCard: Identifiable, Equatable {
        struct Row: Equatable, Identifiable {
            let name: String
            let total: Int?
            let pass: Bool?
            var id: String { name }
        }
        let id: String
        let kind: String
        let label: String
        let dc: Int?
        let rows: [Row]
        let winners: [String]
    }

    struct Enemy: Identifiable, Codable, Equatable {
        var id = UUID()
        var name: String
        var modifier: Int
    }

    weak var tray: DiceTray?
    /// Sends a table message to listeners (broadcaster only).
    var send: (LiveJSON) -> Void = { _ in }
    var peers: () -> [LiveHostEngine.Peer] = { [] }
    var hosting: () -> Bool = { false }
    /// A nudge: a buzz, and a notification if the app is in the background.
    var nudge: (String, String) -> Void = { _, _ in }
    var myName: () -> String = { "You" }

    // The broadcaster's side.
    @Published var check: Ask?
    @Published var contest: Ask?
    /// The finished contest, for a tie's roll-off.
    @Published var lastContest: (winners: [String], ranking: [Result], label: String, lowest: Bool)?
    @Published var draftLabel = "Dexterity save"
    @Published var draftDice = "d20"
    @Published var draftDC: Int? = 14
    @Published var draftShowDC = true
    @Published var draftTo: Set<String> = [] // empty: everyone
    @Published var contestLabel = "Who goes first?"
    @Published var contestLowest = false
    @Published var contestIncludeMe = true
    @Published var enemies: [Enemy] { didSet { saveEnemies() } }
    @Published private(set) var initPhase = "off" // off | rolling | running
    @Published private(set) var round = 1
    @Published private(set) var current = 0
    @Published private(set) var order: [Turn] = []
    private var initAskId: String?
    private var initEntries: [String: Turn] = [:]

    // Everyone.
    @Published private(set) var cards: [Ask] = []
    @Published private(set) var results: [ResultCard] = []
    @Published private(set) var turns: Turns?
    @Published private(set) var me = ""
    @Published private(set) var yourTurn = false
    private var lastTurnKey: String?

    init() {
        if let data = UserDefaults.standard.data(forKey: "table.enemies"),
           let list = try? JSONDecoder().decode([Enemy].self, from: data) {
            enemies = Array(list.prefix(20))
        } else {
            enemies = []
        }
    }

    private func saveEnemies() {
        if let data = try? JSONEncoder().encode(enemies) { UserDefaults.standard.set(data, forKey: "table.enemies") }
    }

    private func newId(_ prefix: String) -> String {
        "\(prefix)-\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))-\(UUID().uuidString.prefix(5).lowercased())"
    }

    func name(of peer: String) -> String? {
        peer == "host" ? myName() : peers().first { $0.id == peer }?.name
    }

    // MARK: Results coming in (broadcaster)

    /// Every finished roll passes through here; the ones answering a request count once per person.
    func collect(_ outcome: RollOutcome) {
        guard hosting(), let ask = outcome.start.ask else { return }
        let start = outcome.start
        let peer = start.peer.flatMap { $0 == "host" ? nil : $0 }
        let key = peer ?? "name:\(start.by)"
        let result = Result(key: key, name: start.by, peer: peer, total: outcome.summary.total,
                            detail: outcome.summary.detail, modifier: start.modifier)
        if ask == initAskId, initPhase != "off" {
            // Only the first roll counts.
            guard initEntries[key] == nil, let total = result.total else { return }
            initEntries[key] = Turn(name: start.by, peer: peer, total: total, modifier: start.modifier,
                                    enemy: peer == nil && start.by != myName())
            buildOrder()
            sendTurns()
        } else if check?.id == ask {
            guard check?.results.contains(where: { $0.key == key }) == false else { return }
            check?.results.append(result)
        } else if contest?.id == ask {
            guard contest?.results.contains(where: { $0.key == key }) == false else { return }
            contest?.results.append(result)
            maybeFinishContest()
        }
    }

    private func closeAsk(_ id: String?) {
        guard let id else { return }
        send(["t": "askClosed", "id": id])
    }

    // MARK: Roll requests

    func sendCheck() {
        closeCheck(share: false)
        let counts = Self.diceChoices.first { $0.0 == draftDice }?.1 ?? ["d20": 1]
        let live = Set(peers().map(\.id))
        let to = draftTo.isEmpty ? nil : Array(draftTo.intersection(live))
        if let to, to.isEmpty { return }
        let label = draftLabel.trimmingCharacters(in: .whitespaces)
        let ask = Ask(id: newId("ask"), kind: "check", label: label.isEmpty ? "Roll" : label, counts: counts,
                      dc: draftDC, showDC: draftShowDC, to: to)
        check = ask
        send(ask.json)
    }

    /// Closing a request with a known DC shows everyone who passed (if the DC was shown).
    func closeCheck(share: Bool = true) {
        guard let ask = check else { return }
        closeAsk(ask.id)
        if share && !ask.results.isEmpty {
            let rows = ask.results.map { r in
                ResultCard.Row(name: r.name, total: r.total, pass: ask.dc.flatMap { dc in r.total.map { $0 >= dc } })
            }
            var message: LiveJSON = [
                "t": "askResult", "id": ask.id, "kind": "check", "label": ask.label,
                "results": rows.map { row -> LiveJSON in ["name": row.name, "total": orNull(row.total), "pass": orNull(row.pass)] },
            ]
            if let dc = ask.dc, ask.showDC { message["dc"] = dc }
            if ask.showDC || ask.dc == nil { send(message) }
            // The broadcaster always sees pass and fail.
            show(ResultCard(id: ask.id, kind: "check", label: ask.label, dc: ask.dc, rows: rows, winners: []))
        }
        check = nil
    }

    // MARK: Initiative

    func rollInitiative() {
        closeAsk(initAskId)
        let id = newId("init")
        initAskId = id
        initEntries = [:]
        initPhase = "rolling"
        round = 1
        current = 0
        order = []
        send(Ask(id: id, kind: "initiative", label: "Initiative", counts: ["d20": 1]).json)
        sendTurns()
        // The broadcaster rolls for the enemies, one after another.
        for (i, enemy) in enemies.enumerated() {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(i) * 350_000_000)
                guard let self, self.initPhase != "off", self.initAskId == id else { return }
                self.tray?.roll(.normal, strength: 1, options: RollOptions(counts: ["d20": 1], modifier: enemy.modifier, ask: id,
                                                                           by: enemy.name, owner: "enemy:\(enemy.name)"))
            }
        }
    }

    private func buildOrder() {
        order = DiceGeometry.initiativeOrder(Array(initEntries.values), total: \.total, modifier: \.modifier, name: \.name)
    }

    var waitingForInitiative: [LiveHostEngine.Peer] {
        peers().filter { initEntries[$0.id] == nil }
    }

    func startTurns() {
        guard !order.isEmpty else { return }
        initPhase = "running"
        round = 1
        current = 0
        // Late rolls don't join a fight that has started; the request goes away.
        closeAsk(initAskId)
        sendTurns()
    }

    func stepTurn(_ by: Int) {
        guard initPhase == "running", !order.isEmpty else { return }
        current += by
        if current >= order.count {
            current = 0
            round += 1
        }
        if current < 0 {
            if round > 1 {
                current = order.count - 1
                round -= 1
            } else {
                current = 0
            }
        }
        sendTurns()
    }

    func endTurns() {
        closeAsk(initAskId)
        initPhase = "off"
        initAskId = nil
        initEntries = [:]
        order = []
        sendTurns()
    }

    private func sendTurns() {
        if initPhase == "off" {
            send(["t": "turns", "phase": "off"])
            showTurns(nil)
        } else {
            send(["t": "turns", "phase": initPhase, "round": round, "current": current, "order": order.map(\.json)])
            showTurns(Turns(phase: initPhase, round: round, current: current, order: order), you: "host")
        }
    }

    func addEnemy() {
        let base = enemies.last.map { $0.name.replacingOccurrences(of: "\\s*\\d+$", with: "", options: .regularExpression) } ?? "Goblin"
        let n = enemies.filter { $0.name.hasPrefix(base) }.count + 1
        enemies.append(Enemy(name: "\(base) \(n)", modifier: enemies.last?.modifier ?? 0))
    }

    // MARK: Who goes first / who pays

    func startContest(label: String, lowest: Bool, to: [String]?, includeMe: Bool) {
        if let contest { closeAsk(contest.id) }
        let ask = Ask(id: newId("who"), kind: "contest", label: label, counts: ["d20": 1], lowest: lowest, to: to, includeMe: includeMe)
        contest = ask
        lastContest = nil
        send(ask.json)
        // The broadcaster rolls too.
        if includeMe {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 200_000_000)
                self?.tray?.roll(.normal, strength: 1, options: RollOptions(counts: ["d20": 1], modifier: 0, ask: ask.id))
            }
        }
    }

    private var contestExpected: Int {
        guard let contest else { return 0 }
        let live = Set(peers().map(\.id))
        let list = contest.to ?? Array(live)
        return list.filter { live.contains($0) }.count + (contest.includeMe ? 1 : 0)
    }

    func maybeFinishContest() {
        guard let contest, contest.results.count >= contestExpected else { return }
        let id = contest.id
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 900_000_000)
            if self?.contest?.id == id { self?.finishContest() }
        }
    }

    func finishContest() {
        guard let ask = contest else { return }
        let (ranking, winners) = DiceGeometry.rank(ask.results, total: \.total, name: \.name, lowest: ask.lowest)
        closeAsk(ask.id)
        let message: LiveJSON = [
            "t": "askResult", "id": ask.id, "kind": "contest", "label": ask.label, "lowest": ask.lowest,
            "ranking": ranking.map { ["name": $0.name, "total": $0.total ?? 0] as LiveJSON },
            "winners": winners.map(\.name),
        ]
        send(message)
        show(ResultCard(id: ask.id, kind: "contest", label: ask.label, dc: nil,
                        rows: ranking.map { ResultCard.Row(name: $0.name, total: $0.total, pass: nil) }, winners: winners.map(\.name)))
        lastContest = (winners.map(\.name), ranking, ask.label, ask.lowest)
        contest = nil
    }

    /// A tie: just the tied people roll again.
    func rollOff() {
        guard let last = lastContest, last.winners.count > 1 else { return }
        let tied = last.ranking.filter { last.winners.contains($0.name) }
        let to = tied.compactMap(\.peer)
        let includeMe = tied.contains { $0.peer == nil }
        let label = last.label.hasSuffix("?") ? String(last.label.dropLast()) : last.label
        startContest(label: "\(label) — roll-off", lowest: last.lowest, to: to, includeMe: includeMe)
    }

    // MARK: Everyone: cards, results, the turn order

    /// Messages from the broadcaster (listeners only; the broadcaster's own are shown directly).
    func receive(_ message: LiveJSON) {
        guard !hosting() else { return }
        switch LiveNet.string(message["t"]) {
        case "ask":
            guard let ask = Ask(json: message), !cards.contains(where: { $0.id == ask.id }) else { return }
            cards.append(ask)
            nudge(kicker(ask), ask.label)
        case "askClosed":
            let id = LiveNet.string(message["id"])
            cards.removeAll { $0.id == id }
        case "askResult":
            guard let id = LiveNet.string(message["id"]) else { return }
            let kind = LiveNet.string(message["kind"]) ?? "check"
            let label = LiveNet.string(message["label"]) ?? "Roll"
            let rowsJSON = ((message[kind == "contest" ? "ranking" : "results"] as? [Any]) ?? []).compactMap { $0 as? LiveJSON }
            let rows = rowsJSON.map { r in
                ResultCard.Row(name: LiveNet.string(r["name"]) ?? "Someone", total: LiveNet.number(r["total"]).map(Int.init), pass: r["pass"] as? Bool)
            }
            let winners = ((message["winners"] as? [Any]) ?? []).compactMap { LiveNet.string($0) }
            show(ResultCard(id: id, kind: kind, label: label, dc: LiveNet.number(message["dc"]).map(Int.init), rows: rows, winners: winners))
        case "turns":
            if LiveNet.string(message["phase"]) == "off" {
                showTurns(nil)
            } else {
                let order = ((message["order"] as? [Any]) ?? []).compactMap(Turn.init(json:))
                showTurns(Turns(phase: LiveNet.string(message["phase"]) ?? "rolling", round: Int(LiveNet.number(message["round"]) ?? 1),
                                current: Int(LiveNet.number(message["current"]) ?? 0), order: order),
                          you: LiveNet.string(message["you"]) ?? "")
            }
        default:
            break
        }
    }

    func kicker(_ ask: Ask) -> String {
        switch ask.kind {
        case "initiative": return "⚔️ Roll initiative"
        case "contest": return "🏆 \(ask.lowest ? "Lowest" : "Highest") roll wins"
        default: return "🎲 Roll request"
        }
    }

    /// Rolls for a request card; the card goes away once the dice are thrown.
    func answer(_ ask: Ask, mode: RollMode, modifier: Int) {
        guard tray?.roll(mode, strength: 1.4, options: RollOptions(counts: ask.counts, modifier: modifier, ask: ask.id)) != nil else { return }
        cards.removeAll { $0.id == ask.id }
    }

    func dismissCard(_ id: String) {
        cards.removeAll { $0.id == id }
    }

    private func show(_ card: ResultCard) {
        results.removeAll { $0.id == card.id }
        results.append(card)
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            self?.results.removeAll { $0.id == card.id }
        }
    }

    func dismissResult(_ id: String) {
        results.removeAll { $0.id == id }
    }

    /// The turn order on every screen; "your turn" when it reaches you.
    private func showTurns(_ next: Turns?, you: String = "") {
        if !you.isEmpty { me = you }
        turns = next
        guard let next, next.phase == "running", next.order.indices.contains(next.current) else {
            lastTurnKey = nil
            return
        }
        let key = "\(next.round):\(next.current)"
        let mine = next.order[next.current].peer == me && !me.isEmpty
        if mine && key != lastTurnKey {
            yourTurn = true
            nudge("⚔️ Your turn!", "It's your turn in the initiative order.")
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 2_600_000_000)
                self?.yourTurn = false
            }
        }
        lastTurnKey = key
    }

    func reset() {
        cards = []
        turns = nil
        check = nil
        contest = nil
        lastContest = nil
        initPhase = "off"
        initAskId = nil
        initEntries = [:]
        order = []
        yourTurn = false
        lastTurnKey = nil
        me = ""
    }
}

// MARK: - Overlays: request cards, result cards, the turn strip

private let cardBackground = Color(red: 0.055, green: 0.055, blue: 0.086).opacity(0.92)

private func signed(_ n: Int) -> String { n > 0 ? "+\(n)" : "\(n)" }

/// A − value + stepper.
struct TableStepper: View {
    @Binding var value: Int

    var body: some View {
        HStack(spacing: 4) {
            TablePill(title: "−", small: true) { value = max(-20, value - 1) }
            Text(signed(value)).font(.headline.monospacedDigit()).frame(minWidth: 32)
            TablePill(title: "+", small: true) { value = min(30, value + 1) }
        }
        .foregroundStyle(Color.white)
    }
}

struct TablePill: View {
    let title: String
    var small = false
    var on = false
    var danger = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font((small ? Font.caption : Font.callout).weight(.semibold))
                .foregroundStyle(danger ? Color(red: 1, green: 0.7, blue: 0.7) : Color.white)
                .padding(.horizontal, small ? 10 : 14)
                .padding(.vertical, small ? 5 : 7)
                .background(on ? Color.accentColor.opacity(0.6) : Color.black.opacity(0.45), in: Capsule())
                .overlay(Capsule().strokeBorder(on ? Color.accentColor : Color.white.opacity(0.2)))
        }
        .buttonStyle(.plain)
    }
}

/// A row in a list of results: name, detail, total, pass or fail.
struct TableResultRow: View {
    let name: String
    let total: Int?
    var pass: Bool?
    var detail = ""
    var waiting = false
    var winner = false

    var body: some View {
        HStack(spacing: 8) {
            Text(name).font(.subheadline.weight(.bold))
            Text(detail).font(.caption2).opacity(0.65).lineLimit(1)
            Spacer(minLength: 4)
            Text(waiting ? "…" : (total.map(String.init) ?? "—")).font(.headline.weight(.black).monospacedDigit())
            if let pass { Text(pass ? "✓" : "✗").font(.headline.weight(.black)).frame(width: 18) }
        }
        .foregroundStyle(Color.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(background, in: RoundedRectangle(cornerRadius: 10))
        .opacity(waiting ? 0.55 : 1)
    }

    private var background: Color {
        if winner { return Color(red: 1, green: 0.78, blue: 0.24).opacity(0.3) }
        if pass == true { return Color(red: 0.18, green: 0.63, blue: 0.26).opacity(0.3) }
        if pass == false { return Color(red: 0.78, green: 0.2, blue: 0.2).opacity(0.3) }
        return Color.white.opacity(0.07)
    }
}

/// A request to roll, on a listener's screen.
private struct AskCard: View {
    @ObservedObject var table: DiceTable
    let ask: DiceTable.Ask
    @State private var modifier = 0
    @State private var ready = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                Text(table.kicker(ask).uppercased()).font(.caption2.weight(.heavy)).tracking(0.8).opacity(0.8)
                Spacer()
                Button { table.dismissCard(ask.id) } label: {
                    Image(systemName: "xmark").font(.caption2.weight(.bold)).frame(width: 24, height: 24)
                        .background(Color.white.opacity(0.1), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Not now")
            }
            if ask.kind != "initiative" { Text(ask.label).font(.title2.weight(.black)) }
            Text(([DiceGeometry.describe(ask.counts, modifier: 0)] + (ask.dc.map { ["DC \($0)"] } ?? [])).joined(separator: " · "))
                .font(.footnote).opacity(0.8)
            if ask.kind != "contest" {
                HStack {
                    Text(ask.kind == "initiative" ? "Your initiative modifier" : "Your modifier").font(.footnote)
                    Spacer()
                    TableStepper(value: $modifier)
                }
            }
            HStack(spacing: 8) {
                if ask.kind == "check" && ask.counts == ["d20": 1] {
                    Button { table.answer(ask, mode: .adv, modifier: modifier) } label: {
                        Text("A").font(.headline.weight(.black)).frame(width: 46, height: 40)
                            .background(Color(hex: 0x1F9D55), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Advantage")
                    Button { table.answer(ask, mode: .dis, modifier: modifier) } label: {
                        Text("DA").font(.headline.weight(.black)).frame(width: 46, height: 40)
                            .background(Color(hex: 0xC62828), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Disadvantage")
                }
                Button { table.answer(ask, mode: .normal, modifier: modifier) } label: {
                    Text("Roll").font(.headline.weight(.heavy)).frame(maxWidth: .infinity, minHeight: 40)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
        .foregroundStyle(Color.white)
        .padding(14)
        .background(cardBackground, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(border, lineWidth: 2))
        .shadow(color: .black.opacity(0.5), radius: 16, y: 8)
        .onAppear {
            // Initiative remembers your modifier; checks start at 0.
            if ask.kind == "initiative" && !ready { modifier = table.tray?.initiativeModifier ?? 0 }
            ready = true
        }
        .onChange(of: modifier) { _, value in
            if ask.kind == "initiative" { table.tray?.initiativeModifier = value }
        }
    }

    private var border: Color {
        switch ask.kind {
        case "initiative": return Color(hex: 0xFF8A65)
        case "contest": return Color(hex: 0xFFD27A)
        default: return Color.accentColor
        }
    }
}

/// A finished request, on everyone's screen.
private struct ResultCardView: View {
    @ObservedObject var table: DiceTable
    let card: DiceTable.ResultCard

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Text(card.kind == "contest" ? "🏆 \(card.label)" : "🎲 \(card.label)\(card.dc.map { " · DC \($0)" } ?? "")")
                    .font(.caption2.weight(.heavy)).tracking(0.8).textCase(.uppercase).opacity(0.8)
                Spacer()
                Button { table.dismissResult(card.id) } label: {
                    Image(systemName: "xmark").font(.caption2.weight(.bold)).frame(width: 24, height: 24)
                        .background(Color.white.opacity(0.1), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss")
            }
            if card.kind == "contest" {
                Text(headline).font(.title2.weight(.black)).foregroundStyle(Color(hex: 0xFFD27A))
                ForEach(Array(card.rows.enumerated()), id: \.offset) { i, row in
                    TableResultRow(name: "\(i + 1). \(row.name)", total: row.total, winner: card.winners.contains(row.name))
                }
            } else {
                ForEach(card.rows) { row in
                    TableResultRow(name: row.name, total: row.total, pass: card.dc == nil ? nil : row.pass)
                }
            }
        }
        .foregroundStyle(Color.white)
        .padding(14)
        .background(cardBackground, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.white.opacity(0.16)))
        .shadow(color: .black.opacity(0.5), radius: 16, y: 8)
    }

    private var headline: String {
        if card.winners.count != 1 { return "Tie: \(card.winners.joined(separator: " & "))" }
        let label = card.label.lowercased()
        let verb = label.contains("who pays") ? "pays" : (label.contains("who goes first") ? "goes first" : "wins")
        return "\(card.winners[0]) \(verb)!"
    }
}

/// The turn order at the top of the screen.
private struct TurnStrip: View {
    @ObservedObject var table: DiceTable
    let turns: DiceTable.Turns

    var body: some View {
        let me = table.me
        HStack(spacing: 10) {
            if turns.phase == "rolling" {
                Text("⚔️ Initiative").font(.footnote.weight(.heavy)).opacity(0.85)
                if turns.order.isEmpty { Text("Rolling…").font(.footnote).opacity(0.7) }
                ForEach(turns.order) { turn in
                    HStack(spacing: 4) {
                        Text(turn.name).font(.caption.weight(.bold))
                        Text("\(turn.total)").font(.caption.monospacedDigit())
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.white.opacity(0.1), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.white, lineWidth: turn.peer == me ? 1.5 : 0))
                }
            } else if turns.order.indices.contains(turns.current) {
                let current = turns.order[turns.current]
                let next = turns.order.count > 1 ? turns.order[(turns.current + 1) % turns.order.count] : nil
                let mine = current.peer == me && !me.isEmpty
                Text("Round \(turns.round)").font(.footnote.weight(.heavy)).opacity(0.85)
                Text(mine ? "Your turn!" : "\(current.name)'s turn").font(.footnote.weight(.black))
                if let next {
                    Text(next.peer == me && !me.isEmpty ? "You're next" : "Next: \(next.name)").font(.footnote).opacity(0.8)
                }
                if table.hosting() {
                    TablePill(title: "Next ▶", small: true) { table.stepTurn(1) }
                }
            }
        }
        .lineLimit(1)
        .foregroundStyle(Color.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(stripBackground, in: Capsule())
        .overlay(Capsule().strokeBorder(stripMine ? Color(hex: 0xFFD27A) : Color(hex: 0xFF8A65).opacity(0.6)))
        .shadow(color: .black.opacity(0.45), radius: 10, y: 4)
    }

    private var stripMine: Bool {
        turns.phase == "running" && turns.order.indices.contains(turns.current) && turns.order[turns.current].peer == table.me && !table.me.isEmpty
    }

    private var stripBackground: AnyShapeStyle {
        stripMine
            ? AnyShapeStyle(LinearGradient(colors: [Color(hex: 0x8A4B14), Color(hex: 0xB5651D)], startPoint: .leading, endPoint: .trailing))
            : AnyShapeStyle(cardBackground)
    }
}

/// Request cards and results down the left, the turn order along the top, and
/// a big "Your turn!" when it's yours. Shown over the board, the stage and the tray.
struct TableOverlay: View {
    @ObservedObject var table: DiceTable

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Only the cards themselves take touches; the space around them doesn't.
            VStack(alignment: .leading, spacing: 10) {
                ForEach(table.cards) { ask in
                    AskCard(table: table, ask: ask).transition(.move(edge: .leading).combined(with: .opacity))
                }
                ForEach(table.results) { card in
                    ResultCardView(table: table, card: card).transition(.move(edge: .leading).combined(with: .opacity))
                }
            }
            .frame(maxWidth: 320, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 84)

            if let turns = table.turns {
                TurnStrip(table: table, turns: turns)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            if table.yourTurn {
                VStack(spacing: 2) {
                    Text("Your turn!").font(.system(size: 44, weight: .black, design: .rounded))
                    Text("⚔️ INITIATIVE").font(.footnote.weight(.bold)).tracking(1).opacity(0.85)
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 40)
                .padding(.vertical, 22)
                .background(LinearGradient(colors: [Color(hex: 0xC2410C), Color(hex: 0x7C2D12)], startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 26))
                .overlay(RoundedRectangle(cornerRadius: 26).strokeBorder(Color(hex: 0xFFD27A), lineWidth: 2))
                .shadow(color: .black.opacity(0.6), radius: 24, y: 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .allowsHitTesting(false)
                .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: table.cards.map(\.id))
        .animation(.easeOut(duration: 0.25), value: table.results)
        .animation(.easeOut(duration: 0.25), value: table.turns)
        .animation(.spring(response: 0.3, dampingFraction: 0.6), value: table.yourTurn)
    }
}

// MARK: - The broadcaster's panels (in the dice tray)

private struct PanelTitle: View {
    let text: String
    var body: some View { Text(text).font(.headline).foregroundStyle(Color.white) }
}

private struct FieldLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.caption2.weight(.bold)).tracking(0.6).opacity(0.75).padding(.top, 6)
    }
}

private struct WideButton: View {
    let title: String
    var danger = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.callout.weight(.bold)).frame(maxWidth: .infinity, minHeight: 38)
                .foregroundStyle(danger ? Color(red: 1, green: 0.7, blue: 0.7) : Color.white)
                .background(danger ? Color.black.opacity(0.45) : Color.accentColor, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(danger ? Color(red: 1, green: 0.47, blue: 0.47).opacity(0.5) : Color.clear))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .padding(.top, 8)
    }
}

/// Ask for a roll: what, which dice, the DC, who.
struct AskPanel: View {
    @ObservedObject var table: DiceTable

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PanelTitle(text: "Ask for a roll")
            if let check = table.check {
                VStack(alignment: .leading, spacing: 2) {
                    Text(check.label).font(.subheadline.weight(.bold))
                    Text("\(DiceGeometry.describe(check.counts, modifier: 0))\(check.dc.map { " · DC \($0)\(check.showDC ? "" : " (hidden)")" } ?? "")")
                        .font(.caption).opacity(0.75)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                ForEach(check.results) { r in
                    TableResultRow(name: r.name, total: r.total, pass: check.dc.flatMap { dc in r.total.map { $0 >= dc } }, detail: r.detail)
                }
                let expected = check.to ?? table.peers().map(\.id)
                ForEach(expected.filter { id in !check.results.contains { $0.key == id } }, id: \.self) { id in
                    if let name = table.name(of: id) { TableResultRow(name: name, total: nil, detail: "rolling…", waiting: true) }
                }
                WideButton(title: check.dc != nil && check.showDC ? "Close and show results" : "Close request") { table.closeCheck() }
            } else {
                FieldLabel(text: "What to roll")
                TextField("e.g. Dexterity save", text: $table.draftLabel)
                    .textFieldStyle(.roundedBorder)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(DiceTable.quickChecks, id: \.self) { c in
                            TablePill(title: c.replacingOccurrences(of: " save", with: "").replacingOccurrences(of: " check", with: ""),
                                      small: true, on: table.draftLabel == c) { table.draftLabel = c }
                        }
                    }
                }
                HStack(alignment: .bottom, spacing: 10) {
                    VStack(alignment: .leading) {
                        FieldLabel(text: "Dice")
                        Picker("Dice", selection: $table.draftDice) {
                            ForEach(DiceTable.diceChoices, id: \.0) { Text($0.0).tag($0.0) }
                        }
                        .pickerStyle(.menu)
                    }
                    VStack(alignment: .leading) {
                        FieldLabel(text: "DC")
                        HStack(spacing: 4) {
                            TablePill(title: "−", small: true) { table.draftDC = max(1, (table.draftDC ?? 11) - 1) }
                            Text(table.draftDC.map(String.init) ?? "none").font(.headline.monospacedDigit()).frame(minWidth: 40)
                            TablePill(title: "+", small: true) { table.draftDC = min(40, (table.draftDC ?? 9) + 1) }
                            TablePill(title: "No DC", small: true, on: table.draftDC == nil) { table.draftDC = nil }
                        }
                    }
                }
                Toggle("Show the DC to listeners", isOn: $table.draftShowDC).font(.footnote).tint(Color.accentColor)
                FieldLabel(text: "Who rolls")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        TablePill(title: "Everyone", small: true, on: table.draftTo.isEmpty) { table.draftTo = [] }
                        ForEach(table.peers()) { peer in
                            TablePill(title: peer.name, small: true, on: table.draftTo.contains(peer.id)) {
                                if table.draftTo.contains(peer.id) { table.draftTo.remove(peer.id) } else { table.draftTo.insert(peer.id) }
                            }
                        }
                    }
                }
                if table.peers().isEmpty {
                    Text("Listeners who tune in get a card to roll from.").font(.caption).opacity(0.7)
                }
                WideButton(title: "Send request") { table.sendCheck() }
            }
        }
        .foregroundStyle(Color.white)
    }
}

/// Initiative: enemies, roll, the order, whose turn.
struct InitiativePanel: View {
    @ObservedObject var table: DiceTable

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PanelTitle(text: "Initiative")
            if table.initPhase == "off" {
                Text("Everyone gets a card to roll a d20 plus their initiative modifier. You roll for the enemies. Only each person's first roll counts.")
                    .font(.caption).opacity(0.75)
                FieldLabel(text: "Enemies")
                ForEach($table.enemies) { $enemy in
                    HStack(spacing: 6) {
                        TextField("Name", text: $enemy.name).textFieldStyle(.roundedBorder)
                        TableStepper(value: $enemy.modifier)
                        Button { table.enemies.removeAll { $0.id == enemy.id } } label: {
                            Image(systemName: "xmark").font(.caption.weight(.bold)).padding(6)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove \(enemy.name)")
                    }
                }
                TablePill(title: "＋ Add enemy") { table.addEnemy() }
                WideButton(title: "⚔️ Roll initiative") { table.rollInitiative() }
            } else {
                if table.initPhase == "running" { Text("Round \(table.round)").font(.subheadline.weight(.heavy)).opacity(0.85) }
                ForEach(Array(table.order.enumerated()), id: \.element.id) { i, turn in
                    HStack(spacing: 8) {
                        Text("\(i + 1)").font(.caption.monospacedDigit()).opacity(0.6).frame(width: 18)
                        Text(turn.name).font(.subheadline.weight(.bold))
                            .foregroundStyle(turn.enemy ? Color(red: 1, green: 0.7, blue: 0.63) : Color.white)
                        Spacer()
                        Text(signed(turn.modifier)).font(.caption).opacity(0.7)
                        Text("\(turn.total)").font(.headline.weight(.black).monospacedDigit())
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(table.initPhase == "running" && i == table.current ? Color.accentColor.opacity(0.55) : Color.white.opacity(0.07),
                                in: RoundedRectangle(cornerRadius: 10))
                }
                if table.initPhase == "rolling" {
                    ForEach(table.waitingForInitiative) { peer in
                        TableResultRow(name: peer.name, total: nil, detail: "rolling…", waiting: true)
                    }
                    WideButton(title: "▶ Start", disabled: table.order.isEmpty) { table.startTurns() }
                } else {
                    HStack(spacing: 8) {
                        TablePill(title: "◀ Back") { table.stepTurn(-1) }
                        WideButton(title: "Next turn ▶") { table.stepTurn(1) }
                    }
                }
                WideButton(title: "End initiative", danger: true) { table.endTurns() }
            }
        }
        .foregroundStyle(Color.white)
    }
}

/// Who goes first / who pays: everyone rolls, the highest (or lowest) wins.
struct ContestPanel: View {
    @ObservedObject var table: DiceTable

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PanelTitle(text: "Who wins?")
            if let contest = table.contest {
                Text(contest.label).font(.subheadline.weight(.bold))
                ForEach(contest.results) { r in TableResultRow(name: r.name, total: r.total, detail: r.detail) }
                ForEach((contest.to ?? table.peers().map(\.id)).filter { id in !contest.results.contains { $0.key == id } }, id: \.self) { id in
                    if let name = table.name(of: id) { TableResultRow(name: name, total: nil, detail: "rolling…", waiting: true) }
                }
                WideButton(title: "Finish now") { table.finishContest() }
            } else {
                if let last = table.lastContest, last.winners.count > 1 {
                    Text("Tie: \(last.winners.joined(separator: " and "))").font(.subheadline.weight(.heavy)).foregroundStyle(Color(hex: 0xFFD27A))
                    WideButton(title: "🎲 Roll-off") { table.rollOff() }
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(DiceTable.contests, id: \.self) { c in
                            TablePill(title: c, small: true, on: table.contestLabel == c) { table.contestLabel = c }
                        }
                    }
                }
                FieldLabel(text: "Question")
                TextField("Who wins?", text: $table.contestLabel).textFieldStyle(.roundedBorder)
                Picker("Winner", selection: $table.contestLowest) {
                    Text("Highest wins").tag(false)
                    Text("Lowest wins").tag(true)
                }
                .pickerStyle(.segmented)
                .padding(.top, 6)
                Toggle("I roll too", isOn: $table.contestIncludeMe).font(.footnote).tint(Color.accentColor)
                WideButton(title: "🎲 Everyone roll") {
                    let label = table.contestLabel.trimmingCharacters(in: .whitespaces)
                    table.startContest(label: label.isEmpty ? "Who wins?" : label, lowest: table.contestLowest, to: nil, includeMe: table.contestIncludeMe)
                }
            }
        }
        .foregroundStyle(Color.white)
    }
}
