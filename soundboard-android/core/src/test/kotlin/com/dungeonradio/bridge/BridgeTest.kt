package com.dungeonradio.bridge

import com.dungeonradio.live.LanPublisher
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** The native side of the web screens: files, the sound server and the Live Session bridge. */
class BridgeTest {
    private val temp = Files.createTempDirectory("bridge-test-").toFile()
    private val bridges = ArrayList<NativeBridge>()

    @AfterTest
    fun cleanUp() {
        bridges.forEach { it.close() }
        temp.deleteRecursively()
    }

    /** Records what the bridge sends to the page. */
    class FakePlatform : Platform {
        val events = CopyOnWriteArrayList<Pair<String, String>>()
        val answers = ConcurrentHashMap<String, Pair<String?, String?>>()
        var port = 0
        var active = false
        override fun emit(channel: String, json: String) { events.add(channel to json) }
        override fun resolve(id: String, json: String?, error: String?) { answers[id] = json to error }
        override fun notify(title: String, body: String) {}
        override fun openExternal(url: String) {}
        override fun pickFiles(kind: String, multiple: Boolean, importDir: File, done: (List<Pair<File, String>>) -> Unit) {
            val copy = File(importDir, "picked.wav").apply { writeBytes(ByteArray(10) { it.toByte() }) }
            done(listOf(copy to "Picked.wav"))
        }
        override fun micAccess(done: (Boolean) -> Unit) = done(true)
        override fun saveImage(file: File, name: String, mime: String, done: (Boolean) -> Unit) = done(true)
        override fun lanPublisher() = object : LanPublisher {
            override fun publish(name: String, port: Int) { this@FakePlatform.port = port }
            override fun unpublish() {}
        }
        override fun browse(on: Boolean, found: (List<JSONObject>) -> Unit) {}
        override fun sessionActive(active: Boolean) { this.active = active }
        override val deviceName = "Pixel"

        fun waitFor(channel: String, timeout: Long = 10_000, test: (String) -> Boolean = { true }): String {
            val end = System.currentTimeMillis() + timeout
            while (System.currentTimeMillis() < end) {
                events.firstOrNull { it.first == channel && test(it.second) }?.let { return it.second }
                Thread.sleep(20)
            }
            throw AssertionError("No $channel event; got ${events.map { it.first + " " + it.second.take(160) }}")
        }

        fun answer(id: String, timeout: Long = 20_000): Pair<String?, String?> {
            val end = System.currentTimeMillis() + timeout
            while (System.currentTimeMillis() < end) { answers[id]?.let { return it }; Thread.sleep(20) }
            throw AssertionError("No answer to call $id")
        }
    }

    private fun bridge(name: String, platform: Platform): NativeBridge {
        val dir = File(temp, name)
        val builtins = File(dir, "builtin").apply { mkdirs() }
        File(builtins, "rain.wav").writeBytes(ByteArray(2000) { (it % 251).toByte() })
        return NativeBridge(AppFiles(File(dir, "files")), builtins, File(dir, "live-cache"), platform).also { bridges.add(it) }
    }

    private fun value(answer: String): Any? {
        val o = JSONObject(answer)
        if (o.has("error")) throw AssertionError(o.getString("error"))
        return o.opt("value")
    }

    private fun get(url: String, range: String? = null): Triple<Int, Map<String, String>, ByteArray> {
        val c = URL(url).openConnection(Proxy.NO_PROXY) as HttpURLConnection
        range?.let { c.setRequestProperty("Range", it) }
        val code = c.responseCode
        val body = (if (code < 400) c.inputStream else c.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
        val headers = c.headerFields.filterKeys { it != null }.mapValues { it.value.joinToString(",") }
        return Triple(code, headers, body)
    }

    @Test
    fun filesStayInTheAppFolder() {
        val files = AppFiles(File(temp, "root"))
        assertTrue(files.writeText("/sounds/library.json", "[]"))
        assertEquals("[]", files.readText("/sounds/library.json"))
        assertEquals("[\"library.json\"]", files.list("/sounds"))
        assertEquals(2, JSONObject(files.stat("/sounds/library.json")).getInt("size"))
        assertEquals("null", files.stat("/nope"))
        assertEquals(null, files.read("/nope"))
        // ".." can't climb out of the app's folder.
        assertEquals(File(files.root, "etc/passwd").path, files.resolve("/../../etc/passwd").path)
        assertTrue(files.write("/a/b.bin", Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3))))
        assertTrue(files.copy("/a/b.bin", "/a/c.bin"))
        assertTrue(files.rename("/a/c.bin", "/a/d.bin"))
        assertEquals(Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3)), files.read("/a/d.bin"))
        assertTrue(files.rm("/a"))
        assertTrue(!files.exists("/a/b.bin"))
        // A link out of the folder is refused.
        val outside = File(temp, "outside").apply { mkdirs(); File(this, "secret.txt").writeText("x") }
        Files.createSymbolicLink(File(files.root, "link").toPath(), outside.toPath())
        assertFailsWith<SecurityException> { files.readText("/link/secret.txt") }
    }

    @Test
    fun soundServerServesRanges() {
        val platform = FakePlatform()
        val b = bridge("server", platform)
        val bytes = ByteArray(100_000) { (it * 7 % 256).toByte() }
        b.files.write("/sounds/song.mp3", Base64.getEncoder().encodeToString(bytes))
        val base = value(b.call("serverBase", null)) as String
        assertTrue(base.startsWith("http://127.0.0.1:"))

        val (code, headers, body) = get("${base}local/song.mp3")
        assertEquals(200, code)
        assertEquals("audio/mpeg", headers["Content-Type"])
        assertEquals("*", headers["Access-Control-Allow-Origin"])
        assertContentEquals(bytes, body)

        val (code2, headers2, body2) = get("${base}local/song.mp3", "bytes=1000-1999")
        assertEquals(206, code2)
        assertEquals("bytes 1000-1999/100000", headers2["Content-Range"])
        assertContentEquals(bytes.copyOfRange(1000, 2000), body2)

        val (_, _, tail) = get("${base}local/song.mp3", "bytes=-10")
        assertContentEquals(bytes.copyOfRange(99_990, 100_000), tail)
        assertEquals(416, get("${base}local/song.mp3", "bytes=200000-").first)

        val (builtinCode, _, builtin) = get("${base}builtin/rain.wav")
        assertEquals(200, builtinCode)
        assertEquals(2000, builtin.size)

        // Without the secret, or outside the folder: nothing.
        val wrong = base.replace(Regex("/[0-9a-f]{32}/$"), "/0123456789abcdef0123456789abcdef/")
        assertEquals(404, get("${wrong}local/song.mp3").first)
        assertEquals(404, get("${base}local/..%2Flibrary.json").first)
        assertEquals(404, get("${base}local/%2E%2E%2F%2E%2E%2Fsecret").first)
        assertEquals(404, get("${base}other/song.mp3").first)
    }

    @Test
    fun callsAnswerLikeTheMac() {
        val platform = FakePlatform()
        val b = bridge("calls", platform)
        assertEquals("[\"rain.wav\"]", (value(b.call("builtins", "{}")) as JSONArray).toString())
        assertEquals(2000, Base64.getDecoder().decode(value(b.call("readBuiltin", "{\"file\":\"rain.wav\"}")) as String).size)
        assertTrue(JSONObject(b.call("nope", "{}")).has("error"))
        assertEquals(JSONObject.NULL, JSONObject(b.call("liveStatus", "{}")).getJSONObject("value").get("role"))

        b.callAsync("pickFiles", "{\"kind\":\"audio\",\"multiple\":true}", "1")
        val picked = JSONArray(platform.answer("1").first)
        assertEquals("/import/picked.wav", picked.getJSONObject(0).getString("file"))
        assertEquals("Picked.wav", picked.getJSONObject(0).getString("name"))
        assertTrue(b.files.exists("/import/picked.wav"))

        b.callAsync("micAccess", "{}", "2")
        assertEquals("true", platform.answer("2").first)
        b.callAsync("liveHandoutSend", "{\"data\":\"AAAA\"}", "3")
        assertEquals("Not broadcasting", platform.answer("3").second)
    }

    @Test
    fun liveSessionBetweenTwoPhones() {
        val gm = FakePlatform()
        val player = FakePlatform()
        val host = bridge("gm", gm)
        val listener = bridge("player", player)

        // The broadcaster's library: one sound.
        val sound = ByteArray(50_000) { (it * 13 % 256).toByte() }
        host.files.write("/sounds/abc.wav", Base64.getEncoder().encodeToString(sound))
        host.files.writeText("/sounds/library.json", JSONArray().put(JSONObject().put("id", "s1").put("name", "Roar").put("file", "abc.wav")).toString())

        host.callAsync("liveHostStart", JSONObject().put("name", "Friday").put("mode", "local").put("playerSounds", "off")
            .put("catalog", JSONArray()).toString(), "h")
        val (started, error) = gm.answer("h")
        assertEquals(null, error)
        assertEquals("host", JSONObject(started).getString("role"))
        assertEquals("Friday", JSONObject(started).getString("name"))
        assertTrue(gm.port > 0)
        assertTrue(gm.active)

        // A tiny JPEG as the player's picture.
        val avatar = Base64.getEncoder().encodeToString(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 1, 2, 3, 4))
        listener.callAsync("liveListen", JSONObject().put("url", "ws://127.0.0.1:${gm.port}").put("name", "Pat").put("avatar", avatar).toString(), "l")
        assertEquals(null, player.answer("l").second)
        player.waitFor("live:status") { JSONObject(it).optString("state") == "connected" }
        val peers = gm.waitFor("live:status") { s -> JSONObject(s).getJSONArray("peers").let { it.length() == 1 && it.getJSONObject(0).optString("avatar").isNotEmpty() } }
        val peer = JSONObject(peers).getJSONArray("peers").getJSONObject(0)
        assertEquals("Pat", peer.getString("name"))
        assertEquals("Android", peer.getString("device"))

        // The board plays a library sound: the listener fetches it and plays it from its own server.
        host.call("liveHostEvent", JSONObject().put("t", "play").put("pid", "p1").put("group", "g1").put("soundId", "s1")
            .put("name", "Roar").put("volume", 0.5).put("cat", "sfx").put("buzz", true).toString())
        val play = JSONObject(player.waitFor("live:command") { JSONObject(it).optString("t") == "play" })
        assertEquals("Roar", play.getString("name"))
        assertEquals(0.5, play.getDouble("volume"))
        assertEquals(true, play.getBoolean("buzz"))
        assertEquals(false, play.getBoolean("whisper"))
        val (code, _, fetched) = get(play.getString("url"))
        assertEquals(200, code)
        assertContentEquals(sound, fetched)

        // Ambience: a built-in loop, played from the listener's own copy.
        host.call("liveHostEvent", JSONObject().put("t", "ambience").put("layers", JSONArray().put(
            JSONObject().put("key", "a1").put("kind", "builtin").put("ref", "rain.wav").put("name", "Rain").put("volume", 0.4))).toString())
        val amb = JSONObject(player.waitFor("live:command") { JSONObject(it).optString("t") == "ambience" && JSONObject(it).getJSONArray("layers").length() == 1 })
        val layer = amb.getJSONArray("layers").getJSONObject(0)
        assertEquals("rain.wav", layer.getString("builtin"))
        assertEquals(2000, get(layer.getString("url")).third.size)

        // A handout, sent secretly to this player.
        val picture = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + ByteArray(3000) { it.toByte() }
        host.callAsync("liveHandoutSend", JSONObject().put("data", Base64.getEncoder().encodeToString(picture)).put("title", "Map")
            .put("to", JSONArray().put(peer.getString("peer"))).toString(), "ho")
        assertNotNull(JSONObject(gm.answer("ho").first).getString("id"))
        val handout = JSONObject(player.waitFor("live:handout"))
        assertEquals("Map", handout.getString("title"))
        assertEquals(true, handout.getBoolean("secret"))
        assertContentEquals(picture, Base64.getDecoder().decode(handout.getString("src").substringAfter("base64,")))
        listener.callAsync("liveHandoutSave", JSONObject().put("id", handout.getString("id")).toString(), "save")
        assertEquals("true", player.answer("save").first)

        // Stopping a group, with a fade.
        host.call("liveHostEvent", JSONObject().put("t", "stop").put("group", "g1").put("fade", 1.5).toString())
        val stop = JSONObject(player.waitFor("live:command") { JSONObject(it).optString("t") == "stop" })
        assertEquals("g1", stop.getString("group"))
        assertEquals(1.5, stop.getDouble("fade"))

        // Leaving stops everything here and frees the spot on the broadcaster's side.
        val status = JSONObject(listener.call("liveLeave", "{}")).getJSONObject("value")
        assertEquals(JSONObject.NULL, status.get("role"))
        player.waitFor("live:command") { JSONObject(it).optString("t") == "stopAll" && JSONObject(it).optBoolean("ambienceToo") }
        gm.waitFor("live:status") { JSONObject(it).getJSONArray("peers").length() == 0 }
        assertTrue(!player.active)

        host.call("liveLeave", "{}")
        assertTrue(!gm.active)
    }
}
