package com.dungeonradio.live

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.net.URI
import java.security.MessageDigest
import java.util.Base64

// The Live Session protocol (see live-relay/PROTOCOL.md): constants and the
// small checks every message goes through. A port of the Mac app's
// src/live.js and the iPhone app's Live/LiveNet.swift; keep the three in step.

object LiveNet {
    const val VERSION = 1
    /** Advertised on the local network as _dungeonradio._tcp. */
    const val SERVICE_TYPE = "dungeonradio"
    const val CHUNK_SIZE = 256 * 1024
    const val MAX_MESSAGE = 1024 * 1024
    const val CHUNKS_IN_FLIGHT = 4
    /** Dungeon Radio's own relay server, for online sessions. */
    const val DEFAULT_RELAY = "soundboard-r1zt.onrender.com"
    const val PLAYER_SOUND_LIMIT = 5
    const val AVATAR_MAX = 32 * 1024

    val PLAYER_SOUNDS = listOf("off", "own", "gm")
    val HASH_RE = Regex("^[0-9a-f]{64}$")
    val EXT_RE = Regex("^[a-z0-9]{1,5}$")
    val BUILTIN_RE = Regex("^[a-z0-9-]+\\.wav$")
    private val BASE64_RE = Regex("^[A-Za-z0-9+/]+={0,2}$")

    fun now(): Long = System.currentTimeMillis()

    /** A message from the other side, or null if it isn't one. */
    fun parse(text: String): JSONObject? = try {
        val m = JSONObject(text)
        if (m.opt("t") is String) m else null
    } catch (_: Exception) {
        null
    }

    /** What the user typed ("relay.example.com", "https://…") as the relay's WebSocket URL. */
    fun relayUrl(input: String?): String? {
        var text = (input ?: "").trim().trimEnd('/')
        if (text.isEmpty()) return null
        text = when {
            text.matches(Regex("(?i)^https?://.*")) -> "ws" + text.substring(4)
            text.matches(Regex("(?i)^wss?://.*")) -> text
            else -> "wss://$text"
        }
        if (!text.endsWith("/live")) text += "/live"
        return try {
            val uri = URI(text)
            if (uri.host.isNullOrEmpty()) null else uri.toString()
        } catch (_: Exception) {
            null
        }
    }

    fun isHash(value: String?) = value != null && HASH_RE.matches(value)
    fun isExt(value: String?) = value != null && EXT_RE.matches(value)

    /** A fade length in seconds from a message: 0 (none) up to 10. */
    fun fadeSeconds(value: Any?): Double {
        val n = number(value) ?: return 0.0
        return if (n.isFinite() && n > 0) minOf(10.0, n) else 0.0
    }

    fun clamp01(value: Any?): Double {
        val n = number(value) ?: return 1.0
        return if (n.isFinite()) n.coerceIn(0.0, 1.0) else 1.0
    }

    fun number(value: Any?): Double? = when (value) {
        is Number -> value.toDouble()
        is String -> value.toDoubleOrNull()
        else -> null
    }

    /** A handout's title: one line, up to 60 characters. */
    fun cleanTitle(value: Any?): String =
        (if (value == null || value == JSONObject.NULL) "" else value.toString())
            .replace(Regex("[\\u0000-\\u001f]"), " ").trim().take(60)

    /**
     * A listener's picture: base64 of a JPEG or PNG of at most 32 KB, "" for
     * none, or null if it isn't one.
     */
    fun cleanAvatar(value: Any?): String? {
        if (value == null || value == JSONObject.NULL || value == "") return ""
        val text = value.toString()
        if (text.length > (AVATAR_MAX + 2) / 3 * 4 + 4 || !BASE64_RE.matches(text)) return null
        val bytes = try { Base64.getDecoder().decode(text) } catch (_: Exception) { return null }
        if (bytes.isEmpty() || bytes.size > AVATAR_MAX) return null
        val b = bytes.map { it.toInt() and 0xff }
        val jpeg = b.size >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff
        val png = b.size >= 4 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4e && b[3] == 0x47
        return if (jpeg || png) text else null
    }

    fun sha256(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return hex(digest.digest())
    }

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    /** A chunk message for part of a file, or null. */
    fun chunkOf(file: File, hash: String, ext: String, index: Int): JSONObject? = try {
        RandomAccessFile(file, "r").use { raf ->
            val size = raf.length()
            val total = maxOf(1L, (size + CHUNK_SIZE - 1) / CHUNK_SIZE).toInt()
            if (index < 0 || index >= total) return null
            val length = minOf(CHUNK_SIZE.toLong(), size - index.toLong() * CHUNK_SIZE).toInt().coerceAtLeast(0)
            val buffer = ByteArray(length)
            raf.seek(index.toLong() * CHUNK_SIZE)
            raf.readFully(buffer)
            JSONObject().put("t", "chunk").put("hash", hash).put("i", index).put("n", total).put("ext", ext)
                .put("data", Base64.getEncoder().encodeToString(buffer))
        }
    } catch (_: Exception) {
        null
    }
}

// Small helpers over org.json (Android has it built in).

fun JSONObject.str(key: String): String? = when (val v = opt(key)) {
    null, JSONObject.NULL -> null
    else -> v.toString()
}

fun JSONObject.num(key: String): Double? = LiveNet.number(opt(key))

fun JSONObject.intOrNull(key: String): Int? {
    val v = opt(key)
    return if (v is Number && v.toDouble() == Math.floor(v.toDouble()) && v.toDouble().isFinite()) v.toInt() else null
}

fun JSONObject.bool(key: String): Boolean = opt(key) == true

fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

fun JSONArray?.values(): List<Any?> =
    if (this == null) emptyList() else (0 until length()).map { opt(it) }

fun jsonOf(vararg pairs: Pair<String, Any?>): JSONObject {
    val o = JSONObject()
    for ((k, v) in pairs) o.put(k, v ?: JSONObject.NULL)
    return o
}

fun JSONObject.copy(): JSONObject = JSONObject(toString())
