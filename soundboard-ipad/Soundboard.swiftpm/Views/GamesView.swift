import SwiftUI
import UIKit

// Games for everyone in a Live Session: a buzzer and a quiz. Only the
// broadcaster starts one (Games in the toolbar), and while it runs every
// listener's screen is locked to it: it sits in its own window above
// everything else, with no way to close it, until the broadcaster ends the
// game. The host decides everything (LiveGame.swift); this draws it.
// Matches the Mac app's games.js.

// MARK: - The game, as a device sees it

struct GameState: Equatable {
    struct Buzz: Equatable, Identifiable {
        let peer: String
        let name: String
        let ms: Int
        var id: String { peer }
    }

    struct Ranked: Equatable, Identifiable {
        let peer: String
        let name: String
        let score: Int
        var id: String { peer }
    }

    struct Question: Equatable {
        let text: String
        let answers: [String]
        let timer: Int
        let vote: Bool
    }

    struct HostAnswer: Equatable, Identifiable {
        let peer: String
        let name: String
        let choice: Int
        var id: String { peer }
    }

    let id: String
    let kind: String
    let phase: String
    let round: Int
    let buzzes: [Buzz]
    let n: Int
    let answered: Int
    let question: Question?
    /// When the question's time runs out, on this device's clock.
    let deadline: Date?
    let correct: Int?
    let counts: [Int]
    let results: [String: (choice: Int, points: Int)]
    let leaderboard: [Ranked]
    /// The broadcaster's view: who has answered what so far.
    let answers: [HostAnswer]

    static func == (a: GameState, b: GameState) -> Bool {
        a.id == b.id && a.phase == b.phase && a.round == b.round && a.buzzes == b.buzzes && a.n == b.n && a.answered == b.answered
            && a.question == b.question && a.correct == b.correct && a.counts == b.counts && a.leaderboard == b.leaderboard && a.answers == b.answers
            && a.results.mapValues { "\($0.choice)/\($0.points)" } == b.results.mapValues { "\($0.choice)/\($0.points)" }
    }

    init?(_ m: LiveJSON) {
        guard let id = LiveNet.string(m["id"]), let kind = LiveNet.string(m["kind"]), let phase = LiveNet.string(m["phase"]), phase != "off" else { return nil }
        self.id = id
        self.kind = kind
        self.phase = phase
        round = Int(LiveNet.number(m["round"]) ?? 0)
        let list = { (key: String) in ((m[key] as? [Any]) ?? []).compactMap { $0 as? LiveJSON } }
        buzzes = list("buzzes").map { Buzz(peer: LiveNet.string($0["peer"]) ?? "", name: LiveNet.string($0["name"]) ?? "Someone", ms: Int(LiveNet.number($0["ms"]) ?? 0)) }
        n = Int(LiveNet.number(m["n"]) ?? 0)
        answered = Int(LiveNet.number(m["answered"]) ?? 0)
        if let q = m["question"] as? LiveJSON {
            question = Question(text: LiveNet.string(q["text"]) ?? "", answers: ((q["answers"] as? [Any]) ?? []).compactMap { LiveNet.string($0) },
                                timer: Int(LiveNet.number(q["timer"]) ?? 0), vote: (q["vote"] as? Bool) ?? false)
            let left = LiveNet.number(q["left"]) ?? 0
            deadline = left > 0 ? Date().addingTimeInterval(left / 1000) : nil
        } else {
            question = nil
            deadline = nil
        }
        correct = LiveNet.number(m["correct"]).map(Int.init)
        counts = ((m["counts"] as? [Any]) ?? []).compactMap { LiveNet.number($0).map(Int.init) }
        var results: [String: (choice: Int, points: Int)] = [:]
        for r in list("results") {
            if let peer = LiveNet.string(r["peer"]) {
                results[peer] = (Int(LiveNet.number(r["choice"]) ?? 0), Int(LiveNet.number(r["points"]) ?? 0))
            }
        }
        self.results = results
        leaderboard = list("leaderboard").map { Ranked(peer: LiveNet.string($0["peer"]) ?? "", name: LiveNet.string($0["name"]) ?? "Someone", score: Int(LiveNet.number($0["score"]) ?? 0)) }
        answers = list("answers").map { HostAnswer(peer: LiveNet.string($0["peer"]) ?? "", name: LiveNet.string($0["name"]) ?? "Someone", choice: Int(LiveNet.number($0["choice"]) ?? 0)) }
    }
}

private let shapes = ["▲", "◆", "●", "■"]
private let answerColors = [Color(hex: 0xE21B3C), Color(hex: 0x1368CE), Color(hex: 0xD89E00), Color(hex: 0x26890C)]

private func ordinal(_ n: Int) -> String {
    let suffix = (11...13).contains(n % 100) ? "th" : (["th", "st", "nd", "rd"] + Array(repeating: "th", count: 6))[n % 10]
    return "\(n)\(suffix)"
}

private func seconds(_ ms: Int) -> String { String(format: "%.2fs", Double(ms) / 1000) }

// MARK: - The lock: a window above everything

/// While a listener has a game, it covers the whole app in a window of its own
/// (above sheets, the stage and the dice), so nothing else can be reached.
@MainActor
final class GameLock {
    static let shared = GameLock()
    private var window: UIWindow?

    func update(_ live: LiveSession) {
        let locked = live.role == .listener && live.game != nil
        if locked && window == nil {
            guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            let host = UIHostingController(rootView: GameLockView().environmentObject(live))
            host.view.backgroundColor = .clear
            window.rootViewController = host
            window.makeKeyAndVisible()
            self.window = window
            UIAccessibility.post(notification: .screenChanged, argument: nil)
        } else if !locked, let window {
            window.isHidden = true
            self.window = nil
        }
    }
}

// MARK: - A listener's screen

struct GameLockView: View {
    @EnvironmentObject private var live: LiveSession

    var body: some View {
        GeometryReader { geo in
            let compact = geo.size.width < 600
            ZStack {
                background.ignoresSafeArea()
                if let game = live.game {
                    ScrollView {
                        VStack(spacing: compact ? 14 : 20) {
                            VStack(spacing: 2) {
                                Text(game.kind == "buzzer" ? "🔔 Buzzer" : "🧠 Quiz").font(.system(size: compact ? 26 : 32, weight: .black))
                                Text("THE BROADCASTER IS RUNNING A GAME").font(.caption2.weight(.bold)).tracking(1).opacity(0.65)
                            }
                            .padding(.top, compact ? 8 : 24)
                            if game.kind == "buzzer" {
                                BuzzerScreen(game: game, compact: compact, width: geo.size.width)
                            } else {
                                QuizScreen(game: game, compact: compact)
                            }
                        }
                        .frame(maxWidth: 820)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, compact ? 16 : 28)
                        .padding(.bottom, 24)
                        .frame(minHeight: geo.size.height)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                }
            }
            .foregroundStyle(Color.white)
        }
        .interactiveDismissDisabled()
        .accessibilityAddTraits(.isModal)
    }

    private var background: some View {
        let buzzer = live.game?.kind == "buzzer"
        return RadialGradient(colors: buzzer ? [Color(hex: 0x4A1010), Color(hex: 0x12060A)] : [Color(hex: 0x3B1D6E), Color(hex: 0x120A24)],
                              center: buzzer ? .center : .top, startRadius: 20, endRadius: 800)
    }
}

/// The big button. Only a touch that starts after it goes live counts: a
/// finger already resting on it doesn't buzz.
private struct BuzzerScreen: View {
    @EnvironmentObject private var live: LiveSession
    let game: GameState
    let compact: Bool
    let width: CGFloat
    @State private var armedSince: Date?
    @State private var touchBegan: Date?
    @State private var early = 0

    var body: some View {
        let mine = game.buzzes.firstIndex { $0.peer == live.myPeerId }
        let armed = game.phase == "armed"
        let pressed = mine != nil || live.buzzedRounds.contains(game.round)
        let size = min(compact ? 240 : 300, width * 0.62)
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: pressed ? [Color(hex: 0xFFD27A), Color(hex: 0xC48A12)]
                                         : armed ? [Color(hex: 0xFF6B6B), Color(hex: 0xC41818)] : [Color(hex: 0x6B6B78), Color(hex: 0x34343E)],
                                         center: UnitPoint(x: 0.35, y: 0.3), startRadius: 4, endRadius: size * 0.7))
                    .overlay(Circle().strokeBorder(Color.white.opacity(armed ? 0.35 : 0.15), lineWidth: 10))
                    .shadow(color: armed && !pressed ? Color.red.opacity(0.5) : .black.opacity(0.5), radius: 24, y: 12)
                Text(pressed ? (mine.map { ordinal($0 + 1) } ?? "…") : armed ? "BUZZ!" : "Wait…")
                    .font(.system(size: size * 0.2, weight: .black))
                    .foregroundStyle(pressed ? Color(hex: 0x3A2500) : Color.white.opacity(armed ? 1 : 0.75))
            }
            .frame(width: size, height: size)
            .modifier(Shake(amount: CGFloat(early)))
            .animation(.default, value: early)
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        // The moment this touch began, kept for the rest of it.
                        if touchBegan == nil {
                            touchBegan = value.time
                            press(at: value.time)
                        }
                    }
                    .onEnded { _ in touchBegan = nil }
            )
            .accessibilityElement()
            .accessibilityLabel(armed ? "Buzz" : "Buzzer, not live yet")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { press(at: Date()) }
            Text(hint(armed: armed, pressed: pressed, mine: mine))
                .font(compact ? .callout : .body)
                .multilineTextAlignment(.center)
                .opacity(0.85)
                .frame(maxWidth: 520)
            BuzzOrder(buzzes: game.buzzes, me: live.myPeerId)
        }
        .onAppear { syncArmed() }
        .onChange(of: game.round) { _, _ in syncArmed() }
        .onChange(of: game.phase) { _, _ in syncArmed() }
    }

    private func syncArmed() {
        armedSince = game.phase == "armed" ? Date() : nil
    }

    private func press(at time: Date) {
        guard game.phase == "armed", let armedSince else {
            // Too early: a shake, and nothing is sent.
            early += 1
            return
        }
        guard time >= armedSince else { return }
        live.buzz()
    }

    private func hint(armed: Bool, pressed: Bool, mine: Int?) -> String {
        if let mine { return mine == 0 ? "You were first!" : "You were \(ordinal(mine + 1))." }
        if pressed { return "Buzzed!" }
        return armed ? "Press now!" : "Get ready: the buzzer goes live when the broadcaster says so. Pressing early does nothing."
    }
}

private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 10 * sin(amount * .pi * 4), y: 0))
    }
}

private struct BuzzOrder: View {
    let buzzes: [GameState.Buzz]
    let me: String

    var body: some View {
        VStack(spacing: 6) {
            ForEach(Array(buzzes.enumerated()), id: \.element.id) { i, b in
                HStack(spacing: 10) {
                    Text(ordinal(i + 1)).font(.subheadline.weight(.heavy)).opacity(0.75).frame(width: 40, alignment: .leading)
                    Text(b.name).font(.body.weight(.bold)).lineLimit(1)
                    Spacer()
                    Text(i == 0 ? seconds(b.ms) : "+\(seconds(b.ms - buzzes[0].ms))").font(.body.weight(.heavy).monospacedDigit())
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(i == 0 ? Color(hex: 0xFFD27A).opacity(0.28) : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white, lineWidth: b.peer == me ? 2 : 0))
            }
        }
        .frame(maxWidth: 420)
    }
}

private struct QuizScreen: View {
    @EnvironmentObject private var live: LiveSession
    let game: GameState
    let compact: Bool

    var body: some View {
        if game.phase == "lobby" || game.question == nil {
            VStack(spacing: 16) {
                Text(game.n > 0 ? "Next question coming up…" : "Get ready: the first question is coming up…")
                    .font(.title3.weight(.bold)).multilineTextAlignment(.center).padding(.top, 30)
                if !game.leaderboard.isEmpty { Leaderboard(list: game.leaderboard, me: live.myPeerId, max: 5) }
            }
        } else if game.phase == "final" {
            VStack(spacing: 16) {
                Text("🏆 Final scores").font(.title.weight(.black))
                Podium(list: game.leaderboard, me: live.myPeerId, compact: compact)
                Leaderboard(list: game.leaderboard, me: live.myPeerId, max: 10)
            }
        } else if let q = game.question {
            question(q)
        }
    }

    @ViewBuilder
    private func question(_ q: GameState.Question) -> some View {
        let reveal = game.phase == "reveal"
        let chosen = live.myAnswers[game.n]
        VStack(spacing: compact ? 12 : 16) {
            Text("QUESTION \(game.n)\(q.vote ? " · A VOTE" : "")").font(.caption.weight(.heavy)).tracking(1).opacity(0.7)
            Text(q.text)
                .font(.system(size: compact ? 22 : 30, weight: .black))
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.6)
                .foregroundStyle(Color(hex: 0x1D1033))
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 16))
            if !reveal, q.timer > 0, let deadline = game.deadline {
                TimelineView(.periodic(from: .now, by: 0.25)) { context in
                    let left = max(0, deadline.timeIntervalSince(context.date))
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.15))
                            Capsule().fill(LinearGradient(colors: [Color(hex: 0xFFD27A), Color(hex: 0xFF8A65)], startPoint: .leading, endPoint: .trailing))
                                .frame(width: geo.size.width * left / Double(q.timer))
                        }
                    }
                    .frame(height: 12)
                    .overlay(alignment: .trailing) {
                        Text("\(Int(left.rounded(.up)))").font(.caption2.weight(.heavy)).foregroundStyle(Color(hex: 0x1D1033)).padding(.trailing, 6)
                    }
                }
                .frame(height: 12)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(q.answers.indices, id: \.self) { i in
                    Button { live.answer(i) } label: {
                        HStack(spacing: 10) {
                            Text(shapes[i]).font(.system(size: compact ? 20 : 26))
                            Text(q.answers[i]).font(.system(size: compact ? 16 : 20, weight: .heavy)).multilineTextAlignment(.leading)
                                .lineLimit(3).minimumScaleFactor(0.7)
                            Spacer(minLength: 0)
                            if reveal {
                                Text("\(i < game.counts.count ? game.counts[i] : 0)").font(.system(size: compact ? 20 : 24, weight: .black).monospacedDigit())
                            }
                        }
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 14)
                        .frame(maxWidth: .infinity, minHeight: compact ? 72 : 92, alignment: .leading)
                        .background(answerColors[i], in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white, lineWidth: chosen == i || (reveal && game.correct == i) ? 4 : 0))
                        .overlay(alignment: .topTrailing) {
                            if reveal && game.correct == i {
                                Image(systemName: "checkmark.circle.fill").font(.title3).padding(6)
                            }
                        }
                        .opacity(dim(i, chosen: chosen, reveal: reveal) ? 0.35 : 1)
                    }
                    .buttonStyle(.plain)
                    .disabled(reveal || chosen != nil)
                    .accessibilityLabel("\(q.answers[i])\(reveal && game.correct == i ? ", the right answer" : "")")
                }
            }
            if !reveal {
                Text(chosen != nil ? "Answer locked in · \(game.answered) answered" : "\(game.answered) answered").font(.callout).opacity(0.85)
            } else {
                let mine = game.results[live.myPeerId]
                let good = (mine?.points ?? 0) > 0
                Text(resultText(q, mine))
                    .font(.title3.weight(.black))
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(good ? Color(hex: 0x26890C) : Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                if !q.vote && !game.leaderboard.isEmpty { Leaderboard(list: game.leaderboard, me: live.myPeerId, max: 5) }
            }
        }
    }

    private func dim(_ i: Int, chosen: Int?, reveal: Bool) -> Bool {
        if reveal, let correct = game.correct { return correct != i }
        if let chosen { return chosen != i }
        return false
    }

    private func resultText(_ q: GameState.Question, _ mine: (choice: Int, points: Int)?) -> String {
        guard let mine else { return "You didn't answer." }
        if q.vote, mine.choice < q.answers.count { return "You voted \(shapes[mine.choice]) \(q.answers[mine.choice])." }
        return mine.points > 0 ? "Correct! +\(mine.points)" : "Not this time."
    }
}

private struct Leaderboard: View {
    let list: [GameState.Ranked]
    let me: String
    let max: Int

    var body: some View {
        let top = Array(list.prefix(max))
        VStack(spacing: 6) {
            ForEach(Array(top.enumerated()), id: \.element.id) { i, p in row(i, p) }
            if !top.contains(where: { $0.peer == me }), let at = list.firstIndex(where: { $0.peer == me }) {
                row(at, list[at])
            }
        }
        .frame(maxWidth: 420)
    }

    private func row(_ i: Int, _ p: GameState.Ranked) -> some View {
        HStack(spacing: 10) {
            Text("\(i + 1)").font(.subheadline.weight(.heavy)).opacity(0.75).frame(width: 28, alignment: .leading)
            Text(p.name).font(.body.weight(.bold)).lineLimit(1)
            Spacer()
            Text("\(p.score)").font(.body.weight(.heavy).monospacedDigit())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white, lineWidth: p.peer == me ? 2 : 0))
    }
}

private struct Podium: View {
    let list: [GameState.Ranked]
    let me: String
    let compact: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            ForEach([1, 0, 2], id: \.self) { i in
                if i < list.count {
                    let p = list[i]
                    VStack(spacing: 4) {
                        Text(p.name).font(.headline.weight(.black)).lineLimit(1).underline(p.peer == me)
                        Text("\(p.score)").font(.caption.monospacedDigit()).opacity(0.8)
                        Text("\(i + 1)")
                            .font(.system(size: 30, weight: .black))
                            .foregroundStyle(Color(hex: 0x1D1033))
                            .frame(maxWidth: .infinity)
                            .frame(height: (compact ? 0.8 : 1) * [150, 110, 80][i])
                            .background([Color(hex: 0xFFD27A), Color(hex: 0xD7DBE2), Color(hex: 0xE0A26A)][i],
                                        in: UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12))
                    }
                    .frame(width: compact ? 100 : 130)
                }
            }
        }
    }
}

// MARK: - The broadcaster's sheet

struct GameHostView: View {
    @EnvironmentObject private var live: LiveSession
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var answers = ["", "", "", ""]
    @State private var correct: Int? = 0
    @State private var timer = 20

    var body: some View {
        NavigationStack {
            Form {
                if let game = live.game {
                    if game.kind == "buzzer" { buzzer(game) } else { quiz(game) }
                    Section {
                        Button("End game", role: .destructive) {
                            live.gameControl("end")
                            dismiss()
                        }
                    } footer: {
                        Text("Ending unlocks everyone's screens. Done keeps the game running while you use the soundboard.")
                    }
                } else {
                    chooser
                }
            }
            .navigationTitle(live.game.map { $0.kind == "buzzer" ? "🔔 Buzzer" : "🧠 Quiz" } ?? "Games")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.large])
    }

    private var chooser: some View {
        Section {
            choice("🔔 Buzzer", "Everyone gets a big button. Arm it and see who pressed first, in order. Pressing early or holding it down doesn't count.", "buzzer")
            choice("🧠 Quiz", "Ask questions with up to four answers. Right answers score more for speed, with a live leaderboard. Or leave out the right answer for a vote.", "quiz")
        } footer: {
            Text(live.peers.isEmpty ? "No one has tuned in yet." : "Starting a game locks every listener's screen to it until you end it.")
        }
    }

    private func choice(_ title: String, _ detail: String, _ kind: String) -> some View {
        Button { live.gameControl("start", ["kind": kind]) } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func buzzer(_ game: GameState) -> some View {
        let armed = game.phase == "armed"
        Section {
            HStack {
                Text(armed ? "Live · round \(game.round)" : "Waiting")
                    .font(.caption.weight(.heavy))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(armed ? Color(hex: 0xC41818) : Color.secondary.opacity(0.2), in: Capsule())
                    .foregroundStyle(armed ? Color.white : Color.primary)
                Spacer()
                Text(armed ? "\(game.buzzes.count) of \(live.peers.count) buzzed" : "").font(.footnote).foregroundStyle(.secondary)
            }
            Button(armed ? "Arm again" : "Arm buzzer") { live.gameControl("arm") }
                .font(.headline)
            if armed { Button("Reset") { live.gameControl("reset") } }
        } footer: {
            Text(armed ? "Listeners can press now." : "Listeners see \"Wait…\" until you arm it.")
        }
        if !game.buzzes.isEmpty {
            Section("Order") {
                ForEach(Array(game.buzzes.enumerated()), id: \.element.id) { i, b in
                    HStack {
                        Text(ordinal(i + 1)).foregroundStyle(.secondary).frame(width: 40, alignment: .leading)
                        Text(b.name).bold()
                        Spacer()
                        Text(i == 0 ? seconds(b.ms) : "+\(seconds(b.ms - game.buzzes[0].ms))").monospacedDigit()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func quiz(_ game: GameState) -> some View {
        if game.phase == "question", let q = game.question {
            Section {
                Text(q.text).font(.headline)
                if q.timer > 0, let deadline = game.deadline {
                    TimelineView(.periodic(from: .now, by: 0.5)) { context in
                        Text("\(Int(max(0, deadline.timeIntervalSince(context.date)).rounded(.up)))s left").monospacedDigit().foregroundStyle(.secondary)
                    }
                }
                bars(q, counts: q.answers.indices.map { i in game.answers.filter { $0.choice == i }.count }, correct: game.correct)
                Text("\(game.answered) of \(live.peers.count) answered\(game.answers.isEmpty ? "" : ": " + game.answers.map(\.name).joined(separator: ", "))")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Show answer") { live.gameControl("reveal") }.font(.headline)
            } header: {
                Text("Question \(game.n)")
            }
        } else {
            if game.phase == "reveal", let q = game.question {
                Section("Question \(game.n) · answer shown") {
                    Text(q.text).font(.headline)
                    bars(q, counts: game.counts, correct: game.correct)
                }
            }
            if !game.leaderboard.isEmpty {
                Section("Scores") {
                    ForEach(Array(game.leaderboard.prefix(5).enumerated()), id: \.element.id) { i, p in
                        HStack {
                            Text("\(i + 1)").foregroundStyle(.secondary).frame(width: 24, alignment: .leading)
                            Text(p.name).bold()
                            Spacer()
                            Text("\(p.score)").monospacedDigit()
                        }
                    }
                }
            }
            if game.phase == "final" {
                Section {
                    Button("Keep playing") { live.gameControl("lobby") }
                } footer: {
                    Text("Final scores are on every screen.")
                }
            } else {
                editor(game)
                if game.phase == "reveal" {
                    Section { Button("Final scores") { live.gameControl("final") } }
                }
            }
        }
    }

    private func bars(_ q: GameState.Question, counts: [Int], correct: Int?) -> some View {
        let most = Swift.max(1, counts.max() ?? 1)
        return VStack(spacing: 6) {
            ForEach(q.answers.indices, id: \.self) { i in
                let count = i < counts.count ? counts[i] : 0
                HStack {
                    Text("\(shapes[i]) \(q.answers[i])\(correct == i ? " ✓" : "")").fontWeight(.semibold).lineLimit(1)
                    Spacer()
                    Text("\(count)").bold().monospacedDigit()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(alignment: .leading) {
                    GeometryReader { geo in
                        answerColors[i].opacity(0.45).frame(width: geo.size.width * CGFloat(count) / CGFloat(most))
                    }
                }
                .background(Color.secondary.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(answerColors[i], lineWidth: correct == i ? 2 : 0))
            }
        }
    }

    @ViewBuilder
    private func editor(_ game: GameState) -> some View {
        Section {
            TextField("Question, e.g. Who was the innkeeper in session one?", text: $text, axis: .vertical)
            ForEach(0..<4, id: \.self) { i in
                HStack(spacing: 10) {
                    Text(shapes[i]).foregroundStyle(answerColors[i]).font(.title3)
                    TextField(i < 2 ? "Answer \(i + 1)" : "Answer \(i + 1) (optional)", text: $answers[i])
                    if correct != nil {
                        Button {
                            correct = i
                        } label: {
                            Image(systemName: correct == i ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(correct == i ? Color.green : Color.secondary)
                                .font(.title3)
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(correct == i ? "The right answer" : "Make this the right answer")
                    }
                }
            }
            Toggle("No right answer (a vote)", isOn: Binding(get: { correct == nil }, set: { correct = $0 ? nil : 0 }))
            Picker("Time limit", selection: $timer) {
                Text("None").tag(0)
                Text("10 seconds").tag(10)
                Text("20 seconds").tag(20)
                Text("30 seconds").tag(30)
                Text("1 minute").tag(60)
            }
            // On a narrow iPhone the label goes, and the two buttons share the row.
            ViewThatFits(in: .horizontal) {
                HStack {
                    Text("Quick answers").foregroundStyle(.secondary)
                    Spacer()
                    quickAnswers
                }
                HStack { quickAnswers }
            }
            Button("Ask everyone") { ask() }
                .font(.headline)
                .disabled(answers.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count < 2)
        } header: {
            Text(game.n > 0 ? "Next question" : "First question")
        } footer: {
            Text("Tick the right answer: right answers score up to 1000 points, more for answering fast.")
        }
    }

    @ViewBuilder
    private var quickAnswers: some View {
        Button("Yes / No") { answers = ["Yes", "No", "", ""] }.buttonStyle(.bordered).fixedSize()
        Button("True / False") { answers = ["True", "False", "", ""] }.buttonStyle(.bordered).fixedSize()
    }

    private func ask() {
        // Answers keep their places, so the right one stays right.
        let kept = answers.enumerated().map { ($0.element.trimmingCharacters(in: .whitespaces), $0.offset) }.filter { !$0.0.isEmpty }
        guard kept.count >= 2 else { return }
        var cmd: LiveJSON = ["text": text, "answers": kept.map(\.0), "timer": timer]
        if let correct, let index = kept.firstIndex(where: { $0.1 == correct }) { cmd["correct"] = index }
        live.gameControl("ask", cmd)
        text = ""
        answers = ["", "", "", ""]
    }
}
