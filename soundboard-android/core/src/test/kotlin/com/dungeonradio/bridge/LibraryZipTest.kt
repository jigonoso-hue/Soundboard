package com.dungeonradio.bridge

import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Shared library files: the same zips the Mac (zip.js) and iPhone/iPad (LibraryShare.swift) make. */
class LibraryZipTest {
    private val temp = Files.createTempDirectory("library-zip-").toFile()
    private val id = "0f3a9c1e-5b7d-4e2a-9c10-1234567890ab"

    @AfterTest
    fun cleanUp() { temp.deleteRecursively() }

    @Test
    fun writesAndReadsBack() {
        val wav = File(temp, "a.wav").apply { writeBytes(ByteArray(50_000)) }
        val mp3 = File(temp, "b.mp3").apply { writeBytes(ByteArray(3000) { (it * 31).toByte() }) }
        val out = File(temp, "lib.zip")
        LibraryZip.write(out, """{"format":"dungeon-radio-library","version":1}""", listOf("sounds/$id.wav" to wav, "sounds/$id.mp3" to mp3))
        assertTrue(out.length() < 10_000, "the quiet wav is deflated, the mp3 stored")
        ZipFile(out).use { zip ->
            assertEquals(ZipEntry.STORED, zip.getEntry("sounds/$id.mp3").method)
            assertEquals(ZipEntry.DEFLATED, zip.getEntry("sounds/$id.wav").method)
        }
        val dir = File(temp, "out")
        LibraryZip.extract(out, dir)
        assertContentEquals(wav.readBytes(), File(dir, "sounds/$id.wav").readBytes())
        assertContentEquals(mp3.readBytes(), File(dir, "sounds/$id.mp3").readBytes())
        assertTrue(File(dir, LibraryZip.MANIFEST).readText().contains("dungeon-radio-library"))
        assertFailsWith<IllegalArgumentException> { LibraryZip.write(out, "{}", listOf("../evil.mp3" to mp3)) }
    }

    @Test
    fun readsAZipFromTheMac() {
        // Written by soundboard-mac/src/zip.js: the list (deflated), a wav (deflated) and an mp3 (stored).
        val fixture = File(temp, "mac.zip").apply { writeBytes(Base64.getDecoder().decode(MAC_ZIP)) }
        val dir = File(temp, "mac")
        LibraryZip.extract(fixture, dir)
        assertContentEquals(ByteArray(4000) { 7 }, File(dir, "sounds/$id.wav").readBytes())
        assertContentEquals(byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8, 9), File(dir, "sounds/$id.mp3").readBytes())
        assertTrue(File(dir, LibraryZip.MANIFEST).readText().contains("\"Hum\""))
    }

    @Test
    fun onlySafeNamesAreUnpacked() {
        val evil = File(temp, "evil.zip")
        ZipOutputStream(evil.outputStream()).use { zip ->
            for (name in listOf(LibraryZip.MANIFEST, "../escape.txt", "sounds/../../escape.mp3", "sounds/$id.mp3", "notes.txt")) {
                zip.putNextEntry(ZipEntry(name)); zip.write("x".toByteArray()); zip.closeEntry()
            }
        }
        val dir = File(temp, "inside/dir")
        LibraryZip.extract(evil, dir)
        assertEquals(setOf(LibraryZip.MANIFEST, "sounds"), dir.list()!!.toSet())
        assertFalse(File(temp, "inside/escape.txt").exists())
        assertFalse(File(temp, "escape.mp3").exists())

        val notLibrary = File(temp, "photos.zip")
        ZipOutputStream(notLibrary.outputStream()).use { zip -> zip.putNextEntry(ZipEntry("a.jpg")); zip.write(1); zip.closeEntry() }
        assertEquals("That file isn’t a Dungeon Radio library.", assertFailsWith<IllegalArgumentException> { LibraryZip.extract(notLibrary, dir) }.message)
        val junk = File(temp, "junk.zip").apply { writeText("not a zip") }
        assertEquals("That isn’t a zip file.", assertFailsWith<IllegalArgumentException> { LibraryZip.extract(junk, dir) }.message)
    }

    companion object {
        const val MAC_ZIP = "UEsDBBQAAAgIANRsUl3NguLUewAAAK0AAAAaAAAAZHVuZ2Vvbi1yYWRpby1saWJyYXJ5Lmpzb26NzEsOwiAUBdC93DEo9GOFFbgH4+BRwJAUSKDUmKZ7N8YNODyTs8PnEmmFhm3p6XLihWzIfAmmUHmDYXOlhpygJUPNLdkKfd8RLDSE70nN0vHRTJYPriOuZim47PphvExXJciAIVF00Li1CAYfli9+1fmf4fSiDcfj+ABQSwMEFAAACAgA1GxSXQBygHYVAAAAoA8AAC8AAABzb3VuZHMvMGYzYTljMWUtNWI3ZC00ZTJhLTljMTAtMTIzNDU2Nzg5MGFiLndhdu3BIQEAAADDILn+jR/jBigAAADgbVBLAwQUAAAIAADUbFJdnqvvQAkAAAAJAAAALwAAAHNvdW5kcy8wZjNhOWMxZS01YjdkLTRlMmEtOWMxMC0xMjM0NTY3ODkwYWIubXAzAQIDBAUGBwgJUEsBAhQAFAAACAgA1GxSXc2C4tR7AAAArQAAABoAAAAAAAAAAAAAAAAAAAAAAGR1bmdlb24tcmFkaW8tbGlicmFyeS5qc29uUEsBAhQAFAAACAgA1GxSXQBygHYVAAAAoA8AAC8AAAAAAAAAAAAAAAAAswAAAHNvdW5kcy8wZjNhOWMxZS01YjdkLTRlMmEtOWMxMC0xMjM0NTY3ODkwYWIud2F2UEsBAhQAFAAACAAA1GxSXZ6r70AJAAAACQAAAC8AAAAAAAAAAAAAAAAAFQEAAHNvdW5kcy8wZjNhOWMxZS01YjdkLTRlMmEtOWMxMC0xMjM0NTY3ODkwYWIubXAzUEsFBgAAAAADAAMAAgEAAGsBAAAAAA=="
    }
}
