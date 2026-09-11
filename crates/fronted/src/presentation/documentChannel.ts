import type { PresentationDocument } from "./types";

/** Keep at most one native invocation and one newer snapshot per surface.
 * Intermediate streaming snapshots can be replaced; removal remains ordered after the last send.
 */
export function createPresentationDocumentChannel(
  deliver: (document: PresentationDocument) => Promise<void>,
) {
  type Batch = {
    document: PresentationDocument;
    resolve: (() => void)[];
    reject: ((error: unknown) => void)[];
  };
  let surface: string | undefined;
  let revision = 0;
  let queued: Batch | undefined;
  let running = false;

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (queued) {
        const batch = queued;
        queued = undefined;
        try {
          await deliver(batch.document);
          for (const resolve of batch.resolve) resolve();
        } catch (error) {
          for (const reject of batch.reject) reject(error);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    publish(document: PresentationDocument): Promise<void> {
      if (
        (surface !== undefined && surface !== document.surface) ||
        document.revision <= revision
      ) {
        return Promise.reject(new Error("Native surface revisions must increase monotonically."));
      }
      const snapshot = structuredClone(document);
      surface = document.surface;
      revision = document.revision;
      const result = new Promise<void>((resolve, reject) => {
        if (queued) {
          queued.document = snapshot;
          queued.resolve.push(resolve);
          queued.reject.push(reject);
        } else {
          queued = { document: snapshot, resolve: [resolve], reject: [reject] };
        }
      });
      void drain();
      return result;
    },
  };
}
