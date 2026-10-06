package com.dungeonradio.live

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.java_websocket.WebSocket as LanSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * How a host reaches its listeners: at the table (a WebSocket server on this
 * device, advertised on the local network) or online (through the relay).
 * Callbacks arrive on the transport's own threads; LiveHost moves them onto
 * its own.
 */
interface HostTransport {
    var onJoin: (peer: String) -> Unit
    var onLeave: (peer: String) -> Unit
    var onMessage: (peer: String, message: JSONObject) -> Unit
    /** Online only: the relay gave (or gave back) the session code. */
    var onCode: (code: String) -> Unit
    var onReconnecting: () -> Unit
    var onFailed: (message: String) -> Unit

    /** Starts; calls back with null once ready, or an error message. */
    fun start(ready: (error: String?) -> Unit)
    /** To one listener, or (peer null) to everyone. */
    fun send(peer: String?, message: JSONObject)
    /** Disconnects a listener (after the "kicked" message has gone out). */
    fun kick(peer: String)
    fun close()
}

/** Shared HTTP client: one connection pool and thread pool for every socket. */
object Http {
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
}

/** Advertises a session on the local network (Android: NsdManager). */
interface LanPublisher {
    fun publish(name: String, port: Int)
    fun unpublish()
}

/** At the table: a WebSocket server on this device. */
class LanHostTransport(private val name: String, private val publisher: LanPublisher? = null) : HostTransport {
    override var onJoin: (String) -> Unit = {}
    override var onLeave: (String) -> Unit = {}
    override var onMessage: (String, JSONObject) -> Unit = { _, _ -> }
    override var onCode: (String) -> Unit = {}
    override var onReconnecting: () -> Unit = {}
    override var onFailed: (String) -> Unit = {}

    private val sockets = ConcurrentHashMap<String, LanSocket>()
    private val peerOf = ConcurrentHashMap<LanSocket, String>()
    private var nextPeer = 1
    private var server: WebSocketServer? = null
    /** The port listeners connect to, once started. */
    var boundPort = 0
        private set

    override fun start(ready: (String?) -> Unit) {
        var started = false
        val server = object : WebSocketServer(InetSocketAddress(0)) {
            override fun onOpen(conn: LanSocket, handshake: ClientHandshake) {
                val peer = synchronized(this@LanHostTransport) { "l${nextPeer++}" }
                sockets[peer] = conn
                peerOf[conn] = peer
                onJoin(peer)
            }

            override fun onClose(conn: LanSocket, code: Int, reason: String?, remote: Boolean) {
                val peer = peerOf.remove(conn) ?: return
                sockets.remove(peer)
                onLeave(peer)
            }

            override fun onMessage(conn: LanSocket, message: String) {
                if (message.length > LiveNet.MAX_MESSAGE) return
                val peer = peerOf[conn] ?: return
                LiveNet.parse(message)?.let { onMessage(peer, it) }
            }

            override fun onError(conn: LanSocket?, ex: Exception) {
                if (conn == null && !started) { started = true; ready("Couldn't start a local session (${ex.message}).") }
            }

            override fun onStart() {
                boundPort = this.port
                publisher?.publish(name, boundPort)
                if (!started) { started = true; ready(null) }
            }
        }
        server.isReuseAddr = true
        server.connectionLostTimeout = 30
        this.server = server
        server.start()
    }

    override fun send(peer: String?, message: JSONObject) {
        val text = message.toString()
        if (peer != null) sockets[peer]?.let { if (it.isOpen) it.send(text) }
        else for (socket in sockets.values) if (socket.isOpen) socket.send(text)
    }

    override fun kick(peer: String) {
        val socket = sockets[peer] ?: return
        Thread { Thread.sleep(100); socket.close(1000, "kicked") }.start()
    }

    override fun close() {
        try { publisher?.unpublish() } catch (_: Exception) {}
        for (socket in sockets.values) try { socket.close(1000, "ended") } catch (_: Exception) {}
        try { server?.stop(500) } catch (_: Exception) {}
    }
}

/** Online: through the relay, which routes messages and gives the session a code. */
class RelayHostTransport(url: String) : HostTransport {
    override var onJoin: (String) -> Unit = {}
    override var onLeave: (String) -> Unit = {}
    override var onMessage: (String, JSONObject) -> Unit = { _, _ -> }
    override var onCode: (String) -> Unit = {}
    override var onReconnecting: () -> Unit = {}
    override var onFailed: (String) -> Unit = {}

    private val base = LiveNet.relayUrl(url)
    private val peers = ConcurrentHashMap.newKeySet<String>()
    private val timers = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "relay-host").apply { isDaemon = true } }
    @Volatile private var socket: WebSocket? = null
    @Volatile private var closed = false
    private var code: String? = null
    private var key: String? = null
    private var retry = 0
    private var retryTimer: ScheduledFuture<*>? = null
    private var firstReady: ((String?) -> Unit)? = null

    override fun start(ready: (String?) -> Unit) {
        if (base == null) { ready("Set a relay server address first."); return }
        firstReady = ready
        connect()
    }

    @Synchronized
    private fun connect() {
        val query = StringBuilder("role=host")
        if (code != null) query.append("&code=").append(code).append("&key=").append(key)
        val uri = URI(base!!)
        val url = "$base${if (uri.query == null) "?" else "&"}$query"
        val request = Request.Builder().url(url.replaceFirst(Regex("^ws"), "http")).build()
        lateinit var mine: WebSocket
        mine = Http.client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = LiveNet.parse(text) ?: return
                when (m.str("t")) {
                    "room" -> {
                        code = m.str("code"); key = m.str("key"); retry = 0
                        code?.let(onCode)
                        firstReady?.let { firstReady = null; it(null) }
                    }
                    "join" -> m.str("peer")?.let { peers.add(it); onJoin(it) }
                    "leave" -> m.str("peer")?.let { peers.remove(it); onLeave(it) }
                    "msg" -> {
                        val inner = m.optJSONObject("msg") ?: return
                        if (inner.opt("t") is String) m.str("peer")?.let { onMessage(it, inner) }
                    }
                    "no-room", "busy" -> fail(if (m.str("t") == "busy") "The relay server is full right now." else "The session expired on the relay server.")
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = dropped(webSocket, t.message)
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket, null)
        })
        socket = mine
    }

    private fun dropped(webSocket: WebSocket, error: String?) {
        if (closed || socket !== webSocket) return
        firstReady?.let {
            firstReady = null
            closed = true
            it("Couldn't reach the relay server (${error ?: "closed"}).")
            return
        }
        // Listeners stay in the room for a minute; reconnect and resume.
        onReconnecting()
        for (peer in peers.toList()) onLeave(peer)
        peers.clear()
        retry += 1
        if (retry > 8) { fail("Lost the connection to the relay server."); return }
        retryTimer = timers.schedule({ if (!closed) connect() }, minOf(8000L, 500L shl retry), TimeUnit.MILLISECONDS)
    }

    private fun fail(message: String) {
        closed = true
        retryTimer?.cancel(false)
        try { socket?.close(1000, null) } catch (_: Exception) {}
        firstReady?.let { firstReady = null; it(message); return }
        onFailed(message)
    }

    override fun send(peer: String?, message: JSONObject) {
        val envelope = JSONObject().put("t", "send").put("msg", message)
        if (peer != null) envelope.put("to", peer)
        socket?.send(envelope.toString())
    }

    override fun kick(peer: String) {
        socket?.send(JSONObject().put("t", "kick").put("peer", peer).toString())
    }

    override fun close() {
        closed = true
        retryTimer?.cancel(false)
        try { socket?.close(1000, "ended") } catch (_: Exception) {}
        timers.shutdown()
    }

    val sessionCode: String? get() = code
}
