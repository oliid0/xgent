import { inferRuntimePlatform } from "../lib/runtimePlatform";
import type {
  PresentationAction,
  PresentationActionResult,
  PresentationDocument,
} from "../presentation/types";
import { invoke, isTauriRuntime } from "./index";

/** Apple application targets use the linked SwiftUI host; Safari remains Astryx. */
export function supportsApplePresentation() {
  if (!isTauriRuntime()) return false;
  const platform = inferRuntimePlatform();
  return platform === "ios" || platform === "macos";
}

export function isApplePresentationRuntime() {
  return supportsApplePresentation();
}

export async function publishApplePresentation(document: PresentationDocument) {
  await invoke("apple_ui_update", { payload: document });
}

export async function acknowledgeApplePresentation(result: PresentationActionResult) {
  await invoke("apple_ui_action_result", { payload: result });
}

export function subscribeApplePresentation(handler: (action: PresentationAction) => void) {
  const receive = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const action = event.detail as Partial<PresentationAction> | undefined;
    if (
      !action ||
      typeof action.surface !== "string" ||
      typeof action.action !== "string" ||
      typeof action.requestId !== "string" ||
      !(
        action.value === null ||
        typeof action.value === "string" ||
        typeof action.value === "boolean" ||
        (typeof action.value === "number" && Number.isFinite(action.value))
      )
    )
      return;
    handler(action as PresentationAction);
  };
  window.addEventListener("xgent:native-action", receive);
  return () => window.removeEventListener("xgent:native-action", receive);
}
