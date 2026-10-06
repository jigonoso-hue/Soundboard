package com.dungeonradio.live

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * The host: answers listeners, serves files and forwards what the board plays.
 * A port of LiveHost in the Mac app's src/live.js (and LiveHostEngine in the
 * iPhone app). Everything runs on one thread of its own; callbacks are made
 * from it, so an app moves them to its main thread.
 *
 * resolveSound(id) gives a library sound's file. cacheDir holds players' own sounds.
 */
class LiveHost(
    val name: String,
    private val transport: HostTransport,
    private val resolveSound: (String) -> File?,
    private val cacheDir: File? = null,
) {
    data class Peer(val peer: String, val name: String, val device: String, val avatar: String)

    /** A player's sound request, already checked against the rules. */
    sealed class Cue {
        data class Library(val soundId: String) : Cue()
        data class FileCue(val hash: String, val ext: String, val name: String, val file: File) : Cue()
    }

    /** A play for listeners. `to` makes it a whisper to those listeners. */
    data class PlayEvent(
        val pid: String,
        val group: String,
        val name: String,
        val at: Long = LiveNet.now(),
        val volume: Double = 1.0,
        val cat: String = "sfx",
        val soundId: String? = null,
        /** A file not in the library (a player's own sound): its hash, ext and path. */
        val file: Triple<String, String, File>? = null,
        /** A built-in sound every copy of the app has (e.g. thunderstorm.wav). */
        val builtin: String? = null,
        val loop: Boolean = false,
        val gap: Double = 0.0,
        val buzz: Boolean = false,
        val duration: Double = 0.0,
        val to: List<String>? = null,
        val by: String? = null,
        val fadeIn: Double = 0.0,
    )

    /** An ambience layer playing on the host. kind "builtin" (ref: file name) or "sound" (ref: sound id). */
    data class AmbienceLayer(val key: String, val kind: String, val ref: String, val name: String, val volume: Double)

    var onPeers: (List<Peer>) -> Unit = {}
    var onCue: (peer: String, playerName: String, cue: Cue) -> Unit = { _, _, _ -> }
    /** A listener's roll starting or finished, for the host's own dice tray. */
    var onRoll: (JSONObject) -> Unit = {}
    /** The game as the broadcaster sees it (everything). */
    var onGame: (JSONObject) -> Unit = {}
    var onColors: (JSONObject) -> Unit = {}

    private class PeerInfo {
        var name = "Listener"
        var device = ""
        var ready = false
        val allowed = HashSet<String>()
        val cued = HashSet<String>()
        var lastCue = 0L
        val offers = LinkedHashMap<String, Pair<String, String>>() // hash -> (ext, name)
        var fetcher: FileFetcher? = null
        val waitingCues = HashSet<String>()
    }

    private class Active(val message: JSONObject, val group: String, val until: Long)
    private class RollStart(val start: JSONObject, val peer: String?, var done: Boolean = false)

    private val thread = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "live-host").apply { isDaemon = true } }
    private val peers = LinkedHashMap<String, PeerInfo>()
    private val files = HashMap<String, Pair<File, String>>() // hash -> (file, ext)
    private val hashes = HashMap<String, Pair<String, String>>() // file path -> (size:mtime, hash)
    private val active = LinkedHashMap<String, Active>()
    private var ambience = jsonOf("t" to "ambience", "layers" to JSONArray())
    private var scene = jsonOf("t" to "scene", "name" to null)
    private var prefetchIds = listOf<String>()
    private var playerSounds = "off"
    private var catalog = JSONArray()
    private val rollStarts = LinkedHashMap<String, RollStart>()
    private val rollLog = ArrayList<JSONObject>()
    private val diceColors = LinkedHashMap<String, String>()
    private var hostDiceName = "Broadcaster"
    private var customDice: JSONObject? = null
    private val asks = LinkedHashMap<String, JSONObject>()
    private var turns: JSONObject? = null
    private var game: Game? = null
    private var gameTimer: ScheduledFuture<*>? = null
    private val handouts = ArrayList<JSONObject>() // newest last; "to" (JSONArray) on secret ones
    private val avatars = LinkedHashMap<String, String>()

    init {
        transport.onJoin = { peer -> onThread { peers[peer] = PeerInfo() } }
        transport.onLeave = { peer ->
            onThread {
                peers.remove(peer)
                if (avatars.remove(peer) != null) transport.send(null, jsonOf("t" to "avatar", "peer" to peer, "data" to ""))
                emitPeers()
                // Their dice colour is free again.
                if (diceColors.remove(peer) != null) broadcastColors()
            }
        }
        transport.onMessage = { peer, message -> onThread { handle(peer, message) } }
    }

    /** Runs on the host's thread, in order. */
    private fun onThread(block: () -> Unit) {
        thread.execute { try { block() } catch (e: Exception) { e.printStackTrace() } }
    }

    fun peerList(): List<Peer> = peers.filter { it.value.ready }
        .map { (peer, p) -> Peer(peer, p.name, p.device, avatars[peer] ?: "") }

    private fun emitPeers() = onPeers(peerList())

    private fun handle(peer: String, message: JSONObject) {
        val info = peers[peer] ?: return
        when (message.str("t")) {
            "hello" -> {
                info.name = (message.str("name") ?: "Listener").take(40)
                info.device = (message.str("device") ?: "").take(40)
                info.ready = true
                transport.send(peer, jsonOf("t" to "welcome", "peer" to peer, "host" to name, "v" to LiveNet.VERSION))
                transport.send(peer, scene)
                transport.send(peer, rulesMessage())
                if (playerSounds == "gm") transport.send(peer, catalogMessage())
                if (rollLog.isNotEmpty()) transport.send(peer, jsonOf("t" to "rolls", "list" to JSONArray(rollLog.takeLast(30))))
                transport.send(peer, colorsMessage())
                // Catch up on the table: custom dice, requests still open for everyone, initiative.
                customDice?.let { transport.send(peer, it) }
                for (ask in asks.values) if (ask.opt("to") == JSONObject.NULL || !ask.has("to")) transport.send(peer, ask)
                turns?.let { transport.send(peer, it) }
                if (game != null) transport.send(peer, GameViews.publicView(game))
                // Everyone's pictures, then the handouts shown so far (secret ones only to whom they were for).
                for ((other, data) in avatars) transport.send(peer, jsonOf("t" to "avatar", "peer" to other, "data" to data))
                val shown = handouts.filter { h -> h.optJSONArray("to")?.values()?.contains(peer) ?: true }.map(::handoutMessage)
                if (shown.isNotEmpty()) sendTo(peer, jsonOf("t" to "handouts", "list" to JSONArray(shown)))
                sendTo(peer, ambience)
                sendTo(peer, prefetchMessage())
                pruneActive()
                for (a in active.values) sendTo(peer, a.message)
                emitPeers()
            }
            "ping" -> transport.send(peer, jsonOf("t" to "pong", "id" to message.opt("id"), "t0" to message.opt("t0"), "t1" to LiveNet.now()))
            "need" -> {
                val hash = message.str("hash") ?: ""
                val entry = files[hash]
                val chunk = if (LiveNet.isHash(hash) && info.allowed.contains(hash) && entry != null)
                    LiveNet.chunkOf(entry.first, hash, entry.second, message.intOrNull("i") ?: 0) else null
                transport.send(peer, chunk ?: jsonOf("t" to "missing", "hash" to hash))
            }
            "roll" -> if (info.ready) startRoll(message, peer, info.name)
            "rollResult" -> if (info.ready) finishRoll(message, peer)
            "avatar" -> {
                if (!info.ready) return
                val data = LiveNet.cleanAvatar(message.opt("data")) ?: return
                if (data.isEmpty()) avatars.remove(peer) else avatars[peer] = data
                transport.send(null, jsonOf("t" to "avatar", "peer" to peer, "data" to data))
                emitPeers()
            }
            "diceColor" -> if (info.ready) claimColor(peer, message.str("color"))
            "gameInput" -> {
                val g = game ?: return
                if (info.ready && g.input(peer, info.name, message, LiveNet.now(), peerList().size)) sendGame()
            }
            "cue" -> handleCue(peer, info, message)
            "offer" -> handleOffer(peer, info, message)
            "chunk" -> info.fetcher?.onChunk(message)
            "missing" -> info.fetcher?.onMissing(message.str("hash") ?: "")
        }
    }

    // ---- Dice ----

    /** A roll starting (from a listener, or the host's own with peer null). The host names who rolled. */
    private fun startRoll(message: JSONObject, peer: String?, rollerName: String?) {
        val start = Rolls.cleanStart(message) ?: return
        val id = start.getString("id")
        if (rollStarts.containsKey(id)) return
        start.put("by", (rollerName ?: start.str("by")?.ifEmpty { null } ?: "Someone").take(40))
        // Only the broadcaster can roll in secret.
        if (peer != null) start.remove("hidden")
        // Everyone rolls in their own colour; no colour, no roll.
        val color = diceColors[peer ?: "host"] ?: return
        start.put("color", color)
        start.put("peer", peer ?: "host")
        rollStarts[id] = RollStart(start, peer)
        if (rollStarts.size > 60) rollStarts.remove(rollStarts.keys.first())
        transport.send(null, start)
        if (peer != null) onRoll(start)
    }

    private fun finishRoll(message: JSONObject, peer: String?) {
        val entry = rollStarts[message.str("id") ?: ""] ?: return
        if (entry.peer != peer || entry.done) return
        val values = Rolls.cleanValues(message.optJSONArray("values"), entry.start.getJSONArray("kinds")) ?: return
        entry.done = true
        // A hidden roll's numbers stay with the broadcaster.
        if (entry.start.bool("hidden")) return
        val result = jsonOf("t" to "rollResult", "id" to entry.start.getString("id"), "values" to JSONArray(values))
        transport.send(null, result)
        val s = entry.start
        val logged = jsonOf("id" to s.getString("id"), "by" to s.opt("by"), "mode" to s.opt("mode"), "modifier" to s.opt("modifier"),
            "groups" to s.opt("groups"), "values" to JSONArray(values), "at" to LiveNet.now())
        s.optJSONArray("custom")?.let { logged.put("custom", it) }
        s.str("ask")?.let { logged.put("ask", it) }
        rollLog.add(logged)
        if (rollLog.size > 100) rollLog.removeAt(0)
        if (peer != null) onRoll(result)
    }

    /** The broadcaster's own roll. */
    fun roll(message: JSONObject, rollerName: String) = onThread { startRoll(message, null, rollerName) }
    fun rollResult(message: JSONObject) = onThread { finishRoll(message, null) }

    /**
     * The broadcaster's table: shared custom dice, roll requests and
     * initiative, sent on to listeners and remembered for late joiners.
     */
    fun table(message: JSONObject) = onThread {
        if (message.toString().length > 64 * 1024) return@onThread
        when (message.str("t")) {
            "customDice" -> {
                val list = message.optJSONArray("list").values().take(40).mapNotNull { Rolls.cleanCustom(it) }
                customDice = jsonOf("t" to "customDice", "list" to JSONArray(list))
                transport.send(null, customDice!!)
            }
            "ask" -> {
                val id = message.str("id") ?: return@onThread
                if (!Rolls.ROLL_ID.matches(id)) return@onThread
                val ask = message.copy()
                val to = message.optJSONArray("to")?.values()?.map { it.toString() }?.filter { peers.containsKey(it) }
                ask.put("to", to?.let { JSONArray(it) } ?: JSONObject.NULL)
                asks[id] = ask
                if (to != null) for (p in to) transport.send(p, ask) else transport.send(null, ask)
            }
            "askClosed", "askResult" -> {
                val id = message.str("id") ?: ""
                val ask = asks[id]
                if (message.str("t") == "askClosed") asks.remove(id)
                val to = ask?.optJSONArray("to")
                if (to != null && message.str("t") == "askClosed") for (p in to.values()) transport.send(p.toString(), message)
                else transport.send(null, message)
            }
            "turns" -> {
                turns = if (message.str("phase") == "off") null else message
                transport.send(null, message)
            }
        }
    }

    // ---- Games ----

    /** start {kind}, arm, reset (buzzer), ask {text, answers, correct, timer}, reveal, lobby, final (quiz), end. */
    fun gameControl(cmd: JSONObject) = onThread {
        when (cmd.str("action")) {
            "start" -> game = Game.create(cmd.str("kind"))
            "end" -> game = null
            else -> if (game?.control(cmd) != true) return@onThread
        }
        sendGame()
    }

    private fun sendGame() {
        gameTimer?.cancel(false)
        val g = game
        val q = g?.question
        // A question with a time limit ends by itself.
        if (g != null && g.phase == "question" && q != null && q.endsAt > 0) {
            gameTimer = thread.schedule({
                if (game === g && g.question === q && g.reveal()) sendGame()
            }, maxOf(0, q.endsAt - LiveNet.now()) + 300, TimeUnit.MILLISECONDS)
        }
        transport.send(null, GameViews.publicView(g))
        onGame(GameViews.hostView(g).put("host", true))
    }

    // ---- Dice colours ----

    private fun colorsMessage(): JSONObject {
        val colors = JSONArray()
        for ((peer, color) in diceColors) {
            colors.put(jsonOf("peer" to peer, "color" to color,
                "name" to if (peer == "host") hostDiceName else (peers[peer]?.name ?: "Listener")))
        }
        return jsonOf("t" to "diceColors", "colors" to colors)
    }

    private fun broadcastColors() {
        transport.send(null, colorsMessage())
        onColors(colorsMessage())
    }

    /** Someone asks for a dice colour: theirs if no one else has it. */
    private fun claimColor(peer: String, color: String?): Boolean {
        val wanted = (color ?: "").lowercase()
        if (wanted !in Rolls.DICE_COLORS) return false
        for ((other, taken) in diceColors) if (other != peer && taken == wanted) {
            if (peer != "host") transport.send(peer, colorsMessage())
            return false
        }
        diceColors[peer] = wanted
        broadcastColors()
        return true
    }

    /** The broadcaster's own colour and name. */
    fun setHostColor(color: String, name: String?) = onThread {
        if (!name.isNullOrBlank()) hostDiceName = name.take(40)
        if (!claimColor("host", color)) onColors(colorsMessage())
    }

    // ---- Listeners' sounds ----

    private fun rulesMessage() = jsonOf("t" to "rules", "playerSounds" to playerSounds, "limit" to LiveNet.PLAYER_SOUND_LIMIT)
    private fun catalogMessage() = jsonOf("t" to "catalog", "sounds" to catalog)

    fun setPlayerSounds(mode: String) = onThread {
        playerSounds = if (mode in LiveNet.PLAYER_SOUNDS) mode else "off"
        for (info in peers.values) {
            info.cued.clear()
            if (playerSounds != "own") info.offers.clear()
        }
        broadcast(rulesMessage())
        if (playerSounds == "gm") broadcast(catalogMessage())
    }

    /** items: [{ id, name, color }]: every sound except broadcaster-only ones. */
    fun setCatalog(items: List<Triple<String, String, Int>>) = onThread {
        catalog = JSONArray(items.map { (id, n, color) -> jsonOf("id" to id, "name" to n.take(80), "color" to color) })
        if (playerSounds == "gm") broadcast(catalogMessage())
    }

    private fun handleCue(peer: String, info: PeerInfo, message: JSONObject) {
        if (playerSounds == "off" || !info.ready) return
        val now = LiveNet.now()
        if (now - info.lastCue <= 300) return
        val key: String
        var cue: Cue? = null
        if (playerSounds == "gm") {
            val id = message.str("id") ?: ""
            if ((0 until catalog.length()).none { catalog.getJSONObject(it).getString("id") == id }) return
            key = id
            cue = Cue.Library(id)
        } else {
            val hash = message.str("hash") ?: ""
            val offer = info.offers[hash] ?: return
            key = hash
            val file = info.fetcher?.cached(hash, offer.first)
            if (file != null) cue = Cue.FileCue(hash, offer.first, offer.second, file)
            else {
                // Play it once the file arrives from the player.
                info.waitingCues.add(hash)
                info.fetcher?.want(hash, offer.first, true)
            }
        }
        if (!info.cued.contains(key) && info.cued.size >= LiveNet.PLAYER_SOUND_LIMIT) return
        info.cued.add(key)
        info.lastCue = now
        cue?.let { onCue(peer, info.name, it) }
    }

    private fun handleOffer(peer: String, info: PeerInfo, message: JSONObject) {
        if (playerSounds != "own" || !info.ready || cacheDir == null) return
        info.offers.clear()
        for (item in message.optJSONArray("sounds").objects().take(LiveNet.PLAYER_SOUND_LIMIT)) {
            val hash = item.str("hash") ?: ""
            val ext = item.str("ext") ?: ""
            if (!LiveNet.isHash(hash) || !LiveNet.isExt(ext)) continue
            info.offers[hash] = ext to (item.str("name") ?: "Sound").take(60)
        }
        if (info.fetcher == null) {
            val fetcher = FileFetcher(cacheDir) { m -> transport.send(peer, m) }
            fetcher.onArrived = { hash, file ->
                val current = peers[peer]
                val offer = current?.offers?.get(hash)
                if (current != null && offer != null && current.waitingCues.remove(hash)) {
                    onCue(peer, current.name, Cue.FileCue(hash, offer.first, offer.second, file))
                }
            }
            fetcher.onFailed = { hash -> peers[peer]?.waitingCues?.remove(hash) }
            info.fetcher = fetcher
        }
        for ((hash, offer) in info.offers) info.fetcher?.want(hash, offer.first, false)
    }

    // ---- Files ----

    private fun hashesIn(message: JSONObject): List<String> = when (message.str("t")) {
        "play" -> listOfNotNull(message.str("hash"))
        "prefetch" -> message.optJSONArray("files").objects().mapNotNull { it.str("hash") }
        "ambience" -> message.optJSONArray("layers").objects().mapNotNull { it.str("hash") }
        "handout" -> listOfNotNull(message.str("hash"))
        "handouts" -> message.optJSONArray("list").objects().mapNotNull { it.str("hash") }
        else -> emptyList()
    }

    /** Sends a message that refers to files, and lets this listener fetch them. */
    private fun sendTo(peer: String, message: JSONObject) {
        val info = peers[peer] ?: return
        info.allowed.addAll(hashesIn(message))
        transport.send(peer, message)
    }

    private fun broadcast(message: JSONObject) {
        val h = hashesIn(message)
        for (info in peers.values) info.allowed.addAll(h)
        transport.send(null, message)
    }

    /** A library sound's hash and extension, registering it to be served. */
    private fun fileFor(soundId: String): Pair<String, String>? {
        val file = resolveSound(soundId) ?: return null
        if (!file.exists()) return null
        val ext = file.extension.lowercase()
        if (!LiveNet.isExt(ext)) return null
        val stamp = "${file.length()}:${file.lastModified()}"
        val known = hashes[file.path]
        val hash = if (known != null && known.first == stamp) known.second else LiveNet.sha256(file).also { hashes[file.path] = stamp to it }
        files[hash] = file to ext
        return hash to ext
    }

    private fun prefetchMessage(): JSONObject {
        val list = JSONArray()
        for (id in prefetchIds) fileFor(id)?.let { (hash, ext) -> list.put(jsonOf("hash" to hash, "ext" to ext)) }
        return jsonOf("t" to "prefetch", "files" to list)
    }

    // ---- Called by the board ----

    fun play(event: PlayEvent) = onThread {
        val message = jsonOf("t" to "play", "pid" to event.pid, "group" to event.group)
        when {
            event.builtin != null -> {
                if (!LiveNet.BUILTIN_RE.matches(event.builtin)) return@onThread
                message.put("builtin", event.builtin)
            }
            event.file != null -> {
                val (hash, ext, file) = event.file
                if (!LiveNet.isHash(hash) || !LiveNet.isExt(ext)) return@onThread
                files[hash] = file to ext
                message.put("hash", hash).put("ext", ext)
            }
            else -> {
                val (hash, ext) = fileFor(event.soundId ?: return@onThread) ?: return@onThread
                message.put("hash", hash).put("ext", ext)
            }
        }
        message.put("name", event.name).put("at", event.at).put("volume", LiveNet.clamp01(event.volume))
            .put("cat", if (event.cat in listOf("sfx", "music", "ambience")) event.cat else "sfx")
            .put("loop", event.loop).put("buzz", event.buzz).put("whisper", !event.to.isNullOrEmpty())
        if (event.gap > 0) message.put("gap", event.gap)
        val fadeIn = LiveNet.fadeSeconds(event.fadeIn)
        if (fadeIn > 0) message.put("fadeIn", fadeIn)
        event.by?.let { message.put("by", it.take(40)) }
        if (!event.to.isNullOrEmpty()) {
            for (peer in event.to) if (peers.containsKey(peer)) sendTo(peer, message)
            return@onThread
        }
        val endless = event.loop || event.gap > 0
        val until = if (endless || event.duration <= 0) Long.MAX_VALUE else event.at + (event.duration * 1000).toLong() + 1000
        active[event.pid] = Active(message, event.group, until)
        broadcast(message)
    }

    fun stop(group: String, fade: Double = 0.0) = onThread {
        active.entries.removeAll { it.value.group == group }
        val seconds = LiveNet.fadeSeconds(fade)
        val m = jsonOf("t" to "stop", "group" to group)
        if (seconds > 0) m.put("fade", seconds)
        broadcast(m)
    }

    fun volume(group: String, volume: Double) = onThread {
        for (a in active.values) if (a.group == group) a.message.put("volume", LiveNet.clamp01(volume))
        broadcast(jsonOf("t" to "volume", "group" to group, "volume" to LiveNet.clamp01(volume)))
    }

    fun stopAll() = onThread {
        active.clear()
        broadcast(jsonOf("t" to "stopAll"))
    }

    /** The ambience playing; fade: seconds listeners fade over for this change (a scene change). */
    fun setAmbience(layers: List<AmbienceLayer>, fade: Double = 0.0) = onThread {
        val out = JSONArray()
        for (layer in layers) {
            val base = jsonOf("key" to layer.key, "name" to layer.name, "volume" to LiveNet.clamp01(layer.volume))
            if (layer.kind == "builtin") out.put(base.put("builtin", layer.ref))
            else fileFor(layer.ref)?.let { (hash, ext) -> out.put(base.put("hash", hash).put("ext", ext)) }
        }
        ambience = jsonOf("t" to "ambience", "layers" to out)
        val seconds = LiveNet.fadeSeconds(fade)
        // The fade is for this change only; late joiners just get the layers.
        broadcast(if (seconds > 0) ambience.copy().put("fade", seconds) else ambience)
    }

    fun setScene(sceneName: String?) = onThread {
        scene = jsonOf("t" to "scene", "name" to sceneName)
        broadcast(scene)
    }

    fun setPrefetch(soundIds: List<String>) = onThread {
        prefetchIds = soundIds.distinct()
        broadcast(prefetchMessage())
    }

    private fun pruneActive() {
        val now = LiveNet.now()
        active.entries.removeAll { it.value.until < now }
    }

    /** Removes a listener from the session. */
    fun kick(peer: String) = onThread {
        if (!peers.containsKey(peer)) return@onThread
        transport.send(peer, jsonOf("t" to "kicked"))
        transport.kick(peer)
        peers.remove(peer)
        emitPeers()
    }

    // ---- Handouts ----

    /**
     * A picture for every listener's screen (`file` on disk, `hash` its
     * SHA-256), or (to: peers) secretly for just those listeners. Showing one
     * again (same id) moves it to the end of the list.
     */
    fun handout(id: String, file: File, hash: String, ext: String, title: String, to: List<String>? = null) = onThread {
        if (!LiveNet.isHash(hash) || ext !in listOf("jpg", "png")) return@onThread
        val item = jsonOf("id" to id.take(80), "hash" to hash, "ext" to ext, "title" to LiveNet.cleanTitle(title), "at" to LiveNet.now())
        if (!to.isNullOrEmpty()) item.put("to", JSONArray(to.take(50)))
        files[hash] = file to ext
        handouts.removeAll { it.getString("id") == item.getString("id") }
        handouts.add(item)
        while (handouts.size > 20) handouts.removeAt(0)
        val message = handoutMessage(item).put("t", "handout")
        if (to.isNullOrEmpty()) broadcast(message) else for (peer in to) if (peers.containsKey(peer)) sendTo(peer, message)
    }

    fun showHandout(id: String) = onThread {
        val item = handouts.firstOrNull { it.getString("id") == id } ?: return@onThread
        val (file, ext) = files[item.getString("hash")] ?: return@onThread
        val to = item.optJSONArray("to")?.values()?.map { it.toString() }
        handout(id, file, item.getString("hash"), ext, item.optString("title"), to)
    }

    /** What listeners are told about a handout (not who else got it). */
    private fun handoutMessage(item: JSONObject): JSONObject {
        val out = item.copy()
        if (out.has("to")) { out.remove("to"); out.put("secret", true) }
        return out
    }

    fun end() {
        onThread {
            gameTimer?.cancel(false)
            transport.send(null, jsonOf("t" to "bye"))
        }
        thread.schedule({ transport.close(); thread.shutdown() }, 200, TimeUnit.MILLISECONDS)
    }

    /** Waits until everything queued so far has run (tests). */
    fun flush() { thread.submit {}.get(5, TimeUnit.SECONDS) }
}
