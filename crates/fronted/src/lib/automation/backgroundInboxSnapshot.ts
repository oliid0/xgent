import { sha256Hex } from "../trajectory/sha256";
import { backend } from "./backend";
import type { BackgroundInboxChunk, BackgroundInboxItem, BackgroundTaskRecord } from "./types";

/** Read the actual immutable snapshot, never a truncated model conclusion. */
export async function readInboxSnapshot(
  item: BackgroundInboxItem,
  read: (id: string, offset: number) => Promise<BackgroundInboxChunk> = backend.readBackgroundInbox,
): Promise<BackgroundTaskRecord> {
  let offset = 0,
    total: number | undefined,
    hash: string | undefined;
  const pieces: string[] = [];
  for (let page = 0; page < 257; page++) {
    const chunk = await read(item.id, offset);
    const bytes = new TextEncoder().encode(chunk.text).length;
    if (
      chunk.entryId !== item.id ||
      chunk.offset !== offset ||
      !Number.isSafeInteger(chunk.totalBytes) ||
      chunk.totalBytes < 0 ||
      chunk.totalBytes > 4 * 1024 * 1024 ||
      bytes > 16 * 1024 ||
      !/^[a-f0-9]{64}$/.test(chunk.snapshotHash) ||
      (total !== undefined && total !== chunk.totalBytes) ||
      (hash !== undefined && hash !== chunk.snapshotHash)
    )
      throw new Error("Inbox snapshot boundary or identity changed");
    total = chunk.totalBytes;
    hash = chunk.snapshotHash;
    pieces.push(chunk.text);
    offset += bytes;
    if (chunk.nextOffset === null) {
      const text = pieces.join("");
      if (offset !== total || sha256Hex(text) !== hash)
        throw new Error("Inbox snapshot integrity check failed");
      const result = JSON.parse(text) as BackgroundTaskRecord;
      if (
        result.requestId !== item.requestId ||
        result.hostId !== item.sourceHostId ||
        !result.run ||
        !Array.isArray(result.artifacts)
      )
        throw new Error("Inbox snapshot belongs to another task or host");
      return result;
    }
    if (!bytes || chunk.nextOffset !== offset || offset >= total)
      throw new Error("Inbox snapshot cursor did not advance");
  }
  throw new Error("Inbox snapshot exceeded its bounded page count");
}
