package com.dungeonradio.live

import org.json.JSONObject
import java.io.File
import java.util.Base64

/**
 * Fetches files from the other side of a connection, a few chunks at a time,
 * most urgent first, checks their hash and caches them. Used by listeners
 * (files from the host) and by the host (players' own sounds). Not thread
 * safe: call it from the engine's own thread.
 */
class FileFetcher(private val cacheDir: File, private val send: (JSONObject) -> Unit) {
    var onArrived: (hash: String, file: File) -> Unit = { _, _ -> }
    var onFailed: (hash: String) -> Unit = {}

    private class Job(val ext: String) {
        var n: Int? = null
        var next = 0
        var inFlight = 0
        var received = 0
        val chunks = HashMap<Int, ByteArray>()
    }

    private val jobs = HashMap<String, Job>()
    /** Hashes waiting to be fetched, most urgent first. */
    private val queue = ArrayList<String>()

    fun cachePath(hash: String, ext: String) = File(cacheDir, "$hash.$ext")

    fun cached(hash: String?, ext: String?): File? {
        if (!LiveNet.isHash(hash) || !LiveNet.isExt(ext)) return null
        val file = cachePath(hash!!, ext!!)
        return if (file.exists()) file else null
    }

    fun want(hash: String?, ext: String?, urgent: Boolean) {
        if (!LiveNet.isHash(hash) || !LiveNet.isExt(ext)) return
        if (cached(hash, ext) != null) return
        jobs.getOrPut(hash!!) { Job(ext!!) }
        val queued = queue.indexOf(hash)
        if (queued >= 0 && !urgent) return
        if (queued >= 0) queue.removeAt(queued)
        if (urgent) queue.add(0, hash) else queue.add(hash)
        pump()
    }

    /** Keeps a few chunk requests in flight for the most urgent file. */
    private fun pump() {
        val hash = queue.firstOrNull() ?: return
        val job = jobs[hash] ?: return
        while (job.inFlight < LiveNet.CHUNKS_IN_FLIGHT && (job.n?.let { job.next < it } ?: (job.next == 0))) {
            send(jsonOf("t" to "need", "hash" to hash, "i" to job.next))
            job.next++
            job.inFlight++
            if (job.n == null) break // learn the chunk count first
        }
    }

    fun onChunk(message: JSONObject) {
        val hash = message.str("hash") ?: return
        val job = jobs[hash] ?: return
        val i = message.intOrNull("i") ?: return
        val n = message.intOrNull("n") ?: return
        if (n < 1 || i < 0 || i >= n || job.chunks.containsKey(i)) return
        job.n = n
        job.inFlight = maxOf(0, job.inFlight - 1)
        job.chunks[i] = try { Base64.getDecoder().decode(message.str("data") ?: "") } catch (_: Exception) { ByteArray(0) }
        job.received++
        if (job.received < n) { pump(); return }
        val total = (0 until n).sumOf { job.chunks[it]?.size ?: 0 }
        val bytes = ByteArray(total)
        var at = 0
        for (k in 0 until n) {
            val part = job.chunks[k] ?: ByteArray(0)
            System.arraycopy(part, 0, bytes, at, part.size)
            at += part.size
        }
        jobs.remove(hash)
        queue.remove(hash)
        if (LiveNet.sha256(bytes) == hash) {
            val file = cachePath(hash, job.ext)
            cacheDir.mkdirs()
            val tmp = File(file.path + ".tmp")
            tmp.writeBytes(bytes)
            tmp.renameTo(file)
            onArrived(hash, file)
        } else {
            onFailed(hash)
        }
        pump()
    }

    fun onMissing(hash: String) {
        jobs.remove(hash)
        queue.remove(hash)
        onFailed(hash)
        pump()
    }
}
