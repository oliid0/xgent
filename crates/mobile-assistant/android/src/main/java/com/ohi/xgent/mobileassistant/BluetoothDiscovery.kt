package com.ohi.xgent.mobileassistant

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONArray

@InvokeArg
class BluetoothScanArgs { var timeoutMs: Long = 5_000 }

internal class BluetoothDiscovery(private val activity: Activity) {
    private val handler = Handler(Looper.getMainLooper())
    private var pending: Invoke? = null
    private var callback: ScanCallback? = null
    private var deadline: Runnable? = null
    private val devices = linkedMapOf<String, JSObject>()

    fun scan(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(BluetoothScanArgs::class.java)
            require(args.timeoutMs in 1_000..30_000) { "Bluetooth scan duration must be between 1000 and 30000 ms" }
            check(pending == null) { "Another Bluetooth scan is active" }
            val permissions = if (Build.VERSION.SDK_INT >= 31) {
                listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
            } else listOf(Manifest.permission.ACCESS_FINE_LOCATION)
            check(permissions.all { activity.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) {
                "Bluetooth/nearby device permission is required"
            }
            val adapter = (activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
                ?: error("Bluetooth is unavailable")
            check(adapter.isEnabled) { "Bluetooth is unavailable or turned off" }
            val scanner = adapter.bluetoothLeScanner ?: error("Bluetooth LE scanning is unavailable")
            devices.clear()
            pending = invoke
            val receiver = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    if (pending !== invoke) return
                    try {
                        val id = result.device.address
                        if (devices.size >= 200 && !devices.containsKey(id)) return
                        devices[id] = JSObject().apply {
                            put("id", id)
                            put("name", result.scanRecord?.deviceName ?: org.json.JSONObject.NULL)
                            put("rssi", result.rssi)
                            put("serviceUuids", JSONArray(result.scanRecord?.serviceUuids?.map { it.toString() } ?: emptyList<String>()))
                        }
                    } catch (error: Exception) { finish(error.message ?: "Bluetooth scan failed") }
                }
                override fun onScanFailed(errorCode: Int) {
                    if (pending === invoke) finish("Bluetooth scan failed ($errorCode)")
                }
            }
            callback = receiver
            val stop = Runnable { if (pending === invoke) finish() }
            deadline = stop
            handler.postDelayed(stop, args.timeoutMs)
            scanner.startScan(receiver)
        } catch (error: Exception) {
            if (pending === invoke) finish(error.message ?: "Bluetooth scan failed")
            else invoke.reject(error.message ?: "Bluetooth scan failed")
        }
    }

    private fun finish(error: String? = null) {
        val invoke = pending ?: return
        pending = null
        deadline?.let(handler::removeCallbacks)
        deadline = null
        val adapter = (activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        val cleanup = runCatching {
            callback?.let { adapter?.bluetoothLeScanner?.stopScan(it) }
            check(adapter?.isEnabled == true) { "Bluetooth was turned off during discovery" }
        }
        callback = null
        val failure = error ?: cleanup.exceptionOrNull()?.message
        if (failure != null) invoke.reject(failure)
        else invoke.resolveObject(JSONArray(devices.toSortedMap().values.toList()))
        devices.clear()
    }
}
