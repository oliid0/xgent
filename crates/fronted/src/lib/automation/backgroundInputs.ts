import { invokeNative, isTauriRuntime } from "@xgent/runtime";
import { sha256Hex } from "../trajectory/sha256";
import type { BackgroundInputFile } from "./types";

const MAX_BYTES = 8 * 1024 * 1024;

export type BackgroundInputSource = {
  path: string;
  name?: string;
  workdir?: string;
  expectedContentHash?: string;
  expectedBytes?: number;
};

/** Read the initiating native device, even when its normal fs transport points at a PC. */
export async function snapshotBackgroundInputs(
  files: BackgroundInputSource[],
  workdir: string,
  signal?: AbortSignal,
): Promise<BackgroundInputFile[]> {
  if (!isTauriRuntime()) throw new Error("Local input transfer requires the native app");
  if (!Array.isArray(files) || files.length > 8)
    throw new Error("At most 8 input files are supported");
  const names = new Set<string>();
  const snapshots: BackgroundInputFile[] = [];
  let total = 0;
  for (const file of files) {
    signal?.throwIfAborted();
    if (!file || typeof file.path !== "string" || !file.path.trim())
      throw new Error("Each input needs a local workspace file path");
    if (
      (file.workdir !== undefined && (typeof file.workdir !== "string" || !file.workdir.trim())) ||
      (file.expectedContentHash !== undefined &&
        !/^[a-f0-9]{64}$/.test(file.expectedContentHash)) ||
      (file.expectedBytes !== undefined &&
        (!Number.isSafeInteger(file.expectedBytes) ||
          file.expectedBytes < 0 ||
          file.expectedBytes > MAX_BYTES))
    )
      throw new Error("Invalid input source provenance");
    const name = file.name ?? file.path.trim().replaceAll("\\", "/").split("/").pop() ?? "";
    if (
      typeof name !== "string" ||
      !name ||
      new TextEncoder().encode(name).length > 180 ||
      /[/\\:*?"<>|]/.test(name) ||
      Array.from(name).some(
        (char) =>
          char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
      ) ||
      /[. ]$/.test(name) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name) ||
      names.has(name.toLowerCase())
    )
      throw new Error("Input filenames must be unique portable basenames (up to 180 bytes)");
    names.add(name.toLowerCase());
    const snapshot = await invokeNative<Omit<BackgroundInputFile, "name">>("fs_snapshot_binary", {
      workdir: file.workdir ?? workdir,
      path: file.path,
    });
    signal?.throwIfAborted();
    if (
      typeof snapshot.contentBase64 !== "string" ||
      snapshot.contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
      !Number.isSafeInteger(snapshot.bytes) ||
      snapshot.bytes < 0 ||
      snapshot.bytes > MAX_BYTES
    )
      throw new Error("Input exceeds 8 MiB or returned invalid metadata");
    const bytes = Uint8Array.from(atob(snapshot.contentBase64), (char) => char.charCodeAt(0));
    if (bytes.length !== snapshot.bytes || sha256Hex(bytes) !== snapshot.contentHash)
      throw new Error("Input snapshot failed size/hash verification");
    if (
      (file.expectedContentHash !== undefined &&
        file.expectedContentHash !== snapshot.contentHash) ||
      (file.expectedBytes !== undefined && file.expectedBytes !== snapshot.bytes)
    )
      throw new Error(
        "Input changed since attachment import; attach the updated file before submitting",
      );
    total += bytes.length;
    if (total > MAX_BYTES) throw new Error("Background task inputs exceed 8 MiB total");
    snapshots.push({
      name,
      contentBase64: snapshot.contentBase64,
      contentHash: snapshot.contentHash,
      bytes: snapshot.bytes,
    });
  }
  return snapshots.sort((a, b) => a.name.localeCompare(b.name));
}
