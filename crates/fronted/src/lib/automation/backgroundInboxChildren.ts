import { sha256Hex } from "../trajectory/sha256";
import { backend } from "./backend";
import type { BackgroundChildSummary, BackgroundTaskRecord, ReceivedChildChunk } from "./types";

/** Only the already received parent's host can identify and expose its child. */
export async function readInboxChild(
  entryId: string,
  parent: Pick<BackgroundTaskRecord, "requestId" | "hostId">,
  child: BackgroundChildSummary,
  current: () => boolean,
  read: (
    entry: string,
    call: string,
    offset: number,
    hash?: string,
  ) => Promise<ReceivedChildChunk> = backend.readReceivedChild,
): Promise<{ child: BackgroundChildSummary; result: BackgroundTaskRecord | null }> {
  let offset = 0,
    total: number | undefined,
    hash: string | undefined;
  const pieces: string[] = [];
  for (let page = 0; page < 65; page++) {
    if (!current()) throw new Error("Child view retired");
    const reply = await read(entryId, child.callId, offset, hash);
    if (!current()) throw new Error("Child view retired");
    if (
      reply.requestId !== parent.requestId ||
      reply.hostId !== parent.hostId ||
      reply.child?.callId !== child.callId ||
      reply.child.requestId !== child.requestId ||
      reply.child.peerId !== child.peerId
    ) {
      throw new Error("Child observation changed its original parent, execution host or request");
    }
    if (reply.available === false && offset === 0 && reply.snapshot === null)
      return { child: reply.child, result: null };
    const chunk = reply.snapshot;
    if (reply.available !== true || !chunk || typeof chunk.text !== "string")
      throw new Error("Child snapshot is unavailable or malformed");
    const bytes = new TextEncoder().encode(chunk.text).length;
    if (
      chunk.offset !== offset ||
      !Number.isSafeInteger(chunk.totalBytes) ||
      chunk.totalBytes <= 0 ||
      chunk.totalBytes > 512 * 1024 ||
      bytes > 8192 ||
      !/^[a-f0-9]{64}$/.test(chunk.snapshotHash) ||
      (total !== undefined && total !== chunk.totalBytes) ||
      (hash !== undefined && hash !== chunk.snapshotHash)
    ) {
      throw new Error("Child snapshot boundary or revision changed; read again from the start");
    }
    total = chunk.totalBytes;
    hash = chunk.snapshotHash;
    pieces.push(chunk.text);
    offset += bytes;
    if (chunk.nextOffset === null) {
      const text = pieces.join("");
      if (offset !== total || sha256Hex(text) !== hash)
        throw new Error("Child snapshot integrity check failed");
      const result = JSON.parse(text) as BackgroundTaskRecord;
      if (
        result.requestId !== child.requestId ||
        result.hostId !== child.peerId ||
        typeof result.name !== "string" ||
        !result.run ||
        !["pending", "leased", "waiting", "done", "expired"].includes(result.run.state) ||
        typeof result.run.output !== "string" ||
        typeof result.run.success !== "boolean" ||
        !Array.isArray(result.artifacts) ||
        result.artifacts.length > 32 ||
        result.artifacts.some(
          (file) =>
            typeof file.id !== "string" ||
            !file.id ||
            typeof file.relativePath !== "string" ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 0 ||
            file.bytes > 512 * 1024 * 1024,
        )
      ) {
        throw new Error("Child result belongs to another task or contains invalid output");
      }
      return { child: reply.child, result };
    }
    if (!bytes || chunk.nextOffset !== offset || offset >= total)
      throw new Error("Child snapshot cursor did not advance");
  }
  throw new Error("Child snapshot exceeded its bounded page count");
}
