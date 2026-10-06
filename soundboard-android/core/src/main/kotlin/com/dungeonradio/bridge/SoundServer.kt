package com.dungeonradio.bridge

import java.io.BufferedInputStream
import java.io.File
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Serves sounds to the web screens, as the Mac's sound:// protocol does:
 *   {base}local/<file>    a library sound (in the library folder)
 *   {base}builtin/<file>  a built-in ambience loop
 *   {base}live/<file>     a Live Session file (the session cache)
 * with byte ranges, so long songs seek without loading the whole file.
 * Only this device can reach it (127.0.0.1), and only with the secret in
 * `base`, so other apps on the phone can't read the library.
 */
class SoundServer(
    private val folders: Map<String, () -> File?>,
) {
    private val secret = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    private val server = ServerSocket()
    private val pool = Executors.newCachedThreadPool { r -> Thread(r, "sound-server").apply { isDaemon = true } }
    @Volatile private var running = false

    /** http://127.0.0.1:port/secret/ — what the page puts before host/file. */
    val base: String get() = "http://127.0.0.1:${server.localPort}/$secret/"

    fun start(): SoundServer {
        server.reuseAddress = true
        server.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
        running = true
        pool.execute {
            while (running) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                pool.execute { serve(socket) }
            }
        }
        return this
    }

    fun close() {
        running = false
        try { server.close() } catch (_: Exception) {}
        pool.shutdownNow()
    }

    /** The file for a request path (/secret/host/name), or null. */
    fun fileFor(path: String): File? {
        val parts = path.trimStart('/').split('/', limit = 3)
        if (parts.size != 3 || parts[0] != secret) return null
        val dir = folders[parts[1]]?.invoke() ?: return null
        val name = try { URLDecoder.decode(parts[2], "UTF-8") } catch (_: Exception) { return null }
        // A plain file name in that folder; nothing else.
        if (name.isEmpty() || name.contains('/') || name.contains('\\') || name.startsWith(".")) return null
        val file = File(dir, name)
        return if (file.isFile) file else null
    }

    private fun serve(socket: Socket) {
        socket.use { s ->
            s.soTimeout = 15_000
            val input = BufferedInputStream(s.getInputStream())
            val out = s.getOutputStream()
            val requestLine = readLine(input) ?: return
            val headers = HashMap<String, String>()
            while (true) {
                val line = readLine(input) ?: return
                if (line.isEmpty()) break
                val colon = line.indexOf(':')
                if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
            }
            val parts = requestLine.split(' ')
            if (parts.size < 2) return
            val method = parts[0]
            val path = parts[1].substringBefore('?')
            if (method == "OPTIONS") { respond(out, 204, "No Content", emptyMap()); return }
            if (method != "GET" && method != "HEAD") { respond(out, 405, "Method Not Allowed", emptyMap()); return }
            val file = fileFor(path)
            if (file == null) { respond(out, 404, "Not Found", mapOf("Content-Length" to "0")); return }
            sendFile(out, file, headers["range"], method == "HEAD")
        }
    }

    private fun sendFile(out: OutputStream, file: File, range: String?, headOnly: Boolean) {
        val size = file.length()
        val type = MIME[file.extension.lowercase()] ?: "application/octet-stream"
        val common = mapOf("Content-Type" to type, "Accept-Ranges" to "bytes", "Cache-Control" to "no-cache")
        var start = 0L
        var end = size - 1
        var partial = false
        val m = range?.let { RANGE.matchEntire(it.trim()) }
        if (m != null && size > 0) {
            val (a, b) = m.destructured
            when {
                a.isEmpty() && b.isNotEmpty() -> start = maxOf(0, size - b.toLong())
                a.isNotEmpty() -> { start = a.toLong(); if (b.isNotEmpty()) end = minOf(size - 1, b.toLong()) }
            }
            if (start >= size || start > end) {
                respond(out, 416, "Range Not Satisfiable", common + mapOf("Content-Range" to "bytes */$size", "Content-Length" to "0"))
                return
            }
            partial = true
        }
        val length = if (size == 0L) 0 else end - start + 1
        val headers = common + mapOf("Content-Length" to length.toString()) +
            (if (partial) mapOf("Content-Range" to "bytes $start-$end/$size") else emptyMap())
        if (partial) respond(out, 206, "Partial Content", headers) else respond(out, 200, "OK", headers)
        if (headOnly || length == 0L) return
        RandomAccessFile(file, "r").use { raf ->
            raf.seek(start)
            val buffer = ByteArray(64 * 1024)
            var left = length
            while (left > 0) {
                val n = raf.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                if (n < 0) break
                out.write(buffer, 0, n)
                left -= n
            }
        }
        out.flush()
    }

    private fun respond(out: OutputStream, code: Int, reason: String, headers: Map<String, String>) {
        val sb = StringBuilder("HTTP/1.1 $code $reason\r\n")
        // The page (https://appassets.androidplatform.net) decodes sounds with fetch().
        sb.append("Access-Control-Allow-Origin: *\r\n")
        sb.append("Access-Control-Allow-Headers: Range\r\n")
        sb.append("Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n")
        sb.append("Connection: close\r\n")
        for ((k, v) in headers) sb.append("$k: $v\r\n")
        sb.append("\r\n")
        out.write(sb.toString().toByteArray())
        out.flush()
    }

    private fun readLine(input: BufferedInputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val c = input.read()
            if (c < 0) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            if (sb.length > 8192) return null
            sb.append(c.toChar())
        }
    }

    companion object {
        private val RANGE = Regex("^bytes=(\\d*)-(\\d*)$")
        val MIME = mapOf(
            "mp3" to "audio/mpeg", "wav" to "audio/wav", "m4a" to "audio/mp4", "aac" to "audio/aac",
            "ogg" to "audio/ogg", "oga" to "audio/ogg", "opus" to "audio/ogg", "flac" to "audio/flac",
            "webm" to "audio/webm", "mp4" to "audio/mp4", "aiff" to "audio/aiff", "aif" to "audio/aiff",
            "caf" to "audio/x-caf", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png",
        )
    }
}
