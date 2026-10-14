package com.ohi.xgent.mobileassistant

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.AtomicFile
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.tauri.annotation.InvokeArg
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.reflect.KClass
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

@InvokeArg
class HealthEventConfigurationArgs {
    var metrics: List<String> = emptyList()
    var authorize: Boolean = false
    var policyDatabase: String = ""
}

@InvokeArg
class HealthEventAcknowledgementArgs { var ids: List<String> = emptyList() }

internal data class HealthChangeMetadata(val id: String, val metric: String, val occurredAtMs: Long)

private data class HealthCollectionState(
    val metrics: List<String> = emptyList(),
    val tokens: Map<String, String> = emptyMap(),
    val pending: List<HealthChangeMetadata> = emptyList(),
    val policyDatabase: String = "",
    val lastPollAtMs: Long = 0,
    val error: String? = null,
)

/** Native metadata only. Never stores the SDK's returned records or sample values. */
internal object HealthEventCollector {
    private const val WORK_NAME = "xgent.health.changes.v1"
    private const val MAX_BYTES = 131072
    private const val MAX_TOKEN_LENGTH = 16384
    private val lock = Mutex()
    internal val metrics = listOf("heart_rate", "blood_glucose", "oxygen_saturation", "weight", "body_temperature")

    private fun recordType(metric: String): KClass<out Record> = when (metric) {
        "heart_rate" -> HeartRateRecord::class
        "blood_glucose" -> BloodGlucoseRecord::class
        "oxygen_saturation" -> OxygenSaturationRecord::class
        "weight" -> WeightRecord::class
        "body_temperature" -> BodyTemperatureRecord::class
        else -> error("Unsupported health event metric")
    }

    internal fun availableMetrics(context: Context): List<String> {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) return emptyList()
        val client = HealthConnectClient.getOrCreate(context)
        return if (client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)
            == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE) metrics else emptyList()
    }

    internal fun requiredPermissions(requested: List<String>): Set<String> {
        validateMetrics(requested)
        return requested.map(::healthMetricPermission).toSet() + HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
    }

    private fun validateMetrics(requested: List<String>) {
        require(requested.size <= metrics.size && requested.distinct().size == requested.size && requested.all { it in metrics }) {
            "Invalid health event metric scope"
        }
    }

    private fun database(context: Context, path: String): File {
        val root = File(context.applicationInfo.dataDir).canonicalFile.toPath()
        val file = File(path).canonicalFile
        require(file.toPath().startsWith(root) && file.name == "config.sqlite" && file.isFile) {
            "Health events require the original private native policy database"
        }
        return file
    }

    // WorkManager can outlive the Activity/Rust service. Read current native
    // policy and enabled rules, rather than treating its saved scope as a grant.
    private fun activeMetrics(context: Context, state: HealthCollectionState): Set<String> {
        SQLiteDatabase.openDatabase(database(context, state.policyDatabase).path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            val settings = mutableMapOf<String, Any>()
            db.rawQuery("SELECT setting_key,payload_json FROM system_settings WHERE setting_key IN ('executionMode','toolPolicies')", null).use { rows ->
                while (rows.moveToNext()) {
                    val tokener = JSONTokener(rows.getString(1))
                    settings[rows.getString(0)] = tokener.nextValue()
                    check(tokener.nextClean() == '\u0000') { "Invalid native policy JSON" }
                }
            }
            val rawMode = settings["executionMode"]
            val mode = if (rawMode == null || rawMode == JSONObject.NULL) "tools" else (rawMode as? String)?.trim()
            check(mode in setOf("tools", "agent-dev")) { "Agent execution is disabled on the original phone" }
            val rawPolicies = settings["toolPolicies"]
            val policies = if (rawPolicies == null || rawPolicies == JSONObject.NULL) JSONObject()
                else rawPolicies as? JSONObject ?: error("Invalid native tool policies")
            for (key in listOf("MobilePersonalData", "group:system", "personal:health")) {
                check(!policies.has(key) || policies.get(key) in setOf("allow", "ask", "deny")) { "Invalid native connector policy" }
            }
            val broad = if (policies.has("MobilePersonalData")) policies.getString("MobilePersonalData")
                else policies.optString("group:system", "allow")
            check(broad != "deny" && policies.optString("personal:health", "ask") != "deny") { "The user disabled health access" }
            val active = mutableSetOf<String>()
            db.rawQuery("SELECT config_json FROM automation_proactive_rules WHERE enabled=1", null).use { rows ->
                while (rows.moveToNext()) {
                    val config = JSONObject(rows.getString(0))
                    if (config.optString("eventKind") == "health_updated") {
                        val metric = config.getString("healthMetric")
                        check(metric in metrics && config.isNull("sourceTaskId")) { "Invalid native health rule scope" }
                        active.add(metric)
                    }
                }
            }
            return active
        }
    }

    private fun file(context: Context): AtomicFile = AtomicFile(File(context.noBackupFilesDir, "xgent-health-events-v1.json"))

    private fun load(context: Context): HealthCollectionState {
        val file = file(context)
        // AtomicFile also recovers an interrupted replacement; corrupt state
        // is reported, never overwritten with an empty authorization scope.
        val input = try { file.openRead() } catch (error: java.io.FileNotFoundException) {
            if (file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()) throw error
            return HealthCollectionState()
        }
        val bytes = input.use { stream ->
            val buffer = ByteArray(MAX_BYTES + 1)
            var count = 0
            while (count < buffer.size) {
                val read = stream.read(buffer, count, buffer.size - count)
                if (read < 0) break
                count += read
            }
            buffer.copyOf(count)
        }
        check(bytes.size <= MAX_BYTES) { "Retained health metadata exceeds its bound" }
        val raw = JSONObject(bytes.toString(Charsets.UTF_8))
        check(raw.getInt("version") == 1) { "Unsupported retained health metadata" }
        val requested = raw.getJSONArray("metrics").let { array -> (0 until array.length()).map(array::getString) }
        validateMetrics(requested)
        val tokenObject = raw.getJSONObject("tokens")
        val tokens = tokenObject.keys().asSequence().associateWith { key -> tokenObject.getString(key) }
        check(tokens.keys.all { it in requested } && tokens.values.all { it.length in 1..MAX_TOKEN_LENGTH }) { "Invalid retained health cursors" }
        val pending = raw.getJSONArray("pending").let { array -> (0 until array.length()).map { index ->
            val value = array.getJSONObject(index)
            HealthChangeMetadata(value.getString("id"), value.getString("metric"), value.getLong("occurredAtMs"))
        } }
        check(pending.size <= metrics.size && pending.map { it.metric }.distinct().size == pending.size
            && pending.all { it.metric in requested && UUID.fromString(it.id).toString() == it.id && it.occurredAtMs > 0 }) { "Invalid retained health events" }
        val path = raw.getString("policyDatabase")
        if (requested.isNotEmpty()) database(context, path)
        val lastPollAtMs = raw.getLong("lastPollAtMs")
        check(lastPollAtMs >= 0) { "Invalid health polling checkpoint" }
        val error = if (raw.isNull("error")) null else raw.getString("error")
        check(error == null || error.length <= 2048) { "Invalid retained health error" }
        return HealthCollectionState(requested, tokens, pending, path, lastPollAtMs, error)
    }

    private fun save(context: Context, state: HealthCollectionState) {
        val raw = JSONObject().apply {
            put("version", 1); put("metrics", JSONArray(state.metrics)); put("tokens", JSONObject(state.tokens))
            put("pending", JSONArray(state.pending.map { event -> JSONObject().apply {
                put("id", event.id); put("metric", event.metric); put("occurredAtMs", event.occurredAtMs)
            } }))
            put("policyDatabase", state.policyDatabase); put("lastPollAtMs", state.lastPollAtMs); put("error", state.error ?: JSONObject.NULL)
        }
        val bytes = raw.toString().toByteArray(Charsets.UTF_8)
        check(bytes.size <= MAX_BYTES) { "Health metadata exceeds its bound" }
        val file = file(context)
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) } catch (error: Throwable) { file.failWrite(stream); throw error }
    }

    internal suspend fun configure(context: Context, args: HealthEventConfigurationArgs): List<String> = withContext(Dispatchers.IO) {
        lock.withLock {
            validateMetrics(args.metrics)
            val prior = load(context)
            val requested = args.metrics.sorted()
            if (requested.isEmpty()) {
                // Withdraw the scope durably before best-effort OS cancellation.
                save(context, HealthCollectionState())
                WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME).result.get(15, TimeUnit.SECONDS)
                return@withLock requested
            }
            check(requested.all { it in availableMetrics(context) }) { "Background Health Connect reads are unavailable on this device" }
            val path = database(context, args.policyDatabase).path
            check(args.authorize || requested.all { it in prior.metrics }) { "A new health event scope requires an explicit client action" }
            val client = HealthConnectClient.getOrCreate(context)
            check(client.permissionController.getGrantedPermissions().containsAll(requiredPermissions(requested))) { "Background health or metric permission was not granted" }
            val tokens = prior.tokens.filterKeys { it in requested }.toMutableMap()
            for (metric in requested.filter { it !in tokens }) {
                check(args.authorize) { "Health change cursor expired; explicitly re-enable the rule" }
                val token = client.getChangesToken(ChangesTokenRequest(recordTypes = setOf(recordType(metric))))
                check(token.length in 1..MAX_TOKEN_LENGTH) { "Invalid Health Connect changes token" }
                tokens[metric] = token
            }
            val changed = prior.metrics != requested || prior.tokens != tokens || prior.policyDatabase != path
            val next = prior.copy(metrics = requested, tokens = tokens, pending = prior.pending.filter { it.metric in requested }, policyDatabase = path,
                lastPollAtMs = if (changed) 0 else prior.lastPollAtMs, error = if (changed || args.authorize) null else prior.error)
            if (next != prior) save(context, next)
            val work = PeriodicWorkRequestBuilder<HealthChangesWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, work).result.get(15, TimeUnit.SECONDS)
            requested
        }
    }

    internal suspend fun collect(context: Context, force: Boolean) = withContext(Dispatchers.IO) {
        lock.withLock {
            var state = load(context)
            if (state.metrics.isEmpty()) return@withLock
            val now = System.currentTimeMillis()
            if (!force && now >= state.lastPollAtMs && now - state.lastPollAtMs < 60000) {
                state.error?.let { error(it) }; return@withLock
            }
            try {
                check(state.metrics.all { it in availableMetrics(context) }) { "Background Health Connect reads are unavailable on this device" }
                val active = activeMetrics(context, state)
                if (state.metrics.none { it in active }) {
                    save(context, state.copy(lastPollAtMs = now, error = null))
                    return@withLock
                }
                val client = HealthConnectClient.getOrCreate(context)
                val granted = client.permissionController.getGrantedPermissions()
                check(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in granted) { "Background health permission was revoked" }
                for (metric in state.metrics.filter { it in active }) {
                    check(healthMetricPermission(metric) in granted) { "Health metric permission was revoked: $metric" }
                    var token = state.tokens[metric] ?: error("Health change cursor expired; explicitly re-enable the rule")
                    for (page in 0 until 10) {
                        // Recheck live rules/policy around each SDK read. An OS
                        // cancellation alone cannot stop an in-flight worker.
                        if (metric !in activeMetrics(context, state)) break
                        val response = client.getChanges(token)
                        if (response.changesTokenExpired) {
                            state = state.copy(tokens = state.tokens - metric)
                            save(context, state)
                            error("Health change cursor expired; explicitly re-enable the rule")
                        }
                        check(response.nextChangesToken.length in 1..MAX_TOKEN_LENGTH) { "Invalid Health Connect changes token" }
                        if (metric !in activeMetrics(context, state)) break
                        val pending = if (response.changes.isEmpty()) state.pending else
                            state.pending.filter { it.metric != metric } + HealthChangeMetadata(UUID.randomUUID().toString(), metric, System.currentTimeMillis())
                        // The new cursor and its event share one atomic write.
                        // A crash cannot advance past an unretained event.
                        state = state.copy(tokens = state.tokens + (metric to response.nextChangesToken), pending = pending)
                        save(context, state)
                        token = response.nextChangesToken
                        if (!response.hasMore) break
                    }
                }
                state = state.copy(lastPollAtMs = now, error = null)
                save(context, state)
            } catch (error: kotlinx.coroutines.CancellationException) { throw error }
            catch (error: Exception) {
                save(context, state.copy(lastPollAtMs = now, error = (error.message ?: "Health collection failed").take(2048)))
                throw error
            }
        }
    }

    internal suspend fun pending(context: Context): List<HealthChangeMetadata> {
        collect(context, false)
        return withContext(Dispatchers.IO) { lock.withLock {
            val state = load(context); state.error?.let { error(it) }; state.pending
        } }
    }

    internal suspend fun readEventSamples(context: Context, scope: JSONObject): JSONObject {
        val metric = scope.getString("metric")
        val start = scope.getLong("startMs"); val end = scope.getLong("endMs")
        require(scope.getInt("version") == 1 && end > start && end - start <= 600000 && end <= System.currentTimeMillis())
        val prior = lock.withLock { load(context) }
        check(prior.error == null && metric in prior.metrics && metric in activeMetrics(context, prior))
        check(metric in availableMetrics(context))
        val client = HealthConnectClient.getOrCreate(context)
        val required = requiredPermissions(listOf(metric))
        check(client.permissionController.getGrantedPermissions().containsAll(required))
        val actual = readHealthMetricSamples(client, HealthSamplesArgs().apply {
            this.metric = metric; startMs = start; endMs = end; limit = 50
        })
        val current = lock.withLock { load(context) }
        check(current.error == null && current.policyDatabase == prior.policyDatabase && metric in current.metrics &&
            metric in activeMetrics(context, current) && client.permissionController.getGrantedPermissions().containsAll(required))
        return actual
    }

    internal suspend fun acknowledge(context: Context, ids: List<String>) = withContext(Dispatchers.IO) {
        require(ids.size <= metrics.size && ids.distinct().size == ids.size && ids.all { UUID.fromString(it).toString() == it }) { "Invalid health event acknowledgment" }
        lock.withLock {
            val prior = load(context)
            val next = prior.copy(pending = prior.pending.filter { it.id !in ids })
            if (next != prior) save(context, next)
        }
    }
}
