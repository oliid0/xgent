package com.ohi.xgent.mobileassistant

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** The OS can run this without an Activity/WebView or local model execution. */
class EventDeliveryWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
      return try {
        val scope = EventDelivery.load(applicationContext) ?: return Result.success()
        var observationReady = true
        val events = try { HealthEventCollector.pending(applicationContext) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { observationReady = false; emptyList<HealthChangeMetadata>() }
        val raw = JSONArray()
        for (event in events) raw.put(JSONObject().put("id", event.id).put("metric", event.metric).put("occurredAtMs", event.occurredAtMs))
        val planned = withContext(Dispatchers.IO) {
            if (isStopped) return@withContext null
            NativeEventSender.healthScopes(scope.databasePath, File(applicationContext.applicationInfo.dataDir).canonicalPath,
                scope.hostId, raw.toString())
        } ?: return Result.retry()
        check(planned.toByteArray(Charsets.UTF_8).size <= 16384)
        val plans = JSONArray(planned); check(plans.length() <= 4)
        val reads = JSONArray()
        for (index in 0 until plans.length()) {
            if (isStopped) return Result.retry()
            val plan = plans.getJSONObject(index)
            val actual = try { withTimeoutOrNull(2000) { HealthEventCollector.readEventSamples(applicationContext, plan) } }
                catch (error: CancellationException) { throw error }
                catch (error: Exception) { observationReady = false; null }
            if (actual == null) observationReady = false
            else reads.put(JSONObject().put("scope", plan).put("result", actual))
        }
        val intake = JSONObject().put("events", raw).put("healthReads", reads)
        val reply = withContext(Dispatchers.IO) {
            if (isStopped) return@withContext null
            NativeEventSender.sync(scope.databasePath, File(applicationContext.applicationInfo.dataDir).canonicalPath,
                scope.hostId, intake.toString(), this@EventDeliveryWorker)
        } ?: return Result.retry()
        check(reply.toByteArray(Charsets.UTF_8).size <= 2 * 1024 * 1024)
        val value = JSONObject(reply)
        check(value.getInt("version") == 1 && value.getString("hostId") == scope.hostId)
        val ids = value.getJSONArray("acknowledgedEventIds")
        val acknowledged = (0 until ids.length()).map { ids.getString(it) }
        check(acknowledged.distinct().size == acknowledged.size && acknowledged.all { id -> events.any { it.id == id } })
        // Only native SQLite intake commit can release the SDK's metadata.
        if (acknowledged.isNotEmpty()) HealthEventCollector.acknowledge(applicationContext, acknowledged)
        withContext(Dispatchers.IO) { EventDelivery.retainResults(applicationContext, scope, value.getJSONArray("targets")) }
        if (observationReady && value.getBoolean("success") && !isStopped) Result.success() else Result.retry()
    } catch (error: CancellationException) { throw error }
    catch (error: LinkageError) { Result.retry() }
    catch (error: Exception) { Result.retry() }
    }
}
