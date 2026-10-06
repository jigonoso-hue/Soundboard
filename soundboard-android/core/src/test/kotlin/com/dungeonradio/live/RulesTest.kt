package com.dungeonradio.live

import org.json.JSONObject
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The protocol's checks and the game rules, matching the Mac app's tests. */
class RulesTest {
    @Test fun relayUrls() {
        assertEquals("wss://relay.example.com/live", LiveNet.relayUrl("relay.example.com"))
        assertEquals("wss://relay.example.com/live", LiveNet.relayUrl("https://relay.example.com/"))
        assertEquals("ws://127.0.0.1:8787/live", LiveNet.relayUrl("http://127.0.0.1:8787"))
        assertEquals("wss://x.io/live", LiveNet.relayUrl("wss://x.io/live"))
        assertNull(LiveNet.relayUrl("  "))
        assertEquals("wss://soundboard-r1zt.onrender.com/live?role=listen&code=K7QX2",
            LiveListener.relayListenUrl(LiveNet.DEFAULT_RELAY, "k7-qx2"))
    }

    @Test fun pictures() {
        val jpeg = Base64.getEncoder().encodeToString(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 1, 2, 3))
        val png = Base64.getEncoder().encodeToString(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 9))
        assertEquals(jpeg, LiveNet.cleanAvatar(jpeg))
        assertEquals(png, LiveNet.cleanAvatar(png))
        assertEquals("", LiveNet.cleanAvatar(""))
        assertEquals("", LiveNet.cleanAvatar(JSONObject.NULL))
        assertNull(LiveNet.cleanAvatar(Base64.getEncoder().encodeToString("hello".toByteArray())))
        assertNull(LiveNet.cleanAvatar("not base64!"))
        val big = Base64.getEncoder().encodeToString(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte()) + ByteArray(40 * 1024))
        assertNull(LiveNet.cleanAvatar(big), "at most 32 KB")
    }

    @Test fun fadesAndTitles() {
        assertEquals(0.0, LiveNet.fadeSeconds(-2))
        assertEquals(10.0, LiveNet.fadeSeconds(40))
        assertEquals(3.0, LiveNet.fadeSeconds("3"))
        assertEquals("The Old Map", LiveNet.cleanTitle("The\nOld Map"))
        assertEquals(60, LiveNet.cleanTitle("x".repeat(90)).length)
    }

    @Test fun rollChecks() {
        val good = JSONObject("""{"id":"r1","kinds":["d20","d6"],"dice":[{},{}],"groups":[{"type":"d20","dice":[0]},{"type":"d6","dice":[1]}],"modifier":250,"color":"bad","hidden":true}""")
        val start = Rolls.cleanStart(good)
        assertNotNull(start)
        assertEquals(99, start.getInt("modifier"))
        assertEquals("#2a5bd7", start.getString("color"))
        assertNull(Rolls.cleanStart(JSONObject("""{"id":"r1","kinds":["d7"],"dice":[{}],"groups":[{"type":"d20","dice":[0]}]}""")))
        assertNull(Rolls.cleanStart(JSONObject("""{"id":"bad id!","kinds":["d20"],"dice":[{}],"groups":[{"type":"d20","dice":[0]}]}""")))
        assertEquals(listOf(20, 1), Rolls.cleanValues(org.json.JSONArray(listOf(20, 1)), start.getJSONArray("kinds")))
        assertNull(Rolls.cleanValues(org.json.JSONArray(listOf(21, 1)), start.getJSONArray("kinds")))
        val custom = Rolls.cleanCustom(JSONObject("""{"id":"fate","name":"Fate","sides":6,"faces":["+","+","","","-","-"]}"""))
        assertNotNull(custom)
        assertNull(Rolls.cleanCustom(JSONObject("""{"id":"x","sides":7,"faces":[]}""")))
    }

    @Test fun buzzer() {
        val game = Game.create("buzzer", 1000)!!
        assertFalse(game.input("a", "Ann", jsonOf("id" to game.id, "buzz" to true), 1100), "pressing before it's armed does nothing")
        game.control(jsonOf("action" to "arm"), 2000)
        assertTrue(game.input("b", "Bo", jsonOf("id" to game.id, "buzz" to true, "at" to 2300), 2500))
        assertTrue(game.input("a", "Ann", jsonOf("id" to game.id, "buzz" to true, "at" to 2100), 2600))
        assertFalse(game.input("a", "Ann", jsonOf("id" to game.id, "buzz" to true, "at" to 2050), 2700), "once each")
        assertEquals(listOf("Ann", "Bo"), game.buzzes.map { it.name }, "ordered by when they pressed")
        val view = GameViews.publicView(game)
        assertEquals("armed", view.getString("phase"))
        assertEquals(100, view.getJSONArray("buzzes").getJSONObject(0).getInt("ms"))
    }

    @Test fun quiz() {
        val game = Game.create("quiz", 0)!!
        assertTrue(game.control(JSONObject("""{"action":"ask","text":"Best die?","answers":["d20","d6",""],"correct":0,"timer":10}"""), 1000))
        assertEquals(2, game.question!!.answers.size)
        val hidden = GameViews.publicView(game, 1000)
        assertFalse(hidden.has("correct"), "the right answer stays hidden until the reveal")
        assertTrue(game.input("a", "Ann", jsonOf("id" to game.id, "q" to 1, "choice" to 0, "at" to 1000), 1000))
        assertTrue(game.input("b", "Bo", jsonOf("id" to game.id, "q" to 1, "choice" to 1, "at" to 6000), 6000, expected = 2))
        assertEquals("reveal", game.phase, "everyone answered")
        val board = game.leaderboard()
        assertEquals("Ann", board[0].getString("name"))
        assertEquals(1000, board[0].getInt("score"))
        assertEquals(0, board[1].getInt("score"))
        assertEquals(750, Game.points(5000, 10))
        assertEquals(500, Game.points(30_000, 0))
    }
}
