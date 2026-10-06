package com.dungeonradio.live

import org.json.JSONArray
import org.json.JSONObject

/**
 * Dice rolls shared with everyone in a session (PROTOCOL.md, Dice): the checks
 * the host makes on a roll before sending it on. A port of cleanRollStart /
 * cleanRollValues in the Mac app's src/live.js and cleanCustom in
 * src/renderer/dice-geometry.js.
 */
object Rolls {
    val DIE_KINDS = mapOf(
        "d4" to (1 to 4), "d6" to (1 to 6), "d8" to (1 to 8), "d10" to (0 to 9), "d10t" to (0 to 9),
        "d12" to (1 to 12), "d20" to (1 to 20), "coin" to (1 to 2),
    )
    val ROLL_TYPES = listOf("d4", "d6", "d8", "d10", "d12", "d20", "d100", "coin", "custom")
    val CUSTOM_SIDES = listOf(4, 6, 8, 10, 12, 20)
    val ROLL_ID = Regex("^[\\w-]{1,60}$")
    const val MAX_ROLL_DICE = 40

    /** The sixteen dice colours. In a session no two people share one. */
    val DICE_COLORS = listOf(
        "#b3261e", "#2a5bd7", "#1f8a5b", "#7b3fbf", "#c47a12", "#1d1d24", "#e8e2d0", "#0f8a8a",
        "#d6457a", "#7cb518", "#e3611c", "#4fb3e8", "#d4a017", "#5b2a6e", "#9aa3ad", "#8a5a2b",
    )

    private fun num(v: Any?, lo: Double, hi: Double): Double {
        val n = LiveNet.number(v) ?: return 0.0
        return if (n.isFinite()) n.coerceIn(lo, hi) else 0.0
    }

    /** A custom die: an id, a name, its sides and one word or number per face. */
    fun cleanCustom(def: Any?): JSONObject? {
        if (def !is JSONObject) return null
        val id = def.str("id") ?: ""
        if (!ROLL_ID.matches(id)) return null
        val sides = def.num("sides")?.takeIf { it == Math.floor(it) }?.toInt() ?: return null
        val faces = def.optJSONArray("faces") ?: return null
        if (sides !in CUSTOM_SIDES) return null
        val out = JSONArray()
        for (i in 0 until sides) {
            val f = faces.opt(i)
            out.put((if (f == null || f == JSONObject.NULL) "" else f.toString()).take(24))
        }
        return jsonOf("id" to id, "name" to (def.str("name")?.ifEmpty { null } ?: "Custom").take(30), "sides" to sides, "faces" to out)
    }

    /** A roll's start, checked: the dice and how they're thrown. */
    fun cleanStart(m: JSONObject): JSONObject? {
        val id = m.str("id") ?: ""
        if (!ROLL_ID.matches(id)) return null
        val kinds = m.optJSONArray("kinds").values().take(MAX_ROLL_DICE).map { it?.toString() ?: "" }
        if (kinds.isEmpty() || !kinds.all { it in DIE_KINDS }) return null
        val dice = m.optJSONArray("dice").values().take(kinds.size).map { raw ->
            val d = raw as? JSONObject ?: JSONObject()
            val p = d.optJSONArray("p"); val v = d.optJSONArray("v"); val w = d.optJSONArray("w"); val q = d.optJSONArray("q")
            jsonOf(
                "p" to JSONArray(listOf(num(p?.opt(0), -1.0, 1.0), num(p?.opt(1), -1.0, 1.0))),
                "h" to num(d.opt("h"), 0.5, 8.0),
                "v" to JSONArray(listOf(num(v?.opt(0), -10.0, 10.0), num(v?.opt(1), -10.0, 10.0))),
                "w" to JSONArray((0..2).map { num(w?.opt(it), -80.0, 80.0) }),
                "q" to JSONArray((0..3).map { num(q?.opt(it), -1.0, 1.0) }),
            )
        }
        if (dice.size != kinds.size) return null
        val custom = m.optJSONArray("custom").values().take(10).mapNotNull { cleanCustom(it) }
        val groups = m.optJSONArray("groups").values().take(MAX_ROLL_DICE).map { raw ->
            val g = raw as? JSONObject ?: JSONObject()
            var type: String? = g.str("type")?.takeIf { it in ROLL_TYPES }
            val members = g.optJSONArray("dice").values().take(2).map { num(it, 0.0, (kinds.size - 1).toDouble()).toInt() }
            val group = JSONObject().put("dice", JSONArray(members))
            if (type == "custom") {
                val die = g.str("die") ?: ""
                group.put("die", die)
                if (custom.none { it.getString("id") == die }) type = null
            }
            group.put("type", type ?: JSONObject.NULL)
            group
        }
        if (groups.isEmpty() || groups.any { it.opt("type") == JSONObject.NULL || it.getJSONArray("dice").length() == 0 }) return null
        val mode = m.str("mode")?.takeIf { it in listOf("normal", "adv", "dis") } ?: "normal"
        val color = m.str("color")?.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) } ?: "#2a5bd7"
        val start = jsonOf(
            "t" to "roll", "id" to id, "kinds" to JSONArray(kinds), "dice" to JSONArray(dice), "groups" to JSONArray(groups),
            "mode" to mode, "modifier" to num(m.opt("modifier"), -99.0, 99.0).toInt(), "color" to color,
            "by" to (m.str("by") ?: "").take(40),
        )
        if (custom.isNotEmpty()) start.put("custom", JSONArray(custom))
        // A roll asked for by the broadcaster (a check, initiative, who goes first).
        m.str("ask")?.takeIf { ROLL_ID.matches(it) }?.let { start.put("ask", it) }
        if (m.opt("hidden") == true) start.put("hidden", true)
        return start
    }

    /** What each die of a roll shows, checked against the dice. */
    fun cleanValues(values: JSONArray?, kinds: JSONArray): List<Int>? {
        if (values == null || values.length() != kinds.length()) return null
        val out = ArrayList<Int>()
        for (i in 0 until values.length()) {
            val n = LiveNet.number(values.opt(i)) ?: return null
            if (!n.isFinite()) return null
            val v = n.toLong().toInt()
            val (lo, hi) = DIE_KINDS[kinds.getString(i)] ?: return null
            if (v < lo || v > hi) return null
            out.add(v)
        }
        return out
    }
}
