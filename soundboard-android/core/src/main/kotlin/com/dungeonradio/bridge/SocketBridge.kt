package com.dungeonradio.bridge

import com.dungeonradio.live.Http
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * WebSockets for the page, for sending a library through the relay
 * (soundboard-mac/src/library-send.js). The page's own WebSocket can't reach
 * the relay (its content security policy only allows this phone), so it asks
 * for one here: socketOpen/Send/Close, and events on the "socket" channel:
 * { id, type: "open" | "message" | "close", data }.
 */
class SocketBridge(private val platform: Platform) {
    private val sockets = ConcurrentHashMap<String, WebSocket>()
    private val next = AtomicInteger(1)

    fun open(url: String): String {
        require(Regex("^wss?://[^\\s/]+(/\\S*)?$").matches(url)) { "That isn’t a relay address." }
        val id = "s${next.getAndIncrement()}"
        val request = Request.Builder().url(url.replaceFirst(Regex("^ws"), "http")).build()
        sockets[id] = Http.client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = emit(id, "open", null)
            override fun onMessage(webSocket: WebSocket, text: String) = emit(id, "message", text)
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (sockets.remove(id) != null) emit(id, "close", null)
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (sockets.remove(id) != null) emit(id, "close", t.message ?: "Lost the connection")
            }
        })
        return id
    }

    fun send(id: String, text: String): Boolean = sockets[id]?.send(text) ?: false

    fun close(id: String) {
        sockets.remove(id)?.close(1000, null)
    }

    fun closeAll() {
        for (id in sockets.keys.toList()) close(id)
    }

    private fun emit(id: String, type: String, data: String?) {
        platform.emit("socket", JSONObject().put("id", id).put("type", type).put("data", data ?: JSONObject.NULL).toString())
    }
}
