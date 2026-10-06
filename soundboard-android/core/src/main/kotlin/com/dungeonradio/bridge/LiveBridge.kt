package com.dungeonradio.bridge

import com.dungeonradio.live.LanHostTransport
import com.dungeonradio.live.LiveHost
import com.dungeonradio.live.LiveListener
import com.dungeonradio.live.LiveNet
import com.dungeonradio.live.RelayHostTransport
import com.dungeonradio.live.HostTransport
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The Live Session for the web screens: the Kotlin engine (com.dungeonradio.live)
 * behind the same calls and events as the Mac's main.js (registerLiveIpc), so
 * the Mac's live.js screen runs unchanged. Events go out through
 * Platform.emit: live:status, live:command, live:roll, live:cue, live:rules,
 * live:catalog, live:avatars, live:handout and live:sessions.
 */
class LiveBridge(
    private val files: AppFiles,
    private val cacheDir: File,
    private val platform: Platform,
    private val serverBase: () -> String,
) {
    private class Host(val host: LiveHost, val transport: HostTransport, val mode: String) {
        @Volatile var peers: List<LiveHost.Peer> = emptyList()
        @Volatile var reconnecting = false
        @Volatile var code: String? = null
        var handoutDir: File? = null
    }

    private class Listen(val listener: LiveListener) {
        val handoutFiles = HashMap<String, Triple<File, String, String>>() // id -> (file, title, ext)
    }

    private val lock = Any()
    private var session: Any? = null // Host or Listen
    private val hashing = Executors.newSingleThreadExecutor { r -> Thread(r, "live-hash").apply { isDaemon = true } }
    private val hashes = HashMap<String, Pair<String, String>>() // path -> (size:mtime, hash)

    private fun emit(channel: String, payload: Any?) = platform.emit(channel, NativeBridge.encode(payload))

    private fun url(host: String, name: String) = serverBase() + host + "/" + URLEncoder.encode(name, "UTF-8").replace("+", "%20")

    // ---- Status ----

    fun status(extra: JSONObject? = null): JSONObject {
        val out = when (val s = synchronized(lock) { session }) {
            is Host -> JSONObject().put("role", "host").put("mode", s.mode).put("name", s.host.name)
                .put("code", s.code ?: JSONObject.NULL).put("reconnecting", s.reconnecting)
                .put("peers", JSONArray(s.peers.map { peerJson(it) }))
            is Listen -> JSONObject().put("role", "listen").put("state", s.listener.state.name.lowercase())
                .put("host", s.listener.hostName ?: JSONObject.NULL).put("scene", s.listener.scene ?: JSONObject.NULL)
            else -> JSONObject().put("role", JSONObject.NULL)
        }
        extra?.let { for (k in it.keys()) out.put(k, it.get(k)) }
        return out
    }

    private fun peerJson(p: LiveHost.Peer) =
        JSONObject().put("peer", p.peer).put("name", p.name).put("device", p.device).put("avatar", p.avatar)

    private fun isCurrent(s: Any) = synchronized(lock) { session === s }

    // ---- Ending ----

    fun leave() {
        val s = synchronized(lock) { session.also { session = null } } ?: return
        when (s) {
            is Host -> { s.host.end(); s.handoutDir?.deleteRecursively() }
            is Listen -> s.listener.leave()
        }
        platform.sessionActive(false)
    }

    // ---- Broadcasting ----

    /** { name, mode: "local"|"online", relay, playerSounds, catalog } → status. Blocks until started. */
    fun hostStart(args: JSONObject): JSONObject {
        leave()
        val mode = if (args.optString("mode") == "online") "online" else "local"
        val name = args.optString("name").trim().take(40).ifEmpty { "${platform.deviceName}'s game" }
        val transport: HostTransport = if (mode == "online") {
            if (LiveNet.relayUrl(args.optString("relay")) == null) throw IllegalArgumentException("Set a relay server address first.")
            RelayHostTransport(args.optString("relay"))
        } else LanHostTransport(name, platform.lanPublisher())
        val started = CountDownLatch(1)
        var error: String? = null
        transport.start { e -> error = e; started.countDown() }
        if (!started.await(20, TimeUnit.SECONDS)) error = "Couldn't start the session (no answer)."
        error?.let { transport.close(); throw IllegalStateException(it) }

        val host = LiveHost(name, transport, ::resolveSound, cacheDir)
        val s = Host(host, transport, mode)
        if (transport is RelayHostTransport) s.code = transport.sessionCode
        host.setCatalog(catalogItems(args.optJSONArray("catalog")))
        host.setPlayerSounds(args.optString("playerSounds", "off"))
        host.onPeers = { list -> s.peers = list; if (isCurrent(s)) emit("live:status", status()) }
        host.onRoll = { m -> if (isCurrent(s)) emit("live:roll", m) }
        host.onColors = { m -> if (isCurrent(s)) emit("live:roll", m.put("you", "host")) }
        host.onGame = { m -> if (isCurrent(s)) emit("live:roll", m) }
        // A player played a sound for everyone: the board plays it here and sends it on.
        host.onCue = { peer, playerName, cue ->
            if (isCurrent(s)) {
                val out = when (cue) {
                    is LiveHost.Cue.Library -> JSONObject().put("kind", "library").put("soundId", cue.soundId)
                    is LiveHost.Cue.FileCue -> JSONObject().put("kind", "file").put("hash", cue.hash).put("ext", cue.ext)
                        .put("name", cue.name).put("url", url("live", cue.file.name))
                }
                emit("live:cue", JSONObject().put("peer", peer).put("name", playerName).put("cue", out))
            }
        }
        transport.onCode = { code -> s.code = code; s.reconnecting = false; if (isCurrent(s)) emit("live:status", status()) }
        transport.onReconnecting = { s.reconnecting = true; if (isCurrent(s)) emit("live:status", status()) }
        transport.onFailed = { message ->
            val wasCurrent = synchronized(lock) { (session === s).also { if (it) session = null } }
            if (wasCurrent) {
                host.end()
                platform.sessionActive(false)
                emit("live:status", status(JSONObject().put("error", message)))
            }
        }
        synchronized(lock) { session = s }
        platform.sessionActive(true)
        return status()
    }

    /** A library sound's file, from the library's index (library.json). */
    private fun resolveSound(id: String): File? {
        val dir = files.resolve(NativeBridge.LIBRARY)
        val index = File(dir, "library.json")
        val list = try { JSONArray(index.readText()) } catch (_: Exception) { return null }
        for (i in 0 until list.length()) {
            val sound = list.optJSONObject(i) ?: continue
            if (sound.optString("id") != id) continue
            val name = sound.optString("file")
            if (name.isEmpty() || name.contains('/') || name.contains('\\')) return null
            return File(dir, name).takeIf { it.isFile }
        }
        return null
    }

    private fun catalogItems(items: JSONArray?): List<Triple<String, String, Int>> {
        val out = ArrayList<Triple<String, String, Int>>()
        if (items == null) return out
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            out.add(Triple(item.optString("id"), item.optString("name", "Sound").ifEmpty { "Sound" }, item.optInt("color")))
        }
        return out
    }

    /** What the board plays, forwarded to listeners (the Mac's live:host-event). */
    fun hostEvent(e: JSONObject) {
        val s = synchronized(lock) { session } as? Host ?: return
        val host = s.host
        when (e.optString("t")) {
            "play" -> {
                val f = e.optJSONObject("file")
                val file = if (f != null) {
                    val hash = f.optString("hash")
                    val ext = f.optString("ext")
                    if (!LiveNet.isHash(hash) || !LiveNet.isExt(ext)) return
                    // A player's own sound, from the session cache.
                    val cached = File(cacheDir, "$hash.$ext")
                    if (!cached.isFile) return
                    Triple(hash, ext, cached)
                } else null
                val to = when (val t = e.opt("to")) {
                    is JSONArray -> (0 until t.length()).map { t.optString(it) }
                    is String -> listOf(t)
                    else -> null
                }
                host.play(LiveHost.PlayEvent(
                    pid = e.optString("pid"),
                    group = e.optString("group"),
                    name = e.optString("name"),
                    at = if (e.has("at")) e.optLong("at") else LiveNet.now(),
                    volume = e.optDouble("volume", 1.0),
                    cat = e.optString("cat", "sfx"),
                    soundId = e.optString("soundId").ifEmpty { null },
                    file = file,
                    builtin = e.optString("builtin").ifEmpty { null },
                    loop = e.optBoolean("loop"),
                    gap = e.optDouble("gap", 0.0).takeIf { !it.isNaN() } ?: 0.0,
                    buzz = e.optBoolean("buzz"),
                    duration = e.optDouble("dur", 0.0).takeIf { !it.isNaN() } ?: 0.0,
                    to = to,
                    by = e.optString("by").ifEmpty { null },
                    fadeIn = e.optDouble("fadeIn", 0.0).takeIf { !it.isNaN() } ?: 0.0,
                ))
            }
            "playerSounds" -> host.setPlayerSounds(e.optString("mode"))
            "kick" -> host.kick(e.optString("peer"))
            "roll" -> host.roll(e, e.optString("by", "Broadcaster"))
            "rollResult" -> host.rollResult(e)
            "diceColor" -> host.setHostColor(e.optString("color"), e.optString("name").ifEmpty { null })
            "customDice", "ask", "askClosed", "askResult", "turns" -> host.table(e)
            "gameControl" -> host.gameControl(e)
            "catalog" -> host.setCatalog(catalogItems(e.optJSONArray("items")))
            "stop" -> host.stop(e.optString("group"), e.optDouble("fade", 0.0).takeIf { !it.isNaN() } ?: 0.0)
            "volume" -> host.volume(e.optString("group"), e.optDouble("volume", 1.0))
            "stopAll" -> host.stopAll()
            "ambience" -> {
                val layers = ArrayList<LiveHost.AmbienceLayer>()
                val list = e.optJSONArray("layers") ?: JSONArray()
                for (i in 0 until list.length()) {
                    val l = list.optJSONObject(i) ?: continue
                    layers.add(LiveHost.AmbienceLayer(l.optString("key"), l.optString("kind"), l.optString("ref"), l.optString("name"), l.optDouble("volume", 1.0)))
                }
                host.setAmbience(layers, e.optDouble("fade", 0.0).takeIf { !it.isNaN() } ?: 0.0)
            }
            "scene" -> host.setScene(e.optString("name").ifEmpty { null })
            "prefetch" -> {
                val ids = e.optJSONArray("ids") ?: JSONArray()
                host.setPrefetch((0 until ids.length()).map { ids.optString(it) })
            }
        }
    }

    /** The broadcaster sends a picture (already a JPEG from the page). → { id } */
    fun handoutSend(args: JSONObject): JSONObject {
        val s = synchronized(lock) { session } as? Host ?: throw IllegalStateException("Not broadcasting")
        val bytes = try { Base64.getDecoder().decode(args.optString("data")) } catch (_: Exception) { ByteArray(0) }
        if (bytes.isEmpty() || bytes.size > HANDOUT_MAX_BYTES) throw IllegalArgumentException("That picture is too big to send.")
        val dir = synchronized(s) { s.handoutDir ?: Files.createTempDirectory("dungeon-radio-handouts-host-").toFile().also { s.handoutDir = it } }
        val hash = LiveNet.sha256(bytes)
        val file = File(dir, "$hash.jpg")
        file.writeBytes(bytes)
        val id = "h-${java.lang.Long.toString(System.currentTimeMillis(), 36)}-${hash.take(6)}"
        val to = args.optJSONArray("to")?.let { t -> (0 until t.length()).map { t.optString(it) } }
        s.host.handout(id, file, hash, "jpg", args.optString("title"), to)
        return JSONObject().put("id", id)
    }

    fun handoutShow(id: String) {
        (synchronized(lock) { session } as? Host)?.host?.showHandout(id)
    }

    // ---- Listening ----

    /** { url, code, relay, name, avatar } → status. */
    fun listen(args: JSONObject): JSONObject {
        leave()
        val target: String = args.optString("url").ifEmpty {
            if (LiveNet.relayUrl(args.optString("relay")) == null) throw IllegalArgumentException("Set a relay server address first.")
            LiveListener.relayListenUrl(args.optString("relay"), args.optString("code"))
                ?: throw IllegalArgumentException("Enter the session code from the broadcaster.")
        }
        if (args.optString("url").isNotEmpty() && !Regex("^ws://[^/]+$").matches(target)) throw IllegalArgumentException("That isn’t a local session address.")
        val name = args.optString("name").trim().take(40).ifEmpty { platform.deviceName }
        val listener = LiveListener(cacheDir, name, "Android")
        args.optString("avatar").takeIf { it.isNotEmpty() }?.let { listener.setAvatar(it) }
        val s = Listen(listener)
        listener.onStatus = { state, _, _, error ->
            val over = state == LiveListener.State.ERROR || state == LiveListener.State.ENDED
            val wasCurrent = synchronized(lock) { (session === s).also { if (it && over) session = null } }
            if (wasCurrent) {
                if (over) platform.sessionActive(false)
                val out = JSONObject().put("role", if (over) JSONObject.NULL else "listen").put("state", state.name.lowercase())
                    .put("host", listener.hostName ?: JSONObject.NULL).put("scene", listener.scene ?: JSONObject.NULL)
                if (error != null) out.put("error", error)
                emit("live:status", out)
            }
        }
        listener.onRoll = { m -> if (isCurrent(s)) emit("live:roll", m) }
        listener.onRules = { mode -> if (isCurrent(s)) emit("live:rules", mode) }
        listener.onCatalog = { items ->
            if (isCurrent(s)) emit("live:catalog", JSONArray(items.map { JSONObject().put("id", it.id).put("name", it.name).put("color", it.color) }))
        }
        listener.onAvatar = { peer, data -> if (isCurrent(s)) emit("live:avatars", JSONArray().put(JSONObject().put("peer", peer).put("data", data))) }
        listener.onHandout = { h ->
            if (isCurrent(s)) {
                val bytes = try { h.file.readBytes() } catch (_: Exception) { null }
                if (bytes != null) {
                    val ext = h.file.extension.lowercase()
                    synchronized(s) { s.handoutFiles[h.id] = Triple(h.file, h.title, ext) }
                    emit("live:handout", JSONObject().put("id", h.id).put("title", h.title).put("at", h.at)
                        .put("show", h.show).put("secret", h.secret)
                        .put("src", "data:${if (ext == "png") "image/png" else "image/jpeg"};base64,${Base64.getEncoder().encodeToString(bytes)}"))
                }
            }
        }
        // Commands arrive even after leaving (the final "stop everything"), as on the Mac.
        listener.onCommand = { c -> emit("live:command", commandJson(c)) }
        synchronized(lock) { session = s }
        platform.sessionActive(true)
        listener.connect(target)
        return status()
    }

    private fun commandJson(c: LiveListener.Command): JSONObject = when (c) {
        is LiveListener.Command.Play -> JSONObject().put("t", "play").put("pid", c.pid).put("group", c.group)
            .put("url", c.file?.let { url("live", it.name) } ?: url("builtin", c.builtin ?: ""))
            .apply { if (c.file == null && c.builtin != null) put("builtin", c.builtin) }
            .put("name", c.name).put("at", c.at).put("volume", c.volume).put("cat", c.cat)
            .put("loop", c.loop).put("gap", c.gap).put("buzz", c.buzz).put("whisper", c.whisper)
            .put("by", c.by ?: JSONObject.NULL)
            .apply { if (c.fadeIn > 0) put("fadeIn", c.fadeIn) }
        is LiveListener.Command.Stop -> JSONObject().put("t", "stop").put("group", c.group).apply { if (c.fade > 0) put("fade", c.fade) }
        is LiveListener.Command.Volume -> JSONObject().put("t", "volume").put("group", c.group).put("volume", c.volume)
        is LiveListener.Command.StopAll -> JSONObject().put("t", "stopAll").apply { if (c.ambienceToo) put("ambienceToo", true) }
        is LiveListener.Command.Ambience -> JSONObject().put("t", "ambience").put("layers", JSONArray(c.layers.map { l ->
            JSONObject().put("key", l.key).put("name", l.name).put("volume", l.volume)
                .put("url", if (l.builtin != null) url("builtin", l.builtin) else url("live", l.file?.name ?: ""))
                .apply { if (l.builtin != null) put("builtin", l.builtin) }
        })).apply { if (c.fade > 0) put("fade", c.fade) }
    }

    private fun listening(): LiveListener? = (synchronized(lock) { session } as? Listen)?.listener

    /** This listener's picture; also checks one before a session ("" removes it). */
    fun setAvatar(data: String): Boolean = listening()?.setAvatar(data) ?: (LiveNet.cleanAvatar(data) != null)

    fun roll(message: JSONObject) { listening()?.sendRoll(message) }

    /** { sounds: [{ file (page path), name }] }: hashed here, then offered to the host. */
    fun offer(sounds: JSONArray) {
        val listener = listening() ?: return
        val list = (0 until sounds.length()).mapNotNull { sounds.optJSONObject(it) }.take(LiveNet.PLAYER_SOUND_LIMIT)
        hashing.execute {
            val out = list.mapNotNull { item ->
                val file = try { files.resolve(item.optString("file")) } catch (_: Exception) { null }
                if (file == null || !file.isFile) null else hashOf(file)?.let { Triple(file, it, item.optString("name")) }
            }
            if (listening() === listener) listener.offer(out)
        }
    }

    /** { id }: one of the broadcaster's sounds; { file }: one of this player's own. */
    fun cue(args: JSONObject) {
        val listener = listening() ?: return
        val id = args.optString("id")
        if (id.isNotEmpty()) { listener.cue(id); return }
        val file = try { files.resolve(args.optString("file")) } catch (_: Exception) { return }
        if (!file.isFile) return
        hashing.execute { hashOf(file)?.let { listener.cueHash(it) } }
    }

    private fun hashOf(file: File): String? = try {
        val stamp = "${file.length()}:${file.lastModified()}"
        synchronized(hashes) { hashes[file.path]?.takeIf { it.first == stamp }?.second }
            ?: LiveNet.sha256(file).also { synchronized(hashes) { hashes[file.path] = stamp to it } }
    } catch (_: Exception) { null }

    /** A listener keeps a handout: the phone asks where. */
    fun handoutSave(id: String, done: (Boolean) -> Unit) {
        val s = synchronized(lock) { session } as? Listen
        val entry = s?.let { synchronized(it) { it.handoutFiles[id] } }
        if (entry == null) { done(false); return }
        val (file, title, ext) = entry
        val name = title.replace(Regex("[\\\\/:*?\"<>|]"), "").trim().ifEmpty { "Handout" }
        platform.saveImage(file, "$name.$ext", if (ext == "png") "image/png" else "image/jpeg", done)
    }

    // ---- Finding sessions at the table ----

    fun browse(on: Boolean) {
        platform.browse(on) { list -> emit("live:sessions", JSONArray(list)) }
    }

    companion object {
        const val HANDOUT_MAX_BYTES = 8 * 1024 * 1024
    }
}
