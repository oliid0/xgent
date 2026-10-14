import type { OfficeImageSnapshot } from "../office/createOfficeDocument";
import { sha256Hex } from "../trajectory/sha256";
import { backend } from "./backend";
import { captureBackgroundLease } from "./backgroundLease";
import type { BackgroundExecutionLease } from "./types";

/** Retained parent bytes, never a newly selected peer or a child workspace. */
export function createBackgroundOfficeImageReader(
  executionId: string,
  executionLease: BackgroundExecutionLease,
  verifyConfiguration: () => Promise<unknown>,
): (artifactId: string, signal?: AbortSignal) => Promise<OfficeImageSnapshot> {
  const lease = captureBackgroundLease(executionLease);
  return async (artifactId, signal) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(artifactId))
      throw new Error("Office image requires an actual retained parent artifact ID");
    signal?.throwIfAborted();
    await verifyConfiguration();
    signal?.throwIfAborted();
    const result = await backend.readBackgroundExecutionArtifact(executionId, artifactId, lease);
    signal?.throwIfAborted();
    const { artifact, contentBase64 } = result;
    if (
      artifact?.id !== artifactId ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      artifact.bytes > 8 * 1024 * 1024 ||
      typeof contentBase64 !== "string" ||
      contentBase64.length > Math.ceil((8 * 1024 * 1024) / 3) * 4 ||
      contentBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)
    )
      throw new Error("Retained Office image returned inconsistent artifact evidence");
    const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
    if (bytes.length !== artifact.bytes || sha256Hex(bytes) !== artifact.contentHash)
      throw new Error("Retained Office image failed integrity verification");
    const png =
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
    const jpeg =
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255 &&
      bytes.at(-2) === 255 &&
      bytes.at(-1) === 217;
    if (!png && !jpeg) throw new Error("Retained Office image must contain PNG or JPEG bytes");
    await verifyConfiguration();
    signal?.throwIfAborted();
    return { data: contentBase64, mimeType: png ? "image/png" : "image/jpeg" };
  };
}
