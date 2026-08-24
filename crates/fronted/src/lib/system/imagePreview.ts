import { invoke, isTauriRuntime } from "@xagent/runtime";

import { isNativeMobileRuntime } from "../runtimePlatform";

export type ImagePreviewData = {
  dataBase64: string;
  fileName: string;
  mimeType: string;
};

type ImagePreviewSaveRequest = Pick<ImagePreviewData, "fileName" | "mimeType">;
type ImagePreviewCopyData = Pick<ImagePreviewData, "dataBase64" | "mimeType">;
type ImagePreviewCopyRequest = ImagePreviewCopyData | PromiseLike<ImagePreviewCopyData>;

const BASE64_CHUNK_SIZE = 0x8000;

function hasNativeDesktopImageCommands() {
  return isTauriRuntime() && !isNativeMobileRuntime();
}

export const supportsSystemImageOpen = hasNativeDesktopImageCommands();
export const supportsDirectUploadedImageCopy =
  hasNativeDesktopImageCommands() &&
  typeof ClipboardItem !== "undefined" &&
  typeof navigator !== "undefined" &&
  typeof navigator.clipboard?.write === "function";

type UploadedImagePreviewRequest = {
  workdir: string;
  absolutePath: string;
};

let preparedUploadedImage: { key: string; data: Promise<ImagePreviewCopyData> } | undefined;

function base64ToBytes(dataBase64: string) {
  const binary = window.atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index] ?? 0);
    }
  }
  return window.btoa(binary);
}

function previewBlob(data: ImagePreviewCopyData) {
  return new Blob([base64ToBytes(data.dataBase64).buffer as ArrayBuffer], {
    type: data.mimeType || "application/octet-stream",
  });
}

async function drawImageBlobToCanvas(source: Blob) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image clipboard canvas is unavailable");

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(source);
      try {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        context.drawImage(bitmap, 0, 0);
        return canvas;
      } finally {
        bitmap.close();
      }
    } catch {
      // SVG and WebView-specific codecs can require the regular image decoder.
    }
  }

  const blobUrl = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to decode image for clipboard"));
      image.src = blobUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("Image has no drawable dimensions");
    }
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode image for clipboard"));
    }, "image/png");
  });
}

function extensionForMime(mimeType: string) {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized?.startsWith("image/")) return normalized.slice("image/".length) || "png";
  return "png";
}

export function imagePreviewFileName(
  preferredName: string | undefined,
  mimeType: string,
  fallbackStem = "image",
) {
  const safe = (preferredName ?? "")
    .trim()
    .split("")
    .map((character) =>
      character.charCodeAt(0) <= 31 || '\\/:*?"<>|'.includes(character) ? "_" : character,
    )
    .join("")
    .replace(/[. ]+$/g, "")
    .slice(0, 160);
  const fallback = `${fallbackStem}.${extensionForMime(mimeType)}`;
  if (!safe) return fallback;
  return /\.[a-z0-9]{2,5}$/i.test(safe) ? safe : `${safe}.${extensionForMime(mimeType)}`;
}

export async function loadImagePreviewData(
  src: string,
  preferredName?: string,
): Promise<ImagePreviewData> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Unable to load image preview (${response.status})`);
  const blob = await response.blob();
  const mimeType = blob.type || "image/png";
  return {
    dataBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    fileName: imagePreviewFileName(preferredName, mimeType),
    mimeType,
  };
}

export async function prepareImagePreviewSave(request: ImagePreviewSaveRequest) {
  if (!hasNativeDesktopImageCommands()) return null;
  const saveToken = await invoke<string | null>("system_prepare_preview_file_save", {
    file_name: request.fileName,
  });
  if (!saveToken) return null;

  return async (data: ImagePreviewData) => {
    await invoke<void>("system_write_preview_file", {
      save_token: saveToken,
      data_base64: data.dataBase64,
      mime_type: data.mimeType,
    });
  };
}

function downloadImagePreviewData(request: ImagePreviewData) {
  const url = URL.createObjectURL(previewBlob(request));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = request.fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function saveImagePreviewData(request: ImagePreviewData) {
  if (hasNativeDesktopImageCommands()) {
    const writeImage = await prepareImagePreviewSave(request);
    if (!writeImage) return false;
    await writeImage(request);
    return true;
  }
  downloadImagePreviewData(request);
  return true;
}

export async function saveImagePreviewSource(src: string, preferredName?: string) {
  if (hasNativeDesktopImageCommands()) {
    // Open the native save dialog during the original click gesture, before
    // remote/blob image loading introduces an asynchronous gap.
    const mimeHint = /^data:([^;,]+)/i.exec(src)?.[1] || "image/png";
    const fileName = imagePreviewFileName(preferredName, mimeHint);
    const writeImage = await prepareImagePreviewSave({ fileName, mimeType: mimeHint });
    if (!writeImage) return false;
    const data = await loadImagePreviewData(src, fileName);
    await writeImage(data);
    return true;
  }
  return saveImagePreviewData(await loadImagePreviewData(src, preferredName));
}

export async function copyImagePreviewData(request: ImagePreviewCopyRequest) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Image clipboard writing is unavailable");
  }
  // ClipboardItem accepts a pending Blob. Calling write before image loading
  // completes preserves the user activation required by WebKit/WebView2.
  const png = Promise.resolve(request).then(async (data) =>
    canvasToPng(await drawImageBlobToCanvas(previewBlob(data))),
  );
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export async function copyImagePreviewSource(src: string) {
  await copyImagePreviewData(loadImagePreviewData(src));
}

function uploadedImageRequestKey(request: UploadedImagePreviewRequest) {
  return `${request.workdir}\u0000${request.absolutePath}`;
}

function loadUploadedImagePreview(request: UploadedImagePreviewRequest) {
  return invoke<{ data: string; mimeType: string }>("system_read_uploaded_image_preview", {
    workdir: request.workdir,
    absolute_path: request.absolutePath,
  }).then((response) => ({
    dataBase64: response.data,
    mimeType: response.mimeType,
  }));
}

export async function prepareUploadedImagePreviewCopy(request: UploadedImagePreviewRequest) {
  if (!supportsDirectUploadedImageCopy) return;
  const key = uploadedImageRequestKey(request);
  if (preparedUploadedImage?.key === key) return preparedUploadedImage.data.then(() => undefined);
  const data = loadUploadedImagePreview(request);
  preparedUploadedImage = { key, data };
  await data;
}

export async function copyUploadedImagePreview(request: UploadedImagePreviewRequest) {
  const key = uploadedImageRequestKey(request);
  const data =
    preparedUploadedImage?.key === key
      ? preparedUploadedImage.data
      : loadUploadedImagePreview(request);
  preparedUploadedImage = undefined;
  await copyImagePreviewData(data);
}

export async function openUploadedImageInSystemViewer(request: {
  workdir: string;
  absolutePath: string;
}) {
  await invoke<void>("system_open_uploaded_image", {
    workdir: request.workdir,
    absolute_path: request.absolutePath,
  });
}
