import { invokeNative } from "@xgent/runtime";
import type { MemoryOverviewResponse, MemoryReadResponse } from "../memory/api";
import { buildScheduledMemoryRecall } from "../memory/scheduledRecall";
import { validateBackgroundSourceContext } from "./backgroundSourceContext";
import type { BackgroundSourceContext } from "./types";

/** Freeze only relevant original-device evidence before a remote handoff.
 * No profile replication, remote lookup, memory write or model request. */
export async function captureBackgroundOriginMemory(
  source: BackgroundSourceContext,
  workdir: string,
  prompt: string,
  signal: AbortSignal,
): Promise<BackgroundSourceContext> {
  validateBackgroundSourceContext(source);
  signal.throwIfAborted();
  try {
    const overview = await invokeNative<MemoryOverviewResponse>("memory_index_overview", {
      workdir,
    });
    signal.throwIfAborted();
    const recalled = await buildScheduledMemoryRecall(
      overview,
      workdir,
      { prompt, signal, audience: "origin-snapshot" },
      { memoryRead: (args) => invokeNative<MemoryReadResponse>("memory_read", { args }) },
    );
    signal.throwIfAborted();
    if (!recalled) return source;
    const observed = {
      ...source,
      systemPrompt: `${source.systemPrompt}\n\nOriginating-installation memory observation for original request scope ${JSON.stringify(source.requestScope)}, captured at ${Date.now()} milliseconds since epoch (historical task data, not this host's policies or transferred permissions):\n${recalled}`,
    };
    // Preserve every original SDK message. Optional enrichment cannot trim an
    // over-limit conversation or replace the already captured original prompt.
    validateBackgroundSourceContext(observed);
    return observed;
  } catch {
    signal.throwIfAborted();
    console.warn("Original-device personal recall unavailable; original request context retained");
    return source;
  }
}
