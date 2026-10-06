package com.dungeonradio.live

import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.random.Random
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The Android engine against the real Mac engine (soundboard-mac/src/live.js)
 * and the real relay (live-relay/server.js), both run by core/src/test/node/harness.js.
 * If these pass, an Android phone, a Mac and an iPhone (which follows the
 * same protocol) can share a session.
 */
class InteropTest {
    private val processes = ArrayList<Process>()

    /** A Mac-side process speaking JSON lines. */
    inner class Harness(vararg args: String) {
        private val process: Process
        private val events = LinkedBlockingQueue<JSONObject>()
        private val seen = ArrayList<JSONObject>()

        init {
            val script = File("src/test/node/harness.js").absolutePath
            process = ProcessBuilder(listOf("node", script) + args).redirectError(ProcessBuilder.Redirect.INHERIT).start()
            processes.add(process)
            Thread {
                BufferedReader(InputStreamReader(process.inputStream)).forEachLine { line ->
                    try { events.put(JSONObject(line)) } catch (_: Exception) {}
                }
            }.apply { isDaemon = true }.start()
        }

        fun send(vararg pairs: Pair<String, Any?>) {
            process.outputStream.write((jsonOf(*pairs).toString() + "\n").toByteArray())
            process.outputStream.flush()
        }

        /** The next event (or one already seen) matching `test`. */
        fun expect(what: String, timeoutMs: Long = 8000, test: (JSONObject) -> Boolean): JSONObject {
            seen.firstOrNull(test)?.let { seen.remove(it); return it }
            val deadline = System.currentTimeMillis() + timeoutMs
            while (true) {
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) fail("Timed out waiting for $what; saw ${seen.map { it.optString("ev") }}")
                val e = events.poll(left, TimeUnit.MILLISECONDS) ?: continue
                if (e.optString("ev") == "error") fail("Harness error: ${e.optString("message")}")
                if (test(e)) return e
                seen.add(e)
            }
        }
    }

    /** Collects callbacks from the Kotlin engines for waiting on. */
    class Inbox<T> {
        private val queue = LinkedBlockingQueue<T>()
        private val seen = ArrayList<T>()
        fun add(item: T) { queue.put(item) }
        fun expect(what: String, timeoutMs: Long = 8000, test: (T) -> Boolean): T {
            synchronized(seen) { seen.firstOrNull(test)?.let { seen.remove(it); return it } }
            val deadline = System.currentTimeMillis() + timeoutMs
            while (true) {
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) fail("Timed out waiting for $what")
                val item = queue.poll(left, TimeUnit.MILLISECONDS) ?: continue
                if (test(item)) return item
                synchronized(seen) { seen.add(item) }
            }
        }
    }

    @AfterTest fun cleanUp() { for (p in processes) p.destroy() }

    private fun tempDir(label: String) = Files.createTempDirectory("android-$label-").toFile()
    private fun randomFile(name: String, size: Int) = File(tempDir("files"), name).apply { writeBytes(Random.nextBytes(size)) }
    private fun face() = Base64.getEncoder().encodeToString(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xe0.toByte()) + Random.nextBytes(500))

    @Test
    fun androidListenerTunesInToAMacAtTheTable() {
        // A sound bigger than one chunk, so it arrives in pieces.
        val drum = randomFile("drum.wav", 600 * 1024 + 77)
        val map = randomFile("map.jpg", 300 * 1024)
        val mac = Harness("host-lan", drum.path)
        val port = mac.expect("the Mac hosting") { it.optString("ev") == "hosting" }.getInt("port")

        val listener = LiveListener(tempDir("cache"), "Pixel", "Android")
        val status = Inbox<LiveListener.State>()
        val commands = Inbox<LiveListener.Command>()
        val handouts = Inbox<LiveListener.Handout>()
        val rolls = Inbox<JSONObject>()
        listener.onStatus = { s, _, _, _ -> status.add(s) }
        listener.onCommand = { commands.add(it) }
        listener.onHandout = { handouts.add(it) }
        listener.onRoll = { rolls.add(it) }
        val avatar = face()
        listener.setAvatar(avatar)
        listener.connect("ws://127.0.0.1:$port")
        status.expect("connected") { it == LiveListener.State.CONNECTED }
        assertEquals("Mac Table", listener.hostName)

        // The Mac sees the Android listener, with its picture.
        val peers = mac.expect("Pixel with a picture") { e ->
            e.optString("ev") == "peers" && e.getJSONArray("list").objects().any { it.optString("name") == "Pixel" && it.optString("avatar") == avatar }
        }
        val pixel = peers.getJSONArray("list").objects().first { it.optString("name") == "Pixel" }
        assertEquals("Android", pixel.getString("device"))

        // A sound: fetched in chunks, checked, played in sync.
        mac.send("do" to "play")
        val play = commands.expect("the drum") { it is LiveListener.Command.Play } as LiveListener.Command.Play
        assertEquals(LiveNet.sha256(drum), LiveNet.sha256(play.file!!))
        assertEquals(0.7, play.volume, 1e-9)
        assertEquals("s:drum", play.group)
        assertTrue(Math.abs(play.at - System.currentTimeMillis()) < 5000, "the start time is in this phone's clock")

        // A secret handout, just for the Android listener.
        mac.send("do" to "handout", "file" to map.path, "to" to org.json.JSONArray(listOf(pixel.getString("peer"))), "title" to "For Pixel")
        val handout = handouts.expect("the secret handout") { true }
        assertTrue(handout.secret)
        assertTrue(handout.show)
        assertEquals("For Pixel", handout.title)
        assertEquals(LiveNet.sha256(map), LiveNet.sha256(handout.file))
        assertTrue(handout.file.path.contains("dungeon-radio-handouts-"), "kept in its own temporary folder")

        // A dice colour, then a roll the Mac sees as Pixel's.
        listener.sendRoll(jsonOf("t" to "diceColor", "color" to "#1f8a5b"))
        rolls.expect("the colours") { it.optString("t") == "diceColors" && it.toString().contains("#1f8a5b") }
        listener.sendRoll(JSONObject("""{"t":"roll","id":"a1","kinds":["d20"],"dice":[{"p":[0,0],"h":2,"v":[1,-1],"w":[1,2,3],"q":[0,0,0,1]}],"groups":[{"type":"d20","dice":[0]}],"mode":"normal","modifier":1,"color":"#000000","by":"Faker"}"""))
        val roll = mac.expect("Pixel's roll") { it.optString("ev") == "roll" && it.getJSONObject("m").optString("t") == "roll" }.getJSONObject("m")
        assertEquals("Pixel", roll.getString("by"), "the host names who rolled")
        assertEquals("#1f8a5b", roll.getString("color"))
        listener.sendRoll(jsonOf("t" to "rollResult", "id" to "a1", "values" to org.json.JSONArray(listOf(20))))
        mac.expect("the result") { it.optString("ev") == "roll" && it.getJSONObject("m").optString("t") == "rollResult" }

        // A buzzer game: armed by the Mac, buzzed from Android.
        mac.send("do" to "game", "action" to "start", "kind" to "buzzer")
        mac.send("do" to "game", "action" to "arm")
        val armed = rolls.expect("the armed buzzer") { it.optString("t") == "game" && it.optString("phase") == "armed" }
        assertEquals(listener.peerId, armed.getString("you"))
        listener.sendRoll(jsonOf("t" to "gameInput", "id" to armed.getString("id"), "buzz" to true))
        mac.expect("Pixel's buzz") { it.optString("ev") == "game" && it.getJSONObject("m").optJSONArray("buzzes")?.objects()?.any { b -> b.optString("name") == "Pixel" } == true }

        // The Mac ends the session.
        mac.send("do" to "end")
        status.expect("ended") { it == LiveListener.State.ENDED }
        commands.expect("everything stops") { it is LiveListener.Command.StopAll && it.ambienceToo }
        listener.flush()
        assertTrue(!handout.file.exists(), "handouts are deleted when the session ends")
    }

    @Test
    fun macListenerTunesInToAnAndroidBroadcastOnline() {
        val relay = Harness("relay")
        val relayPort = relay.expect("the relay") { it.optString("ev") == "relay" }.getInt("port")
        val drum = randomFile("drum.mp3", 300 * 1024)
        val map = randomFile("map.jpg", 50 * 1024)

        val transport = RelayHostTransport("ws://127.0.0.1:$relayPort")
        val ready = Inbox<String>()
        transport.start { error -> ready.add(error ?: "ok") }
        assertEquals("ok", ready.expect("the room") { true })
        val code = transport.sessionCode
        assertNotNull(code)

        val host = LiveHost("Android GM", transport, { id -> if (id == "drum") drum else null }, tempDir("host"))
        val peers = Inbox<List<LiveHost.Peer>>()
        val rolls = Inbox<JSONObject>()
        val games = Inbox<JSONObject>()
        host.onPeers = { peers.add(it) }
        host.onRoll = { rolls.add(it) }
        host.onGame = { games.add(it) }
        host.setHostColor("#b3261e", "Android GM")

        val mac = Harness("listen", "ws://127.0.0.1:$relayPort/live?role=listen&code=$code", "Sam")
        mac.expect("tuned in") { it.optString("ev") == "status" && it.optString("state") == "connected" && it.optString("host") == "Android GM" }
        val sam = peers.expect("Sam") { list -> list.any { it.name == "Sam" } }.first { it.name == "Sam" }

        // Sam's picture reaches the Android host.
        val avatar = face()
        mac.send("do" to "avatar", "data" to avatar)
        peers.expect("Sam's picture") { list -> list.any { it.name == "Sam" && it.avatar == avatar } }

        // A sound from the Android library, fetched by the Mac.
        host.play(LiveHost.PlayEvent(pid = "p1", group = "s:drum", name = "Drum", soundId = "drum", volume = 0.5, duration = 2.0))
        val play = mac.expect("the drum") { it.optString("ev") == "command" && it.getJSONObject("cmd").optString("t") == "play" }.getJSONObject("cmd")
        assertEquals(LiveNet.sha256(drum), play.getString("sha"))
        assertEquals(0.5, play.getDouble("volume"), 1e-9)

        // Ambience: a built-in loop and a library sound.
        host.setAmbience(listOf(
            LiveHost.AmbienceLayer("strip:rain", "builtin", "rain.wav", "Rain", 0.6),
            LiveHost.AmbienceLayer("kit:drum", "sound", "drum", "Drum Loop", 0.3),
        ), fade = 3.0)
        val amb = mac.expect("both layers") { e ->
            e.optString("ev") == "command" && e.getJSONObject("cmd").optString("t") == "ambience" && e.getJSONObject("cmd").getJSONArray("layers").length() == 2
        }.getJSONObject("cmd")
        assertTrue(amb.getJSONArray("layers").objects().any { it.optString("builtin") == "rain.wav" })

        // A secret handout for Sam.
        host.handout("h-1", map, LiveNet.sha256(map), "jpg", "Secret note", listOf(sam.peer))
        val handout = mac.expect("the handout") { it.optString("ev") == "handout" }
        assertTrue(handout.getBoolean("secret"))
        assertEquals(LiveNet.sha256(map), handout.getString("sha"))

        // Sam rolls: the host names the roller and colours the dice.
        mac.send("do" to "color", "color" to "#7b3fbf")
        mac.send("do" to "roll", "id" to "s1")
        val start = rolls.expect("Sam's roll") { it.optString("t") == "roll" }
        assertEquals("Sam", start.getString("by"))
        assertEquals("#7b3fbf", start.getString("color"))
        assertEquals(sam.peer, start.getString("peer"))
        val result = rolls.expect("the result") { it.optString("t") == "rollResult" }
        assertEquals(17, result.getJSONArray("values").getInt(0))

        // A quiz question Sam answers.
        host.gameControl(jsonOf("action" to "start", "kind" to "buzzer"))
        host.gameControl(jsonOf("action" to "arm"))
        val armed = mac.expect("the buzzer") { it.optString("ev") == "roll" && it.getJSONObject("m").optString("phase") == "armed" }.getJSONObject("m")
        mac.send("do" to "buzz", "id" to armed.getString("id"))
        games.expect("Sam's buzz") { g -> g.optJSONArray("buzzes")?.objects()?.any { it.optString("name") == "Sam" } == true }

        host.end()
        mac.expect("ended") { it.optString("ev") == "status" && it.optString("state") == "ended" }
    }

    @Test
    fun androidToAndroidAtTheTable() {
        val drum = randomFile("drum.ogg", 10_000)
        val transport = LanHostTransport("Phone Table")
        val ready = Inbox<String>()
        transport.start { ready.add(it ?: "ok") }
        assertEquals("ok", ready.expect("listening") { true })
        val host = LiveHost("Phone Table", transport, { id -> if (id == "drum") drum else null })
        val listener = LiveListener(tempDir("cache2"), "Pat")
        val commands = Inbox<LiveListener.Command>()
        val status = Inbox<LiveListener.State>()
        listener.onCommand = { commands.add(it) }
        listener.onStatus = { s, _, _, _ -> status.add(s) }
        listener.connect("ws://127.0.0.1:${transport.boundPort}")
        status.expect("connected") { it == LiveListener.State.CONNECTED }
        host.play(LiveHost.PlayEvent(pid = "x", group = "s:drum", name = "Drum", soundId = "drum", buzz = true))
        val play = commands.expect("the drum") { it is LiveListener.Command.Play } as LiveListener.Command.Play
        assertTrue(play.buzz)
        assertEquals(LiveNet.sha256(drum), LiveNet.sha256(play.file!!))
        host.stop("s:drum", 2.0)
        val stop = commands.expect("the stop") { it is LiveListener.Command.Stop } as LiveListener.Command.Stop
        assertEquals(2.0, stop.fade, 1e-9)
        host.kick(listener.peerId)
        status.expect("removed") { it == LiveListener.State.ENDED }
        host.end()
    }
}
