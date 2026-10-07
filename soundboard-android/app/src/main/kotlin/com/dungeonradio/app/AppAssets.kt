package com.dungeonradio.app

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.FileNotFoundException

/**
 * Serves the app's assets (the web screens) to the WebView at
 * https://appassets.androidplatform.net/assets/…, a secure origin of its own,
 * so the page gets the same rules as on the Mac: its own CSP, localStorage,
 * the microphone, and fetch() of its own files.
 */
object AppAssets {
    const val HOST = "appassets.androidplatform.net"
    const val START = "https://$HOST/assets/web/index.html"

    private val MIME = mapOf(
        "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
        "json" to "application/json", "svg" to "image/svg+xml", "png" to "image/png", "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg", "gif" to "image/gif", "webp" to "image/webp", "woff2" to "font/woff2",
        "woff" to "font/woff", "ttf" to "font/ttf", "wav" to "audio/wav", "mp3" to "audio/mpeg", "ico" to "image/x-icon",
    )

    fun response(context: Context, url: Uri): WebResourceResponse? {
        if (url.scheme != "https" || url.host != HOST) return null
        val path = url.path ?: return null
        if (!path.startsWith("/assets/")) return notFound()
        val name = path.removePrefix("/assets/")
        // No climbing out of the assets.
        if (name.isEmpty() || name.split('/').any { it == ".." || it.isEmpty() }) return notFound()
        val ext = name.substringAfterLast('.', "").lowercase()
        val mime = MIME[ext] ?: "application/octet-stream"
        return try {
            val stream = context.assets.open(name)
            WebResourceResponse(mime, if (mime.startsWith("text/") || ext == "json" || ext == "svg") "utf-8" else null, stream).apply {
                responseHeaders = mapOf("Cache-Control" to "no-cache")
            }
        } catch (_: FileNotFoundException) {
            notFound()
        }
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())
}
