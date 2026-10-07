package com.dungeonradio.app

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import com.dungeonradio.live.LanPublisher
import com.dungeonradio.live.LiveNet
import org.json.JSONObject
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.Executors
import kotlin.random.Random

/**
 * Sessions at the table on the Wi-Fi: announced and found with DNS-SD
 * (_dungeonradio._tcp), the same Bonjour service the Mac and iPhone apps use.
 */
class Lan(context: Context) {
    private val nsd = context.getSystemService(NsdManager::class.java)!!
    private val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
    private var multicast: WifiManager.MulticastLock? = null

    // ---- Announcing ----

    fun publisher(): LanPublisher = object : LanPublisher {
        private var listener: NsdManager.RegistrationListener? = null

        override fun publish(name: String, port: Int) {
            // Service names must be unique on the network, so add a short tag (as the Mac does).
            val tag = "%04x".format(Random.nextInt(0x10000))
            val info = NsdServiceInfo().apply {
                serviceName = "${name.take(50)} ($tag)"
                serviceType = SERVICE_TYPE
                setPort(port)
                setAttribute("name", name.take(60))
                setAttribute("v", LiveNet.VERSION.toString())
            }
            val l = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(info: NsdServiceInfo) { Log.i(TAG, "Announced ${info.serviceName}") }
                override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) { Log.w(TAG, "Couldn't announce the session ($code)") }
                override fun onServiceUnregistered(info: NsdServiceInfo) {}
                override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
            }
            listener = l
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
        }

        override fun unpublish() {
            listener?.let { try { nsd.unregisterService(it) } catch (_: Exception) {} }
            listener = null
        }
    }

    // ---- Finding ----

    private var discovery: NsdManager.DiscoveryListener? = null
    private val sessions = LinkedHashMap<String, JSONObject>()
    // Older Androids resolve one service at a time.
    private val resolving = Executors.newSingleThreadExecutor()

    @Synchronized
    fun browse(found: (List<JSONObject>) -> Unit) {
        stopBrowsing()
        multicast = wifi?.createMulticastLock("dungeon-radio")?.apply { setReferenceCounted(false); acquire() }
        val report = { synchronized(this) { found(sessions.values.toList()) } }
        val l = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, code: Int) { Log.w(TAG, "Couldn't look for sessions ($code)") }
            override fun onStopDiscoveryFailed(type: String, code: Int) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                resolving.execute { resolve(info) { resolved -> add(resolved); report() } }
            }
            override fun onServiceLost(info: NsdServiceInfo) {
                synchronized(this@Lan) { sessions.remove(info.serviceName) }
                report()
            }
        }
        discovery = l
        nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, l)
        report()
    }

    /** Resolves a service's address and port; waits so only one resolves at a time. */
    private fun resolve(info: NsdServiceInfo, done: (NsdServiceInfo) -> Unit) {
        val latch = java.util.concurrent.CountDownLatch(1)
        @Suppress("DEPRECATION")
        nsd.resolveService(info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, code: Int) { latch.countDown() }
            override fun onServiceResolved(info: NsdServiceInfo) { try { done(info) } finally { latch.countDown() } }
        })
        latch.await(8, java.util.concurrent.TimeUnit.SECONDS)
    }

    @Synchronized
    private fun add(info: NsdServiceInfo) {
        val address = addressOf(info) ?: return
        val host = if (address is Inet4Address) address.hostAddress else "[${address.hostAddress?.substringBefore('%')}]"
        val name = info.attributes["name"]?.let { String(it) }?.takeIf { it.isNotBlank() } ?: info.serviceName
        sessions[info.serviceName] = JSONObject().put("id", info.serviceName).put("name", name).put("url", "ws://$host:${info.port}")
    }

    private fun addressOf(info: NsdServiceInfo): InetAddress? {
        val all = if (Build.VERSION.SDK_INT >= 34) info.hostAddresses else @Suppress("DEPRECATION") listOfNotNull(info.host)
        return all.firstOrNull { it is Inet4Address } ?: all.firstOrNull()
    }

    @Synchronized
    fun stopBrowsing() {
        discovery?.let { try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {} }
        discovery = null
        sessions.clear()
        multicast?.let { if (it.isHeld) it.release() }
        multicast = null
    }

    companion object {
        const val SERVICE_TYPE = "_dungeonradio._tcp"
        private const val TAG = "DungeonRadio"
    }
}
