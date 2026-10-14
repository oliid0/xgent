package com.ohi.xgent.mobileassistant

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException

/** OS-scheduled collection; task execution remains with the durable native queue. */
class HealthChangesWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = try {
        HealthEventCollector.collect(applicationContext, true)
        // The independent event worker owns actual intake/ACK/dispatch. KEEP
        // avoids restarting an admitted request when another metric changes.
        if (!isStopped && EventDelivery.load(applicationContext) != null) {
            androidx.work.WorkManager.getInstance(applicationContext).enqueueUniqueWork("xgent.event.delivery.once.v1",
                androidx.work.ExistingWorkPolicy.KEEP,
                androidx.work.OneTimeWorkRequestBuilder<EventDeliveryWorker>().build()).result.get(15, java.util.concurrent.TimeUnit.SECONDS)
        }
        Result.success()
    } catch (error: CancellationException) { throw error }
    catch (error: Exception) { Result.retry() }
}
