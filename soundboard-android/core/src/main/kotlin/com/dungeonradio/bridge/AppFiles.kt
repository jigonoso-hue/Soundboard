package com.dungeonradio.bridge

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Base64

/**
 * The app's private files, for the web screens' `fs` (web/node-shim.js).
 * Paths from the page are absolute from the app's root ("/sounds/library.json");
 * nothing outside it can be reached. Answers are in the form DRNative gives
 * them to the page: base64 for bytes, JSON text for lists and stats, null for
 * a missing file.
 */
class AppFiles(root: File) {
    val root: File = root.canonicalFile.also { it.mkdirs() }

    /** The file at a page path, or an error for one outside the app's folder. */
    fun resolve(p: String): File {
        val parts = ArrayList<String>()
        for (part in p.replace('\\', '/').split('/')) {
            when (part) {
                "", "." -> {}
                ".." -> if (parts.isNotEmpty()) parts.removeAt(parts.size - 1)
                else -> parts.add(part)
            }
        }
        val file = if (parts.isEmpty()) root else File(root, parts.joinToString(File.separator))
        val canonical = file.canonicalFile
        if (canonical != root && !canonical.path.startsWith(root.path + File.separator)) throw SecurityException("Outside the app folder")
        return file
    }

    fun exists(p: String) = resolve(p).exists()
    fun mkdir(p: String): Boolean { resolve(p).mkdirs(); return true }

    fun read(p: String): String? {
        val f = resolve(p)
        return if (f.isFile) Base64.getEncoder().encodeToString(f.readBytes()) else null
    }

    fun readText(p: String): String? {
        val f = resolve(p)
        return if (f.isFile) f.readText() else null
    }

    fun write(p: String, base64: String): Boolean = writeBytes(resolve(p), Base64.getDecoder().decode(base64))
    fun writeText(p: String, text: String): Boolean = writeBytes(resolve(p), text.toByteArray())

    /** Writes through a temporary file, so a crash never leaves half a file. */
    private fun writeBytes(f: File, bytes: ByteArray): Boolean {
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, ".${f.name}.tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) { f.delete(); if (!tmp.renameTo(f)) { tmp.delete(); f.writeBytes(bytes) } }
        return true
    }

    fun rename(a: String, b: String): Boolean {
        val from = resolve(a)
        val to = resolve(b)
        if (!from.exists()) return false
        to.parentFile?.mkdirs()
        if (to.exists() && from.isFile) to.delete()
        return from.renameTo(to)
    }

    fun rm(p: String): Boolean {
        val f = resolve(p)
        if (f == root) return false
        f.deleteRecursively()
        return true
    }

    fun copy(a: String, b: String): Boolean {
        val from = resolve(a)
        if (!from.isFile) return false
        val to = resolve(b)
        to.parentFile?.mkdirs()
        from.copyTo(to, overwrite = true)
        return true
    }

    fun list(p: String): String = JSONArray(resolve(p).list()?.sorted() ?: emptyList<String>()).toString()

    fun stat(p: String): String {
        val f = resolve(p)
        if (!f.exists()) return "null"
        return JSONObject().put("size", if (f.isFile) f.length() else 0).put("mtime", f.lastModified()).put("dir", f.isDirectory).toString()
    }
}
