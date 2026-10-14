package com.ohi.xgent.mobileassistant

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

/** Original scoped remote results and cached notices using the OS worker. */
class ResultDeliveryWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result = try {
        val cached = ResultDelivery.drain(applicationContext) { isStopped }
        val received = try { RemoteResultDelivery.receive(applicationContext, this) }
            catch (error: Exception) { false }
            catch (error: LinkageError) { false }
        val delivered = ResultDelivery.drain(applicationContext) { isStopped }
        if (cached && received && delivered) Result.success() else Result.retry()
    } catch (error: Exception) { Result.retry() }
}
