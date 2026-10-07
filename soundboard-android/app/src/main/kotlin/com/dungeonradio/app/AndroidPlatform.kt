package com.dungeonradio.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Log
import com.dungeonradio.bridge.NativeBridge
import com.dungeonradio.bridge.Platform
import com.dungeonradio.live.LanPublisher
import org.json.JSONObject
import java.io.File

/**
 * The phone side of the bridge. The screen (MainActivity) attaches itself
 * while it's open; pickers and permissions need it, everything else doesn't.
 */
class AndroidPlatform(private val context: Context) : Platform {
    private val main = Handler(Looper.getMainLooper())
    @Volatile var activity: MainActivity? = null
    @Volatile var inFront = false
    private val lan = Lan(context)
    // Premium: tells the page when it turns on or off (a purchase, a lapsed subscription).
    private val billing = Billing(context) { emit("premium:changed", NativeBridge.encode(premiumStatus())) }.also { it.start() }

    init {
        val manager = context.getSystemService(NotificationManager::class.java)!!
        manager.createNotificationChannel(NotificationChannel(CHANNEL_BUZZ, context.getString(R.string.channel_buzz), NotificationManager.IMPORTANCE_HIGH)
            .apply { description = context.getString(R.string.channel_buzz_about); enableVibration(true) })
        manager.createNotificationChannel(NotificationChannel(CHANNEL_SESSION, context.getString(R.string.channel_session), NotificationManager.IMPORTANCE_LOW)
            .apply { description = context.getString(R.string.channel_session_about); setShowBadge(false) })
    }

    override fun emit(channel: String, json: String) = toPage("window.DRBridge&&DRBridge.emit(${JSONObject.quote(channel)},${JSONObject.quote(json)})")

    override fun resolve(id: String, json: String?, error: String?) =
        toPage("window.DRBridge&&DRBridge.resolve(${JSONObject.quote(id)},${json?.let { JSONObject.quote(it) } ?: "null"},${error?.let { JSONObject.quote(it) } ?: "null"})")

    private fun toPage(script: String) {
        main.post { activity?.runScript(script) }
    }

    /** A buzz: always a vibration; a notification too if the app isn't in front. */
    override fun notify(title: String, body: String) {
        vibrate()
        if (inFront) return
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val note = Notification.Builder(context, CHANNEL_BUZZ)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        try { context.getSystemService(NotificationManager::class.java)?.notify(BUZZ_ID, note) } catch (e: SecurityException) { Log.w(TAG, "No notification permission") }
    }

    private fun vibrate() {
        val vibrator = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        else @Suppress("DEPRECATION") context.getSystemService(Vibrator::class.java)
        vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 180, 90, 260), -1))
    }

    override fun openExternal(url: String) {
        main.post {
            try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
        }
    }

    override fun pickFiles(kind: String, multiple: Boolean, importDir: File, done: (List<Pair<File, String>>) -> Unit) {
        main.post {
            val a = activity
            if (a == null) done(emptyList()) else a.pickFiles(kind, multiple, importDir, done)
        }
    }

    override fun micAccess(done: (Boolean) -> Unit) {
        main.post {
            val a = activity
            if (a == null) done(false) else a.askPermission(android.Manifest.permission.RECORD_AUDIO, done)
        }
    }

    override fun saveImage(file: File, name: String, mime: String, done: (Boolean) -> Unit) {
        main.post {
            val a = activity
            if (a == null) done(false) else a.saveFile(file, name, mime, done)
        }
    }

    override fun lanPublisher(): LanPublisher = lan.publisher()

    override fun browse(on: Boolean, found: (List<JSONObject>) -> Unit) {
        if (on) lan.browse(found) else lan.stopBrowsing()
    }

    override fun sessionActive(active: Boolean) {
        main.post {
            val intent = Intent(context, SessionService::class.java)
            if (active) {
                activity?.askNotifications()
                try { context.startForegroundService(intent) } catch (e: Exception) { Log.w(TAG, "Session service: ${e.message}") }
            } else context.stopService(intent)
        }
    }

    override fun mediaDuration(file: File): Double? = try {
        MediaMetadataRetriever().run {
            try {
                setDataSource(file.path)
                extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.let { it / 1000.0 }
            } finally { release() }
        }
    } catch (e: Exception) {
        Log.w(TAG, "Couldn't measure ${file.name}: ${e.message}")
        null
    }

    override fun premiumStatus(): JSONObject = billing.status()
    override fun premiumPurchase(id: String, done: (JSONObject?, String?) -> Unit) { billing.purchase(activity, id, done) }
    override fun premiumRestore(done: (JSONObject) -> Unit) { billing.refresh { done(billing.status()) } }
    override fun premiumTestUnlock(on: Boolean): JSONObject = billing.testUnlock(on)

    override val deviceName: String =
        (Settings.Global.getString(context.contentResolver, "device_name") ?: Build.MODEL ?: "Android").take(40)

    companion object {
        const val TAG = "DungeonRadio"
        const val CHANNEL_BUZZ = "buzz"
        const val CHANNEL_SESSION = "session"
        const val BUZZ_ID = 2
    }
}
