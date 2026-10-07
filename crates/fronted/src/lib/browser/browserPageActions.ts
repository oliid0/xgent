import { openUrl } from "@xgent/runtime";
import { writeClipboardText } from "../system/clipboardText";

export function canOpenBrowserPage(url: string | undefined): url is string {
  if (!url) return false;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Page actions use the viewing device, including native clipboard and opener. */
export async function runBrowserPageAction(
  action: "copy_address" | "open_external",
  url: string,
): Promise<void> {
  if (!canOpenBrowserPage(url)) throw new Error("Unsupported browser page address");
  if (action === "open_external") await openUrl(url);
  else if (!(await writeClipboardText(url))) throw new Error("Could not copy the page address");
}
