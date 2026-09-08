import type { ImagePreviewSlide } from "../../components/chat/ImagePreview";
export const OPEN_IMAGE_ACTIVITY = "xgent:open-image-activity";
export type ImageActivity = { slides: ImagePreviewSlide[]; index: number };
const selections = new Map<string, ImageActivity>();
const listeners = new Set<() => void>();
export function requestImageActivity(slides: ImagePreviewSlide[], index: number) {
  window.dispatchEvent(new CustomEvent(OPEN_IMAGE_ACTIVITY, { detail: { slides, index } }));
}
export const imageActivitySelection = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(conversationId: string) {
    return selections.get(conversationId) ?? null;
  },
  select(conversationId: string, value: ImageActivity | null) {
    selections.delete(conversationId);
    if (value) selections.set(conversationId, value);
    while (selections.size > 12) selections.delete(selections.keys().next().value!);
    for (const listener of listeners) listener();
  },
};
