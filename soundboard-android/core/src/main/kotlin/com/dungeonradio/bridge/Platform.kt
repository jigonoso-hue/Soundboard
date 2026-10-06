package com.dungeonradio.bridge

import com.dungeonradio.live.LanPublisher
import org.json.JSONObject
import java.io.File

/**
 * What the bridge needs from the phone itself. The Android app implements it
 * (MainActivity); the tests use a stand-in. Callbacks may come on any thread.
 */
interface Platform {
    /** A native event for the page: DRBridge.emit(channel, json). */
    fun emit(channel: String, json: String)
    /** The answer to a DRNative.callAsync: DRBridge.resolve(id, json, error). */
    fun resolve(id: String, json: String?, error: String?)

    /** A buzz or other note while the app isn't in front: a notification and a vibration. */
    fun notify(title: String, body: String)
    fun openExternal(url: String)
    /**
     * The system file picker (kind "audio" or "image"). The chosen files are
     * copied into the app's folder (`importDir`); done gets (copy, display name).
     */
    fun pickFiles(kind: String, multiple: Boolean, importDir: File, done: (List<Pair<File, String>>) -> Unit)
    fun micAccess(done: (Boolean) -> Unit)
    /** Saves a picture where the user chooses (or to Pictures). */
    fun saveImage(file: File, name: String, mime: String, done: (Boolean) -> Unit)

    /** Announces a session at the table on the Wi-Fi (NSD), or null if it can't. */
    fun lanPublisher(): LanPublisher?
    /** Looks for sessions at the table: found([{ id, name, url }]) on every change. */
    fun browse(on: Boolean, found: (List<JSONObject>) -> Unit)
    /** A Live Session started or ended: keeps the app running in the background while one is on. */
    fun sessionActive(active: Boolean)

    val deviceName: String
}
