import { prepareMobileImageAttachment } from "../../../lib/mobileAssistant";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";

type UploadedReadableFileInput = {
  fileName: string;
  mimeType?: string;
  contentBase64: string;
};

// This path base64-encodes the original across Tauri IPC. Native photo pickers
// can accept larger sources because they downsample before crossing the bridge.
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const supportedImageMimes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
]);

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function fileToUploadInput(file: File): Promise<UploadedReadableFileInput> {
  const svg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const nativeImage =
    isNativeMobileRuntime() &&
    !svg &&
    (file.type.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|avif|bmp|ico|heic|heif|tiff?)$/i.test(file.name));
  if (nativeImage && file.size > MAX_IMAGE_BYTES) throw new Error("照片超过 32 MB 导入上限");
  const input = {
    fileName: file.name,
    mimeType: file.type || undefined,
    contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
  };
  if (!nativeImage) return input;
  // Native decoders inspect bytes rather than the picker-provided MIME/extension.
  const result = await prepareMobileImageAttachment(input);
  if (
    !result ||
    typeof result.fileName !== "string" ||
    !result.fileName.trim() ||
    !supportedImageMimes.has(result.mimeType) ||
    typeof result.contentBase64 !== "string" ||
    !result.contentBase64.length ||
    result.contentBase64.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 ||
    result.contentBase64.length % 4 !== 0 ||
    (result.contentBase64.length / 4) * 3 -
      (result.contentBase64.endsWith("==") ? 2 : result.contentBase64.endsWith("=") ? 1 : 0) >
      MAX_PREVIEW_BYTES ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(result.contentBase64)
  ) {
    throw new Error("照片转换未返回受支持的图片");
  }
  return result;
}

export async function prepareReadableUploads(files: File[]) {
  const prepared: UploadedReadableFileInput[] = [];
  const skipped: string[] = [];
  // Each native decoder owns a bounded bitmap; avoid decoding nine photos at once.
  for (const file of files) {
    try {
      prepared.push(await fileToUploadInput(file));
    } catch (error) {
      skipped.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { files: prepared, skipped };
}
