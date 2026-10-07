package com.dungeonradio.bridge

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Base64
import java.util.concurrent.Executors

/**
 * The native side of the web screens: what DRNative.call and callAsync answer
 * (see web/android-main.js). The Android app's JavaScript interface hands
 * every call here; nothing in this class needs Android, so it's tested on the JVM.
 *
 * files: the app's private folder (the library is /sounds in it).
 * builtinDir: the built-in ambience loops. cacheDir: Live Session files.
 */
class NativeBridge(
    val files: AppFiles,
    private val builtinDir: File,
    cacheDir: File,
    private val platform: Platform,
) {
    private val work = Executors.newCachedThreadPool { r -> Thread(r, "native-call").apply { isDaemon = true } }
    val live = LiveBridge(files, cacheDir, platform) { server.base }
    val server = SoundServer(mapOf(
        "local" to { files.resolve(LIBRARY) },
        "builtin" to { builtinDir },
        "live" to { cacheDir },
    )).start()

    /** A call answered at once: {"value": …} or {"error": "…"}. */
    fun call(name: String, json: String?): String = try {
        val args = parse(json)
        JSONObject().put("value", wrap(callSync(name, args))).toString()
    } catch (e: Exception) {
        JSONObject().put("error", e.message ?: e.javaClass.simpleName).toString()
    }

    /** A call answered later, through Platform.resolve(id, …). */
    fun callAsync(name: String, json: String?, id: String) {
        val done = { value: Any?, error: String? ->
            if (error != null) platform.resolve(id, null, error) else platform.resolve(id, encode(value), null)
        }
        try {
            val args = parse(json)
            when (name) {
                "pickFiles" -> {
                    val importDir = files.resolve("/import").also { it.mkdirs() }
                    platform.pickFiles(args.optString("kind", "audio"), args.optBoolean("multiple"), importDir) { picked ->
                        done(JSONArray(picked.map { (file, display) -> JSONObject().put("file", pagePath(file)).put("name", display) }), null)
                    }
                }
                "micAccess" -> platform.micAccess { ok -> done(ok, null) }
                "premiumPurchase" -> platform.premiumPurchase(args.optString("id")) { status, error ->
                    if (error != null) done(null, error) else done(JSONObject().put("status", status ?: platform.premiumStatus()), null)
                }
                "premiumRestore" -> platform.premiumRestore { status -> done(status, null) }
                "liveHandoutSave" -> live.handoutSave(args.optString("id")) { ok -> done(ok, null) }
                "liveHostStart", "liveListen", "liveHandoutSend" -> work.execute {
                    try {
                        done(when (name) {
                            "liveHostStart" -> live.hostStart(args)
                            "liveListen" -> live.listen(args)
                            else -> live.handoutSend(args)
                        }, null)
                    } catch (e: Exception) { done(null, e.message ?: "Something went wrong") }
                }
                else -> done(null, "No native call $name")
            }
        } catch (e: Exception) {
            done(null, e.message ?: e.javaClass.simpleName)
        }
    }

    private fun callSync(name: String, args: JSONObject): Any? = when (name) {
        "serverBase" -> server.base
        "builtins" -> JSONArray(builtinDir.list()?.filter { it.endsWith(".wav") }?.sorted() ?: emptyList<String>())
        "readBuiltin" -> {
            val file = File(builtinDir, File(args.optString("file")).name)
            if (!file.isFile) throw IllegalArgumentException("No built-in sound ${file.name}")
            Base64.getEncoder().encodeToString(file.readBytes())
        }
        "notify" -> { platform.notify(args.optString("title", "Dungeon Radio").take(80), args.optString("body").take(200)); null }
        "openExternal" -> {
            val url = args.optString("url")
            if (url.startsWith("https://")) platform.openExternal(url)
            null
        }
        "probeDuration" -> {
            val file = files.resolve(args.optString("file"))
            if (file.isFile) platform.mediaDuration(file) else null
        }
        "premiumStatus" -> platform.premiumStatus()
        "premiumTestUnlock" -> platform.premiumTestUnlock(args.optBoolean("on"))
        "liveStatus" -> live.status().put("bonjour", true)
        "liveHostEvent" -> { live.hostEvent(args); null }
        "liveLeave" -> { live.leave(); live.status() }
        "liveBrowse" -> { live.browse(args.optBoolean("on")); null }
        "liveOffer" -> { live.offer(args.optJSONArray("sounds") ?: JSONArray()); null }
        "liveCue" -> { live.cue(args); null }
        "liveRoll" -> { live.roll(args); null }
        "liveAvatar" -> live.setAvatar(args.optString("data"))
        "liveHandoutShow" -> { live.handoutShow(args.optString("id")); null }
        else -> throw IllegalArgumentException("No native call $name")
    }

    /** A file in the app's folder, as the page names it ("/import/…"). */
    fun pagePath(file: File): String {
        val path = file.canonicalPath
        require(path.startsWith(files.root.path + File.separator)) { "Outside the app folder" }
        return path.substring(files.root.path.length).replace(File.separatorChar, '/')
    }

    fun close() {
        live.leave()
        server.close()
        work.shutdownNow()
    }

    companion object {
        const val LIBRARY = "/sounds"

        private fun parse(json: String?): JSONObject {
            if (json.isNullOrBlank() || json == "null") return JSONObject()
            val t = json.trim()
            return if (t.startsWith("{")) JSONObject(t) else JSONObject()
        }

        private fun wrap(value: Any?): Any = value ?: JSONObject.NULL

        /** A value as JSON text. */
        fun encode(value: Any?): String = when (value) {
            null -> "null"
            is String -> JSONObject.quote(value)
            is JSONObject, is JSONArray -> value.toString()
            else -> JSONObject.wrap(value)?.toString() ?: "null"
        }
    }
}
