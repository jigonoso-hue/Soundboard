package com.dungeonradio.live

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * A listener: syncs its clock to the host, fetches and caches files and turns
 * host commands into local ones (with local times and file paths). A port of
 * LiveListener in the Mac app's src/live.js (and LiveListenerEngine in the
 * iPhone app). Runs on one thread of its own; callbacks come from it.
 *
 * url: ws://host:port for a session at the table, or the relay's
 * wss://…/live?role=listen&code=… for one online.
 */
class LiveListener(
    private val cacheDir: File,
    val name: String,
    val device: String = "Android",
) {
    sealed class Command {
        /** file: the cached sound; or builtin: one every copy of the app has. at: local clock (ms). */
        data class Play(
            val pid: String, val group: String, val file: File?, val builtin: String?, val name: String,
            val at: Long, val volume: Double, val cat: String, val loop: Boolean, val gap: Double,
            val buzz: Boolean, val whisper: Boolean, val by: String?, val fadeIn: Double,
        ) : Command()
        data class Stop(val group: String, val fade: Double) : Command()
        data class Volume(val group: String, val volume: Double) : Command()
        data class StopAll(val ambienceToo: Boolean) : Command()
        data class Ambience(val layers: List<Layer>, val fade: Double) : Command()
    }

    data class Layer(val key: String, val name: String, val volume: Double, val file: File?, val builtin: String?)
    data class Handout(val id: String, val title: String, val at: Long, val file: File, val show: Boolean, val secret: Boolean)
    data class CatalogItem(val id: String, val name: String, val color: Int)

    enum class State { IDLE, CONNECTING, CONNECTED, ERROR, ENDED }

    var onStatus: (state: State, host: String?, scene: String?, error: String?) -> Unit = { _, _, _, _ -> }
    var onCommand: (Command) -> Unit = {}
    /** Dice, table and game messages (diceColors, turns and game carry "you": this listener's peer id). */
    var onRoll: (JSONObject) -> Unit = {}
    var onRules: (String) -> Unit = {}
    var onCatalog: (List<CatalogItem>) -> Unit = {}
    var onHandout: (Handout) -> Unit = {}
    /** Someone's picture changed: (peer, base64, or "" for none). */
    var onAvatar: (peer: String, data: String) -> Unit = { _, _ -> }

    private val thread = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "live-listener").apply { isDaemon = true } }
    private var socket: WebSocket? = null
    private var closed = false
    var state = State.IDLE
        private set
    var peerId = ""
        private set
    var hostName: String? = null
        private set
    var scene: String? = null
        private set
    /** Host clock − local clock (ms). */
    var offset = 0L
        private set
    private val samples = ArrayList<Pair<Long, Long>>() // (round trip, offset)
    private var pingTimer: ScheduledFuture<*>? = null
    private val pendingPlays = HashMap<String, MutableList<JSONObject>>()
    private var ambienceLayers = listOf<JSONObject>()
    private val offered = HashMap<String, Pair<File, String>>() // hash -> (file, ext)
    private val fetcher = FileFetcher(cacheDir) { m -> send(m) }
    /** Handouts go to a temporary folder of their own, deleted when the session ends. */
    var handoutDir: File? = null
        private set
    private var handoutFetcher: FileFetcher? = null
    private val waitingHandouts = HashMap<String, MutableList<JSONObject>>()
    private var avatar = ""

    init {
        cacheDir.mkdirs()
        fetcher.onArrived = { hash, file -> fileArrived(hash, file) }
        fetcher.onFailed = { hash -> pendingPlays.remove(hash) }
    }

    private fun onThread(block: () -> Unit) {
        if (!thread.isShutdown) thread.execute { try { block() } catch (e: Exception) { e.printStackTrace() } }
    }

    private fun send(message: JSONObject) { socket?.send(message.toString()) }

    fun connect(url: String) = onThread {
        closed = false
        setState(State.CONNECTING)
        val request = Request.Builder().url(url.replaceFirst(Regex("^ws"), "http")).build()
        lateinit var mine: WebSocket
        mine = Http.client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = onThread {
                webSocket.send(jsonOf("t" to "hello", "name" to name, "device" to device, "v" to LiveNet.VERSION).toString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.length > LiveNet.MAX_MESSAGE * 2) return
                LiveNet.parse(text)?.let { m -> onThread { if (socket === webSocket) handle(m) } }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = onThread {
                if (socket !== webSocket) return@onThread
                pingTimer?.cancel(false)
                if (state == State.CONNECTING) setState(State.ERROR, "Couldn't connect (${t.message ?: "no answer"}).")
                else if (!closed && state != State.ERROR && state != State.ENDED) ended("The session ended.")
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = onThread {
                if (socket !== webSocket) return@onThread
                pingTimer?.cancel(false)
                if (!closed && state != State.ERROR && state != State.ENDED) ended("The session ended.")
            }
        })
        socket = mine
    }

    private fun setState(next: State, error: String? = null) {
        state = next
        onStatus(next, hostName, scene, error)
    }

    private fun ended(message: String) {
        onCommand(Command.StopAll(true))
        dropHandouts()
        setState(State.ENDED, message)
        closed = true
        socket?.close(1000, null)
    }

    fun localTime(hostTime: Long) = hostTime - offset

    private fun handle(m: JSONObject) {
        when (m.str("t")) {
            "welcome" -> {
                peerId = m.str("peer") ?: ""
                hostName = m.str("host") ?: "Game Master"
                setState(State.CONNECTED)
                startClockSync()
                if (avatar.isNotEmpty()) send(jsonOf("t" to "avatar", "data" to avatar))
            }
            "avatar" -> {
                val data = LiveNet.cleanAvatar(m.opt("data"))
                val peer = m.str("peer")
                if (data != null && peer != null) onAvatar(peer, data)
            }
            "no-room" -> setState(State.ERROR, "No session with that code. Check it with the broadcaster.")
            "full" -> setState(State.ERROR, "That session is full.")
            "kicked" -> ended("The broadcaster removed you from the session.")
            "ended", "bye" -> ended("The broadcaster ended the session.")
            "pong" -> addClockSample(m)
            "scene" -> {
                scene = m.str("name")
                setState(state)
            }
            "roll", "rollResult", "rolls", "customDice", "ask", "askClosed", "askResult" -> onRoll(m)
            "diceColors", "turns", "game" -> onRoll(m.copy().put("you", peerId))
            "rules" -> onRules(m.str("playerSounds")?.takeIf { it in LiveNet.PLAYER_SOUNDS } ?: "off")
            "catalog" -> onCatalog(m.optJSONArray("sounds").objects().filter { it.str("id") != null }
                .map { CatalogItem(it.str("id")!!, it.str("name") ?: "Sound", it.num("color")?.toInt() ?: 0) })
            "prefetch" -> for (f in m.optJSONArray("files").objects()) fetcher.want(f.str("hash"), f.str("ext"), false)
            "play" -> onPlay(m)
            "stop" -> {
                val group = m.str("group") ?: ""
                dropPending(group)
                onCommand(Command.Stop(group, LiveNet.fadeSeconds(m.opt("fade"))))
            }
            "volume" -> onCommand(Command.Volume(m.str("group") ?: "", LiveNet.clamp01(m.opt("volume"))))
            "stopAll" -> { pendingPlays.clear(); onCommand(Command.StopAll(false)) }
            "ambience" -> {
                ambienceLayers = m.optJSONArray("layers").objects()
                for (layer in ambienceLayers) if (layer.str("hash") != null) fetcher.want(layer.str("hash"), layer.str("ext"), true)
                emitAmbience(LiveNet.fadeSeconds(m.opt("fade")))
            }
            "chunk" -> { fetcher.onChunk(m); handoutFetcher?.onChunk(m) }
            "missing" -> { fetcher.onMissing(m.str("hash") ?: ""); handoutFetcher?.onMissing(m.str("hash") ?: "") }
            "handout" -> onHandoutMessage(m, true)
            "handouts" -> for (item in m.optJSONArray("list").objects().takeLast(20)) onHandoutMessage(item, false)
            "need" -> serveOffered(m.str("hash") ?: "", m.intOrNull("i") ?: 0)
        }
    }

    // ---- Clock ----

    private fun startClockSync() {
        var burst = 0
        val ping = { send(jsonOf("t" to "ping", "id" to UUID.randomUUID().toString(), "t0" to LiveNet.now())) }
        ping()
        pingTimer?.cancel(false)
        // A quick burst for a good first estimate, then one every 15 s.
        pingTimer = thread.scheduleAtFixedRate({
            ping()
            burst++
            if (burst == 6) {
                pingTimer?.cancel(false)
                pingTimer = thread.scheduleAtFixedRate({ ping() }, 15, 15, TimeUnit.SECONDS)
            }
        }, 150, 150, TimeUnit.MILLISECONDS)
    }

    private fun addClockSample(m: JSONObject) {
        val t2 = LiveNet.now()
        val t0 = m.num("t0") ?: return
        val t1 = m.num("t1") ?: return
        samples.add((t2 - t0).toLong() to (t1 - (t0 + t2) / 2).toLong())
        if (samples.size > 10) samples.removeAt(0)
        // The round trip with the least delay gives the most accurate offset.
        offset = samples.minBy { it.first }.second
    }

    // ---- Files and commands ----

    fun cached(hash: String?, ext: String?) = fetcher.cached(hash, ext)

    private fun fileArrived(hash: String, file: File) {
        val plays = pendingPlays.remove(hash) ?: emptyList()
        for (play in plays) emitPlay(play, file)
        if (ambienceLayers.any { it.str("hash") == hash }) emitAmbience(0.0)
    }

    private fun dropPending(group: String) {
        val it = pendingPlays.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            e.value.removeAll { p -> p.str("group") == group }
            if (e.value.isEmpty()) it.remove()
        }
    }

    private fun onPlay(m: JSONObject) {
        m.str("builtin")?.let {
            if (LiveNet.BUILTIN_RE.matches(it)) emitPlay(m, null)
            return
        }
        val hash = m.str("hash")
        val ext = m.str("ext")
        val file = cached(hash, ext)
        if (file != null) { emitPlay(m, file); return }
        if (!LiveNet.isHash(hash) || !LiveNet.isExt(ext)) return
        pendingPlays.getOrPut(hash!!) { ArrayList() }.add(m)
        fetcher.want(hash, ext, true)
    }

    private fun emitPlay(m: JSONObject, file: File?) {
        onCommand(Command.Play(
            pid = m.str("pid") ?: "",
            group = m.str("group") ?: "",
            file = file,
            builtin = if (file == null) m.str("builtin") else null,
            name = m.str("name") ?: "",
            at = localTime(m.num("at")?.toLong() ?: LiveNet.now()),
            volume = LiveNet.clamp01(m.opt("volume")),
            cat = m.str("cat")?.takeIf { it in listOf("sfx", "music", "ambience") } ?: "sfx",
            loop = m.bool("loop"),
            gap = (m.num("gap") ?: 0.0).coerceAtLeast(0.0),
            buzz = m.bool("buzz"),
            whisper = m.bool("whisper"),
            by = m.str("by")?.take(40),
            fadeIn = LiveNet.fadeSeconds(m.opt("fadeIn")),
        ))
    }

    private fun emitAmbience(fade: Double) {
        val layers = ArrayList<Layer>()
        for (l in ambienceLayers) {
            val key = l.str("key") ?: continue
            val volume = LiveNet.clamp01(l.opt("volume"))
            val n = l.str("name") ?: ""
            val builtin = l.str("builtin")
            if (builtin != null) layers.add(Layer(key, n, volume, null, builtin))
            else cached(l.str("hash"), l.str("ext"))?.let { layers.add(Layer(key, n, volume, it, null)) }
        }
        onCommand(Command.Ambience(layers, fade))
    }

    // ---- Handouts ----

    private fun handoutFiles(): FileFetcher {
        handoutFetcher?.let { return it }
        val dir = Files.createTempDirectory("dungeon-radio-handouts-").toFile()
        handoutDir = dir
        val f = FileFetcher(dir) { m -> send(m) }
        f.onArrived = { hash, file -> for (item in waitingHandouts.remove(hash) ?: emptyList<JSONObject>()) emitHandout(item, file) }
        f.onFailed = { hash -> waitingHandouts.remove(hash) }
        handoutFetcher = f
        return f
    }

    private fun onHandoutMessage(m: JSONObject, show: Boolean) {
        val hash = m.str("hash")
        val ext = m.str("ext")
        if (!LiveNet.isHash(hash) || ext !in listOf("jpg", "png")) return
        val item = m.copy().put("show", show)
        val fetcher = handoutFiles()
        val file = fetcher.cached(hash, ext)
        if (file != null) { emitHandout(item, file); return }
        waitingHandouts.getOrPut(hash!!) { ArrayList() }.add(item)
        fetcher.want(hash, ext, show)
    }

    private fun emitHandout(item: JSONObject, file: File) {
        onHandout(Handout(
            id = (item.str("id") ?: item.getString("hash")).take(80),
            title = LiveNet.cleanTitle(item.opt("title")),
            at = item.num("at")?.toLong() ?: LiveNet.now(),
            file = file,
            show = item.bool("show"),
            secret = item.bool("secret"),
        ))
    }

    /** Deletes the session's handouts from this device. */
    private fun dropHandouts() {
        handoutDir?.deleteRecursively()
        handoutDir = null
        handoutFetcher = null
        waitingHandouts.clear()
    }

    // ---- This listener: picture, rolls, games and own sounds ----

    /** Sets this listener's picture (base64; "" removes it). False if it isn't a small JPEG or PNG. */
    fun setAvatar(data: String): Boolean {
        val clean = LiveNet.cleanAvatar(data) ?: return false
        onThread {
            avatar = clean
            if (state == State.CONNECTED) send(jsonOf("t" to "avatar", "data" to clean))
        }
        return true
    }

    /** A dice roll starting or finished here, a colour request, or a buzz or quiz answer. */
    fun sendRoll(message: JSONObject) = onThread {
        when (message.str("t")) {
            "roll", "rollResult", "diceColor" -> send(message)
            // Stamped with when it happened in the host's clock.
            "gameInput" -> send(message.copy().put("at", LiveNet.now() + offset))
        }
    }

    /** Asks the host to play one of the broadcaster's sounds for everyone. */
    fun cue(soundId: String) = onThread { send(jsonOf("t" to "cue", "id" to soundId)) }

    /** Asks the host to play one of this player's own (offered) sounds for everyone. */
    fun cueHash(hash: String) = onThread { send(jsonOf("t" to "cue", "hash" to hash)) }

    /** Offers this player's own sounds (at most five), so the host can fetch them ahead of time. */
    fun offer(sounds: List<Triple<File, String, String>>) = onThread { // (file, hash, name)
        offered.clear()
        val list = org.json.JSONArray()
        for ((file, hash, n) in sounds.take(LiveNet.PLAYER_SOUND_LIMIT)) {
            val ext = file.extension.lowercase()
            if (!LiveNet.isHash(hash) || !LiveNet.isExt(ext)) continue
            offered[hash] = file to ext
            list.put(jsonOf("hash" to hash, "ext" to ext, "name" to n.take(60)))
        }
        send(jsonOf("t" to "offer", "sounds" to list))
    }

    private fun serveOffered(hash: String, index: Int) {
        val entry = offered[hash]
        val chunk = entry?.let { LiveNet.chunkOf(it.first, hash, it.second, index) }
        send(chunk ?: jsonOf("t" to "missing", "hash" to hash))
    }

    fun leave() = onThread {
        closed = true
        pingTimer?.cancel(false)
        try { socket?.close(1000, "left") } catch (_: Exception) {}
        onCommand(Command.StopAll(true))
        dropHandouts()
        setState(State.IDLE)
    }

    /** Waits until everything queued so far has run (tests). */
    fun flush() { thread.submit {}.get(5, TimeUnit.SECONDS) }

    companion object {
        /** The listen URL for an online session's code. */
        fun relayListenUrl(relay: String, code: String): String? {
            val base = LiveNet.relayUrl(relay) ?: return null
            val clean = code.uppercase().filter { it.isLetterOrDigit() }
            if (clean.isEmpty()) return null
            return "$base?role=listen&code=$clean"
        }

        /** Deletes cached files not used for `days` days. */
        fun pruneCache(cacheDir: File, days: Int = 30) {
            val cutoff = LiveNet.now() - days * 86_400_000L
            cacheDir.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
        }
    }
}
