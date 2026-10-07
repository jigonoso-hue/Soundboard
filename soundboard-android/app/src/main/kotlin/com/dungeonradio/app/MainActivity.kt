package com.dungeonradio.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import java.io.File
import java.util.concurrent.Executors

/**
 * The app's one screen: the Mac app's web screens in a WebView (put together
 * by scripts/assemble-web.js into the app's assets), with DRNative for files
 * and native calls. Plain Android framework only.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private val io = Executors.newSingleThreadExecutor()

    // Pickers and permissions waiting for an answer; one of each at a time.
    private var picked: ((List<Uri>) -> Unit)? = null
    private var saved: ((Uri?) -> Unit)? = null
    private var permitted: ((Boolean) -> Unit)? = null
    private var chooser: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bridge = Native.start(this)
        Native.platform.activity = this

        val background = Color.parseColor("#13131A")
        val root = FrameLayout(this).apply { setBackgroundColor(background) }
        web = WebView(this).apply { setBackgroundColor(background) }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        // Edge to edge (Android 15 always is), with the page kept clear of the
        // bars, the camera cut-out and the keyboard.
        if (Build.VERSION.SDK_INT >= 30) {
            @Suppress("DEPRECATION") window.setDecorFitsSystemWindows(false)
            root.setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                WindowInsets.CONSUMED
            }
        }

        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Listeners' sounds start when the broadcaster plays them, not on a tap.
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            // Sounds come from the app's own server on 127.0.0.1.
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            textZoom = 100
        }
        web.addJavascriptInterface(JsBridge(bridge), "DRNative")

        web.webViewClient = object : WebViewClient() {
            // The page and its files come from the app's assets, on an https origin of its own.
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                AppAssets.response(this@MainActivity, request.url)

            // Links out of the app open in the browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == AppAssets.HOST) return false
                if (url.scheme == "https") Native.platform.openExternal(url.toString())
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // The microphone, for recording sounds.
            override fun onPermissionRequest(request: PermissionRequest) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE !in request.resources) { request.deny(); return }
                askPermission(Manifest.permission.RECORD_AUDIO) { ok ->
                    if (ok) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request.deny()
                }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                chooser?.onReceiveValue(null)
                chooser = callback
                return try { startActivityForResult(params.createIntent(), REQUEST_CHOOSER); true } catch (_: Exception) { chooser = null; false }
            }

            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d(AndroidPlatform.TAG, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(AppAssets.START)
    }

    /**
     * Back closes what's open in the page; with nothing open, the app goes to
     * the background (and keeps playing) instead of closing.
     */
    @Deprecated("Still called with the default back handling")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.DRBack ? window.DRBack() : false)") { result ->
            if (result != "true") moveTaskToBack(true)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onStart() { super.onStart(); Native.platform.inFront = true }
    override fun onStop() { super.onStop(); Native.platform.inFront = false }

    override fun onDestroy() {
        if (Native.platform.activity === this) Native.platform.activity = null
        // Closing the app for good ends the session.
        if (isFinishing) Native.bridge.live.leave()
        web.destroy()
        super.onDestroy()
    }

    fun runScript(script: String) {
        if (!isDestroyed) web.evaluateJavascript(script, null)
    }

    // ---- Pickers and permissions (for AndroidPlatform) ----

    /** The system file picker; the chosen files are copied into importDir: (copy, display name). */
    fun pickFiles(kind: String, multiple: Boolean, importDir: File, done: (List<Pair<File, String>>) -> Unit) {
        if (picked != null) { done(emptyList()); return }
        picked = { uris -> io.execute { done(uris.mapNotNull { copyIn(it, importDir) }) } }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).apply {
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, if (kind == "image") arrayOf("image/*") else arrayOf("audio/*", "video/mp4", "application/ogg"))
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        }
        try { startActivityForResult(intent, REQUEST_OPEN) } catch (_: Exception) { picked = null; done(emptyList()) }
    }

    private fun copyIn(uri: Uri, dir: File): Pair<File, String>? = try {
        val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: uri.lastPathSegment ?: "Sound"
        val ext = name.substringAfterLast('.', "").lowercase().filter { it.isLetterOrDigit() }.take(5)
        dir.mkdirs()
        val copy = File(dir, "${System.currentTimeMillis()}-${(Math.random() * 1e6).toLong()}${if (ext.isEmpty()) "" else ".$ext"}")
        contentResolver.openInputStream(uri)!!.use { input -> copy.outputStream().use { input.copyTo(it) } }
        copy to name
    } catch (e: Exception) {
        Log.w(AndroidPlatform.TAG, "Couldn't copy $uri: ${e.message}")
        null
    }

    /** "Save as…" for a file (a handout picture). */
    fun saveFile(file: File, name: String, mime: String, done: (Boolean) -> Unit) {
        if (saved != null) { done(false); return }
        saved = { uri ->
            if (uri == null) done(false)
            else io.execute {
                done(try {
                    contentResolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out) } }
                    true
                } catch (_: Exception) { false })
            }
        }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime).putExtra(Intent.EXTRA_TITLE, name)
        try { startActivityForResult(intent, REQUEST_SAVE) } catch (_: Exception) { saved = null; done(false) }
    }

    @Deprecated("The framework's own result callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        val ok = resultCode == RESULT_OK && data != null
        when (requestCode) {
            REQUEST_OPEN -> {
                val uris = ArrayList<Uri>()
                if (ok) {
                    val clip = data!!.clipData
                    if (clip != null) for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
                    else data.data?.let { uris.add(it) }
                }
                picked?.invoke(uris)
                picked = null
            }
            REQUEST_SAVE -> { saved?.invoke(if (ok) data!!.data else null); saved = null }
            REQUEST_CHOOSER -> {
                chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                chooser = null
            }
        }
    }

    fun askPermission(name: String, done: (Boolean) -> Unit) {
        if (checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED) { done(true); return }
        if (permitted != null) { done(false); return }
        permitted = done
        requestPermissions(arrayOf(name), REQUEST_PERMISSION)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode != REQUEST_PERMISSION) return
        permitted?.invoke(results.isNotEmpty() && results[0] == PackageManager.PERMISSION_GRANTED)
        permitted = null
    }

    /** Buzzes and the session notification need permission on Android 13 and later; asked once. */
    fun askNotifications() {
        if (Build.VERSION.SDK_INT < 33) return
        val prefs = getSharedPreferences("app", MODE_PRIVATE)
        if (prefs.getBoolean("askedNotifications", false)) return
        prefs.edit().putBoolean("askedNotifications", true).apply()
        askPermission(Manifest.permission.POST_NOTIFICATIONS) {}
    }

    companion object {
        private const val REQUEST_OPEN = 1
        private const val REQUEST_SAVE = 2
        private const val REQUEST_CHOOSER = 3
        private const val REQUEST_PERMISSION = 4
    }
}
