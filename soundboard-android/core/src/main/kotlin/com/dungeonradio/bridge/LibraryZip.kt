package com.dungeonradio.bridge

import java.io.File
import java.util.zip.CRC32
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/**
 * The zip part of sharing a whole library (the rules are the Mac's
 * src/library-share.js, run in the page). The same file as the Mac's zip.js
 * and the iPhone/iPad app's LibraryShare.swift writes: the list of sounds
 * (dungeon-radio-library.json), sounds/<id>.<ext> and covers/<id>.<ext>.
 * Compressed audio and pictures are stored as they are; the list and wav or
 * aiff audio are deflated.
 */
object LibraryZip {
    const val MANIFEST = "dungeon-radio-library.json"
    /** The only names read from a library file: never a path that leaves the folder. */
    val NAME = Regex("^(dungeon-radio-library\\.json|sounds/[0-9a-f-]{36}\\.[a-z0-9]{1,5}|covers/[0-9a-f-]{36}\\.[a-z0-9]{1,5})$")
    private val DEFLATE = Regex("\\.(json|wav|aif|aiff|caf)$", RegexOption.IGNORE_CASE)
    private const val MAX_ENTRY = 2L * 1024 * 1024 * 1024
    private const val MAX_TOTAL = 8L * 1024 * 1024 * 1024

    /** Writes the library file: the list, then each (name in the zip, file). */
    fun write(out: File, manifest: String, files: List<Pair<String, File>>) {
        out.parentFile?.mkdirs()
        ZipOutputStream(out.outputStream().buffered()).use { zip ->
            zip.setLevel(Deflater.BEST_COMPRESSION)
            val list = manifest.toByteArray(Charsets.UTF_8)
            zip.putNextEntry(ZipEntry(MANIFEST).apply { method = ZipEntry.DEFLATED })
            zip.write(list)
            zip.closeEntry()
            for ((name, file) in files) {
                require(NAME.matches(name) && name != MANIFEST) { "Not a library file name: $name" }
                val entry = ZipEntry(name)
                if (DEFLATE.containsMatchIn(name)) {
                    entry.method = ZipEntry.DEFLATED
                } else {
                    // Stored entries need their size and checksum up front.
                    val crc = CRC32()
                    file.inputStream().buffered().use { input ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            crc.update(buf, 0, n)
                        }
                    }
                    entry.method = ZipEntry.STORED
                    entry.size = file.length()
                    entry.compressedSize = file.length()
                    entry.crc = crc.value
                }
                zip.putNextEntry(entry)
                file.inputStream().buffered().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
    }

    /**
     * Unpacks a library file into `dir` (emptied first): only the list and
     * sounds/ and covers/ files with safe names, within size limits.
     */
    fun extract(zipFile: File, dir: File) {
        dir.deleteRecursively()
        dir.mkdirs()
        var total = 0L
        val found = try { ZipFile(zipFile) } catch (_: Exception) { throw IllegalArgumentException("That isn’t a zip file.") }
        found.use { zip ->
            if (zip.getEntry(MANIFEST) == null) throw IllegalArgumentException("That file isn’t a Dungeon Radio library.")
            for (entry in zip.entries()) {
                if (entry.isDirectory || !NAME.matches(entry.name)) continue
                val target = File(dir, entry.name)
                target.parentFile?.mkdirs()
                zip.getInputStream(entry).use { input ->
                    target.outputStream().buffered().use { output ->
                        val buf = ByteArray(64 * 1024)
                        var size = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            size += n
                            total += n
                            if (size > MAX_ENTRY || total > MAX_TOTAL) throw IllegalArgumentException("That library is too big to open.")
                            output.write(buf, 0, n)
                        }
                    }
                }
            }
        }
    }
}
