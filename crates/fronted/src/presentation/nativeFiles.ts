/** Decode the system document picker's payload before importing into the shared workspace. */
export function decodeNativeFiles(payload: string): File[] {
  const files: unknown = JSON.parse(payload);
  if (!Array.isArray(files) || files.length > 9) throw new Error("Invalid attachment selection");
  return files.map((file) => {
    if (
      !file ||
      typeof file.fileName !== "string" ||
      !file.fileName.trim() ||
      typeof file.contentBase64 !== "string" ||
      file.contentBase64.length > 28 * 1024 * 1024
    ) {
      throw new Error("Invalid attachment payload");
    }
    const bytes = Uint8Array.from(atob(file.contentBase64), (value) => value.charCodeAt(0));
    if (bytes.length > 20 * 1024 * 1024) throw new Error("Attachment exceeds 20 MB");
    return new File([bytes], file.fileName, {
      type: typeof file.mimeType === "string" ? file.mimeType : "",
    });
  });
}
