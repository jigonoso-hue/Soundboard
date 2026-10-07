package com.dungeonradio.app

import android.content.Context
import android.webkit.JavascriptInterface
import com.dungeonradio.bridge.AppFiles
import com.dungeonradio.bridge.NativeBridge
import com.dungeonradio.live.LiveListener
import java.io.File

/**
 * The app's native side, one per process: the bridge for the web screens
 * (core's NativeBridge) and the folders it uses. It outlives the screen, so a
 * Live Session keeps going while the app is in the background.
 */
object Native {
    lateinit var platform: AndroidPlatform
        private set
    lateinit var bridge: NativeBridge
        private set

    fun start(context: Context): NativeBridge {
        if (::bridge.isInitialized) return bridge
        val app = context.applicationContext
        val builtins = copyBuiltins(app)
        val cache = File(app.noBackupFilesDir, "live-cache").apply { mkdirs() }
        LiveListener.pruneCache(cache)
        platform = AndroidPlatform(app)
        bridge = NativeBridge(AppFiles(File(app.filesDir, "app")), builtins, cache, platform)
        return bridge
    }

    /**
     * The built-in ambience loops, copied out of the app once per version so
     * they can be served (and read) as plain files.
     */
    private fun copyBuiltins(context: Context): File {
        val dir = File(context.noBackupFilesDir, "builtin").apply { mkdirs() }
        val version = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime.toString()
        val stamp = File(dir, ".version")
        if (stamp.isFile && stamp.readText() == version) return dir
        val names = context.assets.list("ambience")?.filter { it.endsWith(".wav") } ?: emptyList()
        dir.listFiles()?.forEach { if (it.name !in names && it.name != ".version") it.delete() }
        for (name in names) {
            context.assets.open("ambience/$name").use { input -> File(dir, name).outputStream().use { input.copyTo(it) } }
        }
        stamp.writeText(version)
        return dir
    }
}

/** DRNative in the page (see web/node-shim.js and web/android-main.js). */
class JsBridge(private val bridge: NativeBridge) {
    private val files get() = bridge.files

    @JavascriptInterface fun fsExists(p: String): Boolean = safe(false) { files.exists(p) }
    @JavascriptInterface fun fsMkdir(p: String): Boolean = safe(false) { files.mkdir(p) }
    @JavascriptInterface fun fsRead(p: String): String? = safe(null) { files.read(p) }
    @JavascriptInterface fun fsReadText(p: String): String? = safe(null) { files.readText(p) }
    @JavascriptInterface fun fsWrite(p: String, data: String): Boolean = safe(false) { files.write(p, data) }
    @JavascriptInterface fun fsWriteText(p: String, data: String): Boolean = safe(false) { files.writeText(p, data) }
    @JavascriptInterface fun fsRename(a: String, b: String): Boolean = safe(false) { files.rename(a, b) }
    @JavascriptInterface fun fsRm(p: String): Boolean = safe(false) { files.rm(p) }
    @JavascriptInterface fun fsCopy(a: String, b: String): Boolean = safe(false) { files.copy(a, b) }
    @JavascriptInterface fun fsList(p: String): String = safe("[]") { files.list(p) }
    @JavascriptInterface fun fsStat(p: String): String = safe("null") { files.stat(p) }
    @JavascriptInterface fun call(name: String, json: String?): String = bridge.call(name, json)
    @JavascriptInterface fun callAsync(name: String, json: String?, id: String) = bridge.callAsync(name, json, id)

    private inline fun <T> safe(fallback: T, block: () -> T): T = try { block() } catch (e: Exception) {
        android.util.Log.w("DungeonRadio", "fs: ${e.message}")
        fallback
    }
}
