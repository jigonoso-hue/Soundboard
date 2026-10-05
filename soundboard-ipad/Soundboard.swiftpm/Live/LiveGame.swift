import Foundation

/// Games the broadcaster runs for everyone in a Live Session: a buzzer and a
/// quiz. The host keeps the game and decides everything (who buzzed first,
/// which answers are right, the scores), so listeners can't cheat by sending
/// anything else. While a game runs, listeners' screens are locked to it.
/// A copy of the Mac app's src/game.js; keep the two the same.
///
/// Buzzer: the broadcaster arms it; listeners press; the order is by when each
/// press happened (in the host's clock), not when it arrived.
/// Quiz: a question with 2–4 answers, an optional right answer (none: a vote)
/// and an optional time limit. Right answers score up to 1000 points, more for
/// answering fast; scores add up over the quiz.
final class LiveGame {
    static let kinds = ["buzzer", "quiz"]
    static let timers = [0, 10, 20, 30, 60]

    struct Buzz {
        let peer: String
        let name: String
        let ms: Int
    }

    struct Question {
        let text: String
        let answers: [String]
        let correct: Int?
        let timer: Int
        let startedAt: Double
        let endsAt: Double
    }

    struct Answer {
        let name: String
        let choice: Int
        let ms: Int
    }

    struct Score {
        var name: String
        var score = 0
        var right = 0
    }

    let id: String
    let kind: String
    var phase: String
    var round = 0
    // Buzzer
    var armedAt: Double = 0
    var buzzes: [Buzz] = []
    // Quiz
    var n = 0
    var question: Question?
    var answers: [String: Answer] = [:]
    var answerOrder: [String] = []
    var scores: [String: Score] = [:]
    var points: [String: Int] = [:]

    init?(kind: String, now: Double = LiveNet.now) {
        guard Self.kinds.contains(kind) else { return nil }
        self.kind = kind
        id = "game-\(String(Int(now), radix: 36))-\(UUID().uuidString.prefix(4).lowercased())"
        phase = kind == "buzzer" ? "waiting" : "lobby"
    }

    /// Points for a right answer: up to 1000, less the longer it took.
    static func points(ms: Int, timer: Int) -> Int {
        if timer > 0 { return Int((1000 * (1 - 0.5 * min(1, Double(ms) / Double(timer * 1000)))).rounded()) }
        return max(500, Int((1000 - Double(ms) / 20).rounded()))
    }

    /// A command from the broadcaster. Returns true if the game changed.
    func control(_ cmd: LiveJSON, now: Double = LiveNet.now) -> Bool {
        let action = LiveNet.string(cmd["action"]) ?? ""
        if kind == "buzzer" {
            switch action {
            case "arm":
                phase = "armed"
                armedAt = now
                buzzes = []
                round += 1
                return true
            case "reset":
                phase = "waiting"
                armedAt = 0
                buzzes = []
                return true
            default:
                return false
            }
        }
        switch action {
        case "ask":
            let raw = ((cmd["answers"] as? [Any]) ?? []).compactMap { LiveNet.string($0) }
            let answers = Array(raw.map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)) }.filter { !$0.isEmpty }.prefix(4))
            guard answers.count >= 2 else { return false }
            var correct: Int?
            if let c = LiveNet.number(cmd["correct"]), c == c.rounded(), Int(c) >= 0, Int(c) < answers.count { correct = Int(c) }
            let t = Int(LiveNet.number(cmd["timer"]) ?? 0)
            let timer = Self.timers.contains(t) ? t : 0
            let text = String((LiveNet.string(cmd["text"]) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
            n += 1
            question = Question(text: text.isEmpty ? "Question" : text, answers: answers, correct: correct, timer: timer,
                                startedAt: now, endsAt: timer > 0 ? now + Double(timer * 1000) : 0)
            self.answers.removeAll()
            answerOrder = []
            points = [:]
            phase = "question"
            return true
        case "reveal":
            return reveal()
        case "final":
            if phase == "question" { _ = reveal() }
            phase = "final"
            return true
        case "lobby":
            phase = "lobby"
            return true
        default:
            return false
        }
    }

    /// Ends a question: right answers score.
    func reveal() -> Bool {
        guard kind == "quiz", phase == "question", let q = question else { return false }
        points = [:]
        for peer in answerOrder {
            guard let a = answers[peer] else { continue }
            let right = q.correct != nil && a.choice == q.correct
            let got = right ? Self.points(ms: a.ms, timer: q.timer) : 0
            points[peer] = got
            var s = scores[peer] ?? Score(name: a.name)
            s.name = a.name
            s.score += got
            if right { s.right += 1 }
            scores[peer] = s
        }
        phase = "reveal"
        return true
    }

    /// A listener's press or answer. `at` is when it happened in the host's
    /// clock (from the listener's clock sync); it's kept between the start and
    /// now. expected: how many listeners can answer (all answered → the
    /// question ends). Returns true if the game changed.
    func input(peer: String, name: String, _ msg: LiveJSON, now: Double = LiveNet.now, expected: Int = .max) -> Bool {
        guard LiveNet.string(msg["id"]) == id else { return false }
        let at = LiveNet.number(msg["at"]).flatMap { $0.isFinite ? $0 : nil } ?? now
        if kind == "buzzer" {
            guard phase == "armed", (msg["buzz"] as? Bool) == true, !buzzes.contains(where: { $0.peer == peer }) else { return false }
            let ms = Int(min(now - armedAt, max(0, at - armedAt)).rounded())
            buzzes.append(Buzz(peer: peer, name: name, ms: ms))
            buzzes.sort { $0.ms < $1.ms }
            return true
        }
        guard phase == "question", let q = question, Int(LiveNet.number(msg["q"]) ?? -1) == n, answers[peer] == nil,
              let c = LiveNet.number(msg["choice"]), c == c.rounded(), Int(c) >= 0, Int(c) < q.answers.count else { return false }
        let ms = Int(min(now - q.startedAt, max(0, at - q.startedAt)).rounded())
        if q.timer > 0 && ms > q.timer * 1000 + 500 { return false }
        answers[peer] = Answer(name: name, choice: Int(c), ms: ms)
        answerOrder.append(peer)
        if answers.count >= expected { _ = reveal() }
        return true
    }

    private var leaderboard: [LiveJSON] {
        scores.map { peer, s in ["peer": peer, "name": s.name, "score": s.score, "right": s.right] as LiveJSON }
            .sorted { a, b in
                let x = (a["score"] as? Int) ?? 0
                let y = (b["score"] as? Int) ?? 0
                if x != y { return x > y }
                return ((a["name"] as? String) ?? "") < ((b["name"] as? String) ?? "")
            }
    }

    /// What everyone sees. Before the reveal nobody learns the right answer or
    /// who chose what. `now` turns the deadline into time left.
    static func publicView(_ game: LiveGame?, now: Double = LiveNet.now) -> LiveJSON {
        guard let game else { return ["t": "game", "phase": "off"] }
        var view: LiveJSON = ["t": "game", "id": game.id, "kind": game.kind, "phase": game.phase, "round": game.round]
        if game.kind == "buzzer" {
            view["buzzes"] = game.buzzes.map { ["peer": $0.peer, "name": $0.name, "ms": $0.ms] as LiveJSON }
            return view
        }
        view["n"] = game.n
        view["answered"] = game.answers.count
        if let q = game.question {
            view["question"] = [
                "text": q.text, "answers": q.answers, "timer": q.timer,
                "left": q.endsAt > 0 ? max(0, q.endsAt - now) : 0, "vote": q.correct == nil,
            ] as LiveJSON
            if game.phase == "reveal" || game.phase == "final" {
                view["correct"] = q.correct.map { $0 as Any } ?? NSNull()
                view["counts"] = q.answers.indices.map { i in game.answers.values.filter { $0.choice == i }.count }
                view["results"] = game.answerOrder.compactMap { peer -> LiveJSON? in
                    guard let a = game.answers[peer] else { return nil }
                    return ["peer": peer, "choice": a.choice, "points": game.points[peer] ?? 0]
                }
            }
        }
        if game.phase != "question" { view["leaderboard"] = Array(game.leaderboard.prefix(10)) }
        return view
    }

    /// What the broadcaster sees: everything, including who has answered what so far.
    static func hostView(_ game: LiveGame?, now: Double = LiveNet.now) -> LiveJSON {
        var view = publicView(game, now: now)
        guard let game, game.kind == "quiz" else { return view }
        if let q = game.question { view["correct"] = q.correct.map { $0 as Any } ?? NSNull() }
        view["answers"] = game.answerOrder.compactMap { peer -> LiveJSON? in
            guard let a = game.answers[peer] else { return nil }
            return ["peer": peer, "name": a.name, "choice": a.choice, "ms": a.ms]
        }
        view["leaderboard"] = Array(game.leaderboard.prefix(10))
        return view
    }
}
