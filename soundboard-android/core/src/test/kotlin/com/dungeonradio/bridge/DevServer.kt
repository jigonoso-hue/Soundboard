package com.dungeonradio.bridge

import com.dungeonradio.live.LanPublisher
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors

/**
 * The app's real native side (NativeBridge) for a desktop browser, for the
 * end-to-end tests in web-test/: the web screens at http://127.0.0.1:port/,
 * DRNative over POST /native (as Android's JavaScript interface would call
 * it), and what the app would push to the page (events and async answers)
 * through GET /events.
 *
 *   java -cp … com.dungeonradio.bridge.DevServerKt <webDir> <ambienceDir> <dataDir>
 * prints "READY <port>" once it's listening.
 */
fun main(args: Array<String>) {
    val (webDir, ambienceDir, dataDir) = args.map { File(it) }
    val outbox = ConcurrentLinkedQueue<JSONObject>()
    val picks = ConcurrentLinkedQueue<Pair<File, String>>()
    var sessions = JSONArray()
    var browsing: ((List<JSONObject>) -> Unit)? = null

    val platform = object : Platform {
        override fun emit(channel: String, json: String) { outbox.add(JSONObject().put("type", "emit").put("channel", channel).put("json", json)) }
        override fun resolve(id: String, json: String?, error: String?) {
            outbox.add(JSONObject().put("type", "resolve").put("id", id).put("json", json ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL))
        }
        override fun notify(title: String, body: String) { outbox.add(JSONObject().put("type", "notify").put("title", title).put("body", body)) }
        override fun openExternal(url: String) {}
        override fun pickFiles(kind: String, multiple: Boolean, importDir: File, done: (List<Pair<File, String>>) -> Unit) {
            val out = ArrayList<Pair<File, String>>()
            while (true) {
                val (from, name) = picks.poll() ?: break
                val copy = File(importDir, "${System.nanoTime()}-${from.name}")
                from.copyTo(copy, overwrite = true)
                out.add(copy to name)
            }
            done(out)
        }
        override fun micAccess(done: (Boolean) -> Unit) = done(true)
        override fun saveImage(file: File, name: String, mime: String, done: (Boolean) -> Unit) = done(true)
        override fun lanPublisher() = object : LanPublisher {
            override fun publish(name: String, port: Int) { outbox.add(JSONObject().put("type", "published").put("name", name).put("port", port)) }
            override fun unpublish() {}
        }
        override fun browse(on: Boolean, found: (List<JSONObject>) -> Unit) {
            browsing = if (on) found else null
            if (on) found((0 until sessions.length()).map { sessions.getJSONObject(it) })
        }
        override fun sessionActive(active: Boolean) { outbox.add(JSONObject().put("type", "session").put("active", active)) }
        override val deviceName = "Test Phone"
    }

    val bridge = NativeBridge(AppFiles(File(dataDir, "app")), ambienceDir, File(dataDir, "live-cache"), platform)
    val files = bridge.files
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.executor = Executors.newCachedThreadPool()

    fun reply(ex: HttpExchange, code: Int, type: String, body: ByteArray) {
        ex.responseHeaders.add("Content-Type", type)
        ex.sendResponseHeaders(code, if (body.isEmpty()) -1 else body.size.toLong())
        if (body.isNotEmpty()) ex.responseBody.use { it.write(body) }
        ex.close()
    }

    server.createContext("/native") { ex ->
        val request = JSONObject(ex.requestBody.readBytes().decodeToString())
        val a = request.optJSONObject("args") ?: JSONObject()
        val p = a.optString("p")
        val answer = try {
            val value: Any? = when (request.optString("op")) {
                "fsExists" -> files.exists(p)
                "fsMkdir" -> files.mkdir(p)
                "fsRead" -> files.read(p)
                "fsReadText" -> files.readText(p)
                "fsWrite" -> files.write(p, a.optString("data"))
                "fsWriteText" -> files.writeText(p, a.optString("data"))
                "fsRename" -> files.rename(a.optString("a"), a.optString("b"))
                "fsRm" -> files.rm(p)
                "fsCopy" -> files.copy(a.optString("a"), a.optString("b"))
                "fsList" -> files.list(p)
                "fsStat" -> files.stat(p)
                "call" -> bridge.call(a.optString("name"), a.optString("json"))
                "async" -> { bridge.callAsync(a.optString("name"), a.optString("json"), a.optString("id")); null }
                else -> throw IllegalArgumentException("Unknown ${request.optString("op")}")
            }
            JSONObject().put("value", value ?: JSONObject.NULL)
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: e.javaClass.simpleName)
        }
        reply(ex, 200, "application/json", answer.toString().toByteArray())
    }

    server.createContext("/events") { ex ->
        val list = JSONArray()
        while (true) list.put(outbox.poll() ?: break)
        reply(ex, 200, "application/json", list.toString().toByteArray())
    }

    // Test controls: the next files the "system picker" hands over, and the sessions "on the Wi-Fi".
    server.createContext("/test/pick") { ex ->
        val list = JSONArray(ex.requestBody.readBytes().decodeToString())
        for (i in 0 until list.length()) list.getJSONObject(i).let { picks.add(File(it.getString("path")) to it.getString("name")) }
        reply(ex, 204, "text/plain", ByteArray(0))
    }
    server.createContext("/test/sessions") { ex ->
        sessions = JSONArray(ex.requestBody.readBytes().decodeToString())
        browsing?.invoke((0 until sessions.length()).map { sessions.getJSONObject(it) })
        reply(ex, 204, "text/plain", ByteArray(0))
    }

    val mime = mapOf("html" to "text/html", "js" to "text/javascript", "css" to "text/css", "svg" to "image/svg+xml", "png" to "image/png", "json" to "application/json")
    server.createContext("/") { ex ->
        val path = ex.requestURI.path.let { if (it == "/") "/index.html" else it }
        val file = File(webDir, path).canonicalFile
        if (!file.path.startsWith(webDir.canonicalPath) || !file.isFile) reply(ex, 404, "text/plain", ByteArray(0))
        else reply(ex, 200, mime[file.extension] ?: "application/octet-stream", file.readBytes())
    }

    server.start()
    println("READY ${server.address.port}")
}
