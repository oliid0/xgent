export const FILE_UPLOAD_DROP_ZONE_SELECTOR = "[data-file-upload-drop-zone]";

type DropPosition = { x: number; y: number };

export function nativeDropPositionScaleFactor(userAgent: string, deviceScaleFactor: number) {
  if (!/\bWindows\b/i.test(userAgent)) return 1;
  return Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0 ? deviceScaleFactor : 1;
}

export function logicalNativeDropPoint(position: DropPosition, scaleFactor: number) {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return { x: position.x / safeScale, y: position.y / safeScale };
}

export function isNativeDropInsideUploadZone(
  position: DropPosition,
  options?: { scaleFactor?: number; document?: Document },
) {
  const targetDocument = options?.document ?? document;
  const point = logicalNativeDropPoint(position, options?.scaleFactor ?? window.devicePixelRatio);
  return Array.from(
    targetDocument.querySelectorAll<HTMLElement>(FILE_UPLOAD_DROP_ZONE_SELECTOR),
  ).some((element) => {
    const rect = element.getBoundingClientRect();
    return (
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    );
  });
}
