package com.ohi.xgent.mobileassistant

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.JSObject
import java.time.Instant
import org.json.JSONArray

@InvokeArg
class HealthMetricArgs { var metric: String = "" }

@InvokeArg
class HealthSamplesArgs {
    var metric: String = ""
    var startMs: Long = 0
    var endMs: Long = 0
    var limit: Int = 50
}

internal fun healthMetricPermission(metric: String): String = when (metric) {
    "heart_rate" -> HealthPermission.getReadPermission(HeartRateRecord::class)
    "blood_glucose" -> HealthPermission.getReadPermission(BloodGlucoseRecord::class)
    "oxygen_saturation" -> HealthPermission.getReadPermission(OxygenSaturationRecord::class)
    "weight" -> HealthPermission.getReadPermission(WeightRecord::class)
    "body_temperature" -> HealthPermission.getReadPermission(BodyTemperatureRecord::class)
    else -> throw IllegalArgumentException("Unsupported health metric: $metric")
}

private fun healthSample(record: Record, time: Instant, value: Double): JSObject = JSObject().apply {
    put("id", "${record.metadata.id}:${time.toEpochMilli()}")
    put("startMs", time.toEpochMilli())
    put("endMs", time.toEpochMilli())
    put("value", value)
    put("source", record.metadata.dataOrigin.packageName)
}

private suspend inline fun <reified T : Record> readMetricPage(
    client: HealthConnectClient,
    args: HealthSamplesArgs,
    unit: String,
    transform: (T) -> List<JSObject>,
): JSObject {
    val limit = args.limit.coerceIn(1, 200)
    val response = client.readRecords(ReadRecordsRequest(
        recordType = T::class,
        timeRangeFilter = TimeRangeFilter.between(
            Instant.ofEpochMilli(args.startMs), Instant.ofEpochMilli(args.endMs),
        ),
        ascendingOrder = false,
        pageSize = limit + 1,
    ))
    val samples = response.records.flatMap(transform).sortedByDescending { it.getLong("startMs") }
    return JSObject().apply {
        put("metric", args.metric)
        put("unit", unit)
        put("startMs", args.startMs)
        put("endMs", args.endMs)
        put("samples", JSONArray(samples.take(limit)))
        put("source", "health-connect")
        put("truncated", !response.pageToken.isNullOrEmpty() || samples.size > limit)
        // Default history visibility is restricted by platform authorization.
        put("accessLimited", true)
    }
}

internal suspend fun readHealthMetricSamples(client: HealthConnectClient, args: HealthSamplesArgs): JSObject {
    require(args.endMs > args.startMs) { "Health range end must be after start" }
    val permission = healthMetricPermission(args.metric)
    check(client.permissionController.getGrantedPermissions().contains(permission)) {
        "Health Connect permission for ${args.metric} is required"
    }
    return when (args.metric) {
        "heart_rate" -> readMetricPage<HeartRateRecord>(client, args, "bpm") { record ->
            record.samples.asSequence()
                .filter { it.time.toEpochMilli() >= args.startMs && it.time.toEpochMilli() < args.endMs }
                .sortedByDescending { it.time }
                .take(args.limit.coerceIn(1, 200) + 1)
                .map { healthSample(record, it.time, it.beatsPerMinute.toDouble()) }.toList()
        }
        "blood_glucose" -> readMetricPage<BloodGlucoseRecord>(client, args, "mg/dL") {
            listOf(healthSample(it, it.time, it.level.inMilligramsPerDeciliter))
        }
        "oxygen_saturation" -> readMetricPage<OxygenSaturationRecord>(client, args, "%") {
            listOf(healthSample(it, it.time, it.percentage.value))
        }
        "weight" -> readMetricPage<WeightRecord>(client, args, "kg") {
            listOf(healthSample(it, it.time, it.weight.inKilograms))
        }
        "body_temperature" -> readMetricPage<BodyTemperatureRecord>(client, args, "degC") {
            listOf(healthSample(it, it.time, it.temperature.inCelsius))
        }
        else -> throw IllegalArgumentException("Unsupported health metric")
    }
}
