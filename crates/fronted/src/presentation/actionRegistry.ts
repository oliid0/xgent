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

  return {
    register(surface: string, handlers: ReadonlyMap<string, PresentationHandler>) {
      surfaces.set(surface, new Map(handlers));
    },
    remove(surface: string) {
      surfaces.delete(surface);
    },
    dispatch(event: PresentationAction): Promise<PresentationActionResult> {
      const key = JSON.stringify([event.surface, event.requestId]);
      const fingerprint = JSON.stringify([event.action, event.value]);
      const previous = pending.get(key) ?? settled.get(key);
      if (previous) {
        if (previous.fingerprint === fingerprint) return previous.result;
        return Promise.resolve({
          surface: event.surface,
          requestId: event.requestId,
          ok: false,
          error: "A request ID cannot be reused for a different action.",
        });
      }
      const result = Promise.resolve().then(async (): Promise<PresentationActionResult> => {
        const handler = surfaces.get(event.surface)?.get(event.action);
        try {
          if (!handler?.enabled) throw new Error("This action is no longer available.");
          if (!handler.accepts(event.value)) throw new Error("Invalid action value.");
          await handler.run(event.value);
          return { surface: event.surface, requestId: event.requestId, ok: true };
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
        settled.set(key, request);
        if (settled.size > 256) {
          const oldest = settled.keys().next().value;
          if (oldest !== undefined) settled.delete(oldest);
        }
      });
      return result;
    },
  };
}
