package com.dungeonradio.live

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * Games the broadcaster runs for everyone in a Live Session: a buzzer and a
 * quiz. The host keeps the game and decides everything (who buzzed first,
 * which answers are right, the scores), so listeners can't cheat. A port of
 * the Mac app's src/game.js and the iPhone app's Live/LiveGame.swift; keep
 * the three the same.
 */
class Game private constructor(val id: String, val kind: String) {
    var round = 0
    var phase = if (kind == "buzzer") "waiting" else "lobby"

    // Buzzer
    var armedAt = 0L
    val buzzes = ArrayList<Buzz>()

    // Quiz
    var n = 0
    var question: Question? = null
    var answers = LinkedHashMap<String, Answer>()
    val scores = LinkedHashMap<String, Score>()
    var points = HashMap<String, Int>()

    data class Buzz(val peer: String, val name: String, val ms: Long)
    data class Answer(val name: String, val choice: Int, val ms: Long)
    data class Score(var name: String, var score: Int, var right: Int)
    class Question(
        val text: String, val answers: List<String>, val correct: Int?, val timer: Int,
        val startedAt: Long, val endsAt: Long,
    )

    companion object {
        val KINDS = listOf("buzzer", "quiz")
        val TIMERS = listOf(0, 10, 20, 30, 60)

        fun create(kind: String?, now: Long = LiveNet.now()): Game? {
            if (kind !in KINDS) return null
            val id = "game-${now.toString(36)}-${Random.nextLong(0, Long.MAX_VALUE).toString(36).take(4)}"
            return Game(id, kind!!)
        }

        /** Points for a right answer: up to 1000, less the longer it took. */
        fun points(ms: Long, timer: Int): Int =
            if (timer > 0) (1000 * (1 - 0.5 * minOf(1.0, ms / (timer * 1000.0)))).roundToInt()
            else maxOf(500, (1000 - ms / 20.0).roundToInt())

        private fun clean(text: Any?, max: Int) =
            (if (text == null || text == JSONObject.NULL) "" else text.toString()).trim().take(max)
    }

    /** A command from the broadcaster. Returns true if the game changed. */
    fun control(cmd: JSONObject, now: Long = LiveNet.now()): Boolean {
        val action = cmd.str("action")
        if (kind == "buzzer") {
            when (action) {
                "arm" -> { phase = "armed"; armedAt = now; buzzes.clear(); round += 1; return true }
                "reset" -> { phase = "waiting"; armedAt = 0; buzzes.clear(); return true }
            }
            return false
        }
        when (action) {
            "ask" -> {
                val list = cmd.optJSONArray("answers").values().map { clean(it, 80) }.filter { it.isNotEmpty() }.take(4)
                if (list.size < 2) return false
                val c = cmd.intOrNull("correct")
                val correct = if (c != null && c >= 0 && c < list.size) c else null
                val t = cmd.num("timer")?.toInt()
                val timer = if (t != null && t in TIMERS && cmd.num("timer") == t.toDouble()) t else 0
                n += 1
                question = Question(clean(cmd.opt("text"), 200).ifEmpty { "Question" }, list, correct, timer,
                    now, if (timer > 0) now + timer * 1000L else 0)
                answers = LinkedHashMap()
                points = HashMap()
                phase = "question"
                return true
            }
            "reveal" -> return reveal()
            "final" -> { if (phase == "question") reveal(); phase = "final"; return true }
            "lobby" -> { phase = "lobby"; return true }
        }
        return false
    }

    /** Ends a question: right answers score. */
    fun reveal(): Boolean {
        if (kind != "quiz" || phase != "question") return false
        val q = question ?: return false
        points = HashMap()
        for ((peer, a) in answers) {
            val right = q.correct != null && a.choice == q.correct
            val got = if (right) points(a.ms, q.timer) else 0
            points[peer] = got
            val s = scores.getOrPut(peer) { Score(a.name, 0, 0) }
            s.name = a.name
            s.score += got
            if (right) s.right += 1
        }
        phase = "reveal"
        return true
    }

    /**
     * A listener's press or answer. `at` is when it happened in the host's
     * clock; it's kept between the start and now. expected: how many listeners
     * can answer (all answered → the question ends). True if the game changed.
     */
    fun input(peer: String, name: String, msg: JSONObject, now: Long = LiveNet.now(), expected: Int = Int.MAX_VALUE): Boolean {
        if (msg.str("id") != id) return false
        val at = msg.num("at")?.takeIf { it.isFinite() }?.toLong() ?: now
        if (kind == "buzzer") {
            if (phase != "armed" || msg.opt("buzz") != true || buzzes.any { it.peer == peer }) return false
            val ms = minOf(now - armedAt, maxOf(0, at - armedAt))
            buzzes.add(Buzz(peer, name, ms))
            buzzes.sortBy { it.ms }
            return true
        }
        val q = question ?: return false
        if (phase != "question" || msg.intOrNull("q") != n || answers.containsKey(peer)) return false
        val choice = msg.intOrNull("choice") ?: return false
        if (choice < 0 || choice >= q.answers.size) return false
        val ms = minOf(now - q.startedAt, maxOf(0, at - q.startedAt))
        if (q.timer > 0 && ms > q.timer * 1000L + 500) return false
        answers[peer] = Answer(name, choice, ms)
        if (answers.size >= expected) reveal()
        return true
    }

    fun leaderboard(): List<JSONObject> =
        scores.entries.map { (peer, s) -> jsonOf("peer" to peer, "name" to s.name, "score" to s.score, "right" to s.right) }
            .sortedWith(compareByDescending<JSONObject> { it.getInt("score") }.thenBy { it.getString("name") })
}

object GameViews {
    /** What everyone sees. Before the reveal nobody learns the right answer or who chose what. */
    fun publicView(game: Game?, now: Long = LiveNet.now()): JSONObject {
        if (game == null) return jsonOf("t" to "game", "phase" to "off")
        val view = jsonOf("t" to "game", "id" to game.id, "kind" to game.kind, "phase" to game.phase, "round" to game.round)
        if (game.kind == "buzzer") {
            view.put("buzzes", JSONArray(game.buzzes.map { jsonOf("peer" to it.peer, "name" to it.name, "ms" to it.ms) }))
            return view
        }
        view.put("n", game.n).put("answered", game.answers.size)
        val q = game.question
        if (q != null) {
            view.put("question", jsonOf("text" to q.text, "answers" to JSONArray(q.answers), "timer" to q.timer,
                "left" to (if (q.endsAt > 0) maxOf(0, q.endsAt - now) else 0), "vote" to (q.correct == null)))
        }
        if (q != null && (game.phase == "reveal" || game.phase == "final")) {
            view.put("correct", q.correct ?: JSONObject.NULL)
            view.put("counts", JSONArray(q.answers.indices.map { i -> game.answers.values.count { it.choice == i } }))
            view.put("results", JSONArray(game.answers.map { (peer, a) ->
                jsonOf("peer" to peer, "choice" to a.choice, "points" to (game.points[peer] ?: 0)) }))
        }
        if (game.phase != "question") view.put("leaderboard", JSONArray(game.leaderboard().take(10)))
        return view
    }

    /** What the broadcaster sees: everything, including who has answered what so far. */
    fun hostView(game: Game?, now: Long = LiveNet.now()): JSONObject {
        val view = publicView(game, now)
        if (game == null || game.kind != "quiz") return view
        game.question?.let { view.put("correct", it.correct ?: JSONObject.NULL) }
        view.put("answers", JSONArray(game.answers.map { (peer, a) ->
            jsonOf("peer" to peer, "name" to a.name, "choice" to a.choice, "ms" to a.ms) }))
        view.put("leaderboard", JSONArray(game.leaderboard().take(10)))
        return view
    }
}
