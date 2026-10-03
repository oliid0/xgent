import type { PresentationAction, PresentationActionResult, PresentationHandler } from "./types";

/** Each render replaces the available actions atomically. No native action invokes a command by name. */
export function createPresentationActionRegistry() {
  const surfaces = new Map<string, ReadonlyMap<string, PresentationHandler>>();
  type Request = {
    fingerprint: string;
    result: Promise<PresentationActionResult>;
  };
  const pending = new Map<string, Request>();
  const settled = new Map<string, Request>();
  const settledReplies = new Map<string, Request>();

  return {
    register(surface: string, handlers: ReadonlyMap<string, PresentationHandler>) {
      surfaces.set(surface, new Map(handlers));
    },
    remove(surface: string) {
      surfaces.delete(surface);
      for (const key of settledReplies.keys()) {
        if (JSON.parse(key)[0] === surface) settledReplies.delete(key);
      }
    },
    dispatch(event: PresentationAction): Promise<PresentationActionResult> {
      const key = JSON.stringify([event.surface, event.requestId]);
      const fingerprint = JSON.stringify([event.action, event.value]);
      const previous = pending.get(key) ?? settled.get(key) ?? settledReplies.get(key);
      if (previous) {
        if (previous.fingerprint === fingerprint) return previous.result;
        return Promise.resolve({
          surface: event.surface,
          requestId: event.requestId,
          ok: false,
          error: "A request ID cannot be reused for a different action.",
        });
      }
      let replyOnly = false;
      const result = Promise.resolve().then(async (): Promise<PresentationActionResult> => {
        const handler = surfaces.get(event.surface)?.get(event.action);
        replyOnly = Boolean(handler?.resultValue);
        try {
          if (!handler?.enabled) throw new Error("This action is no longer available.");
          if (!handler.accepts(event.value)) throw new Error("Invalid action value.");
          const value = handler.normalize ? handler.normalize(event.value) : event.value;
          if (!handler.accepts(value)) throw new Error("Invalid normalized action value.");
          const output = await handler.run(value);
          const acceptedValue = handler.resultValue
            ? handler.resultValue(output)
            : handler.normalize
              ? value
              : undefined;
          if (
            (handler.resultValue && acceptedValue === undefined) ||
            (acceptedValue !== undefined &&
              acceptedValue !== null &&
              typeof acceptedValue !== "string" &&
              typeof acceptedValue !== "boolean" &&
              !(typeof acceptedValue === "number" && Number.isFinite(acceptedValue)))
          ) {
            throw new Error("Invalid action result value.");
          }
          return {
            surface: event.surface,
            requestId: event.requestId,
            ok: true,
            ...(acceptedValue !== undefined ? { acceptedValue } : {}),
          };
        } catch (error) {
          return {
            surface: event.surface,
            requestId: event.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
      const request = { fingerprint, result };
      pending.set(key, request);
      // Never evict work still running: replaying it could repeat a destructive action.
      void result.then(() => {
        pending.delete(key);
        if (replyOnly && !surfaces.has(event.surface)) return;
        const cache = replyOnly ? settledReplies : settled;
        cache.set(key, request);
        if (cache.size > (replyOnly ? 32 : 256)) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
      });
      return result;
    },
  };
}
