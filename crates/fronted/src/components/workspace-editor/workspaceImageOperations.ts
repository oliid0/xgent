export type ImageRotationDraft = { angle: number; saved: number; editable: boolean };

export function normalizeImageRotation(angle: number): number {
  return ((angle % 360) + 360) % 360;
}
export function validImageRotation(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 360 &&
    value % 90 === 0
  );
}
export function imageRotationFormat(path: string, mime: string): string | null {
  const type = mime.split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg");
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (type === "image/png" && extension === "png") return type;
  if (type === "image/jpeg" && (extension === "jpg" || extension === "jpeg")) return type;
  if (type === "image/webp" && extension === "webp") return type;
  return null;
}
export function hasImageRotationDraft(draft: ImageRotationDraft | undefined): boolean {
  return !!draft?.editable && draft.angle !== draft.saved;
}
export function remainingImageRotation(
  current: ImageRotationDraft | undefined,
  written: ImageRotationDraft | undefined,
) {
  return current && written ? { ...current, saved: written.angle } : current;
}
export function workspaceImagePaths(paths: string[] | undefined, activePath: string): string[] {
  const result = [...new Set((paths ?? []).filter((path) => typeof path === "string" && !!path))];
  if (activePath && !result.includes(activePath)) result.push(activePath);
  return result;
}

/** Both visible interfaces use the same raster transform and guarded Rust binary writer. */
export async function rotateWorkspaceImage(
  bytes: Uint8Array,
  mimeType: string,
  degrees: number,
): Promise<Uint8Array> {
  if (!validImageRotation(degrees) || !["image/png", "image/jpeg", "image/webp"].includes(mimeType))
    throw new Error("Unsupported image rotation");
  if (degrees === 0) return bytes;
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 64_000_000
    )
      throw new Error("Image dimensions exceed the editing limit");
    const canvas = document.createElement("canvas");
    const swapsAxes = degrees === 90 || degrees === 270;
    canvas.width = swapsAxes ? image.naturalHeight : image.naturalWidth;
    canvas.height = swapsAxes ? image.naturalWidth : image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image editing is unavailable");
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((degrees * Math.PI) / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Image encoding failed"))),
        mimeType,
        mimeType === "image/png" ? undefined : 0.94,
      ),
    );
    // Browsers may return PNG for an unsupported encoder. Never write it under another extension.
    if (blob.type !== mimeType)
      throw new Error("This image format cannot be encoded on this device");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
