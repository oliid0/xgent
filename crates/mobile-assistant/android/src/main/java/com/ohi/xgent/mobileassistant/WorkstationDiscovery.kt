package com.ohi.xgent.mobileassistant

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.net.Inet4Address
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/** Bounded foreground DNS-SD only; never pairing or model tool execution. */
internal class WorkstationDiscovery private constructor(context: Context, private val invoke: Invoke) {
    private val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val handler = Handler(Looper.getMainLooper())
    private val pending = ArrayDeque<NsdServiceInfo>()
    private val found = linkedMapOf<String, JSONObject>()
    private val queued = mutableSetOf<String>()
    private var resolving = false
    private var finished = false
    private var started = false
    private val listener: NsdManager.DiscoveryListener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(type: String) { handler.post {
            started = true
            if (finished) runCatching { manager.stopServiceDiscovery(listener) }
        } }
        override fun onServiceFound(info: NsdServiceInfo) { handler.post {
            if (!finished && queued.size < 64 && info.serviceType.trimEnd('.') == "_xgent._tcp" && queued.add(info.serviceName)) {
                pending.addLast(info); resolveNext()
            }
        } }
        override fun onServiceLost(info: NsdServiceInfo) { handler.post {
            pending.removeAll { it.serviceName == info.serviceName }
            queued.remove(info.serviceName)
            found.keys.filter { found[it]?.optString("instance") == info.serviceName }.forEach { found.remove(it) }
        } }
        override fun onDiscoveryStopped(type: String) { handler.post { finish(null) } }
        override fun onStartDiscoveryFailed(type: String, code: Int) { handler.post { finish("LAN discovery failed ($code)") } }
        override fun onStopDiscoveryFailed(type: String, code: Int) { handler.post { finish("LAN discovery stop failed ($code)") } }
    }
    private fun resolveNext() {
        if (finished || resolving || pending.isEmpty()) return
        resolving = true
        val info = pending.removeFirst()
        try {
            manager.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(service: NsdServiceInfo, code: Int) { handler.post { resolving = false; resolveNext() } }
                override fun onServiceResolved(service: NsdServiceInfo) { handler.post {
                    resolving = false
                    if (!finished && queued.contains(service.serviceName)) {
                        val version = service.attributes["v"]?.toString(Charsets.UTF_8)
                        val id = service.attributes["id"]?.toString(Charsets.UTF_8).orEmpty()
                        val platform = service.attributes["p"]?.toString(Charsets.UTF_8).orEmpty()
                        val validId = runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false)
                        val address = service.host
                        if (version == "1" && validId && platform in setOf("macos", "windows", "linux") && address is Inet4Address && (address.isSiteLocalAddress || address.isLinkLocalAddress) && service.port in 1..65535) {
                            found[id] = JSONObject().put("hostId", id).put("platform", platform).put("instance", service.serviceName)
                                .put("urls", JSONArray().put("http://${address.hostAddress}:${service.port}"))
                        }
                    }
                    resolveNext()
                } }
            })
        } catch (error: Exception) { finish(error.message ?: "LAN resolution failed") }
    }
    private fun start() {
        try {
            manager.discoverServices("_xgent._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
            handler.postDelayed({ finish(null) }, 5000)
        } catch (error: Exception) { finish(error.message ?: "LAN discovery unavailable") }
    }
    private fun finish(error: String?) {
        if (finished) return
        finished = true
        if (started) runCatching { manager.stopServiceDiscovery(listener) }
        active = null
        if (error != null) invoke.reject(error)
        else {
            val records = JSONArray()
            found.toSortedMap().values.forEach { item -> item.remove("instance"); records.put(item) }
            invoke.resolve(JSObject().apply { put("services", records) })
        }
    }
    companion object {
        private var active: WorkstationDiscovery? = null
        fun discover(context: Context, invoke: Invoke) {
            Handler(Looper.getMainLooper()).post {
                if (active != null) { invoke.reject("LAN discovery is busy"); return@post }
                runCatching { WorkstationDiscovery(context, invoke) }.onSuccess { session ->
                    active = session
                    session.start()
                }.onFailure { invoke.reject(it.message ?: "LAN discovery unavailable") }
            }
        }
    }
}
