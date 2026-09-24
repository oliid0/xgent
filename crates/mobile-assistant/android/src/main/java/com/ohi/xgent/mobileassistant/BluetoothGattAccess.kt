package com.ohi.xgent.mobileassistant

import android.Manifest
import android.app.Activity
import android.bluetooth.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONArray
import java.util.UUID

@InvokeArg
class GattArgs {
    var operation: String = ""
    var deviceId: String = ""
    var serviceUuid: String? = null
    var characteristicUuid: String? = null
    var timeoutMs: Long = 10_000
}

// State and callbacks are serialized on the main thread; late callbacks cannot
// resolve a later operation. Each request disconnects and closes its own GATT.
internal class BluetoothGattAccess(private val activity: Activity) {
    private val handler = Handler(Looper.getMainLooper())
    private var pending: Invoke? = null
    private var connection: BluetoothGatt? = null
    private var deadline: Runnable? = null

    private fun uuid(value: String?): UUID {
        require(value != null && Regex("(?:[0-9a-fA-F]{4}|[0-9a-fA-F]{8}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})").matches(value)) { "Invalid Bluetooth UUID" }
        return UUID.fromString(when (value.length) {
            4 -> "0000$value-0000-1000-8000-00805f9b34fb"
            8 -> "$value-0000-1000-8000-00805f9b34fb"
            else -> value
        })
    }

    fun run(invoke: Invoke) {
        try {
            check(pending == null) { "Another Bluetooth GATT operation is active" }
            val args = invoke.parseArgs(GattArgs::class.java)
            require(args.operation in listOf("services", "read") && args.timeoutMs in 1_000..30_000) { "Invalid Bluetooth operation or timeout" }
            require(BluetoothAdapter.checkBluetoothAddress(args.deviceId)) { "Invalid Bluetooth device address" }
            val serviceId = if (args.operation == "read") uuid(args.serviceUuid) else null
            val characteristicId = if (args.operation == "read") uuid(args.characteristicUuid) else null
            val permission = if (Build.VERSION.SDK_INT >= 31) Manifest.permission.BLUETOOTH_CONNECT else Manifest.permission.BLUETOOTH
            check(activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) { "Bluetooth permission is required" }
            val adapter = (activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
                ?: error("Bluetooth is unavailable")
            check(adapter.isEnabled) { "Bluetooth is turned off" }
            val callback = object : BluetoothGattCallback() {
                fun dispatch(gatt: BluetoothGatt, body: () -> Unit) {
                    handler.post {
                        if (pending !== invoke || connection !== gatt) return@post
                        try { body() } catch (error: Exception) { finish(error = error.message ?: "Bluetooth operation failed") }
                    }
                }
                override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) = dispatch(gatt) {
                    check(status == BluetoothGatt.GATT_SUCCESS) { "Bluetooth connection failed ($status)" }
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        check(gatt.discoverServices()) { "Bluetooth service discovery could not start" }
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTED) error("Bluetooth disconnected before completion")
                }
                override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) = dispatch(gatt) {
                    check(status == BluetoothGatt.GATT_SUCCESS) { "Bluetooth service discovery failed ($status)" }
                    check(gatt.services.size <= 256 && gatt.services.sumOf { it.characteristics.size } <= 1024) { "Bluetooth service list is too large" }
                    if (args.operation == "services") finish(result = payload(gatt, args))
                    else {
                        val matches = gatt.services.filter { it.uuid == serviceId }
                            .flatMap { it.characteristics }.filter { it.uuid == characteristicId }
                        check(matches.size == 1) { "Bluetooth characteristic is missing or ambiguous" }
                        val characteristic = matches.single()
                        check(characteristic.properties and BluetoothGattCharacteristic.PROPERTY_READ != 0) { "Characteristic does not support reads; notification-only data requires a subscription" }
                        check(gatt.readCharacteristic(characteristic)) { "Bluetooth characteristic read could not start" }
                    }
                }
                fun readResult(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray?, status: Int) = dispatch(gatt) {
                    if (characteristic.uuid != characteristicId || characteristic.service?.uuid != serviceId) return@dispatch
                    check(status == BluetoothGatt.GATT_SUCCESS) { "Bluetooth characteristic read failed ($status)" }
                    check(value != null && value.size <= 512) { "Bluetooth characteristic returned missing or oversized data" }
                    finish(result = payload(gatt, args).apply { put("dataHex", value.joinToString("") { "%02x".format(it.toInt() and 255) }) })
                }
                @Deprecated("Used by Android before API 33")
                override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                    if (Build.VERSION.SDK_INT < 33) readResult(gatt, characteristic, characteristic.value?.clone(), status)
                }
                override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
                    readResult(gatt, characteristic, value.clone(), status)
                }
            }
            pending = invoke
            val timeout = Runnable { if (pending === invoke) finish(error = "Bluetooth GATT operation timed out") }
            deadline = timeout
            handler.postDelayed(timeout, args.timeoutMs)
            connection = adapter.getRemoteDevice(args.deviceId).connectGatt(activity, false, callback, BluetoothDevice.TRANSPORT_LE)
                ?: error("Bluetooth connection could not start")
        } catch (error: Exception) {
            if (pending === invoke) finish(error = error.message ?: "Bluetooth operation failed")
            else invoke.reject(error.message ?: "Bluetooth operation failed")
        }
    }

    private fun payload(gatt: BluetoothGatt, args: GattArgs) = JSObject().apply {
        put("deviceId", args.deviceId)
        put("serviceUuid", args.serviceUuid ?: org.json.JSONObject.NULL)
        put("characteristicUuid", args.characteristicUuid ?: org.json.JSONObject.NULL)
        put("services", JSONArray(gatt.services.map { service -> JSObject().apply {
            put("uuid", service.uuid.toString())
            put("characteristics", JSONArray(service.characteristics.map { characteristic -> JSObject().apply {
                put("uuid", characteristic.uuid.toString())
                put("readable", characteristic.properties and BluetoothGattCharacteristic.PROPERTY_READ != 0)
                put("writable", characteristic.properties and (BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
                put("notifiable", characteristic.properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0)
            } }))
        } }))
    }

    private fun finish(error: String? = null, result: JSObject? = null) {
        val invoke = pending ?: return
        pending = null
        deadline?.let(handler::removeCallbacks)
        deadline = null
        val gatt = connection
        connection = null
        runCatching { gatt?.disconnect() }
        runCatching { gatt?.close() }
        if (error != null) invoke.reject(error)
        else if (result != null) invoke.resolve(result)
        else invoke.reject("Bluetooth operation ended without a result")
    }
}
