import { useSyncExternalStore } from "react";

export const COMPACT_VIEWPORT_MEDIA_QUERY = "(max-width: 768px)";

export function isCompactViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(COMPACT_VIEWPORT_MEDIA_QUERY).matches
  );
}

function subscribeToCompactViewport(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const media = window.matchMedia(COMPACT_VIEWPORT_MEDIA_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useCompactViewport(): boolean {
  return useSyncExternalStore(subscribeToCompactViewport, isCompactViewport, () => false);
}
