import { invoke, isTauriRuntime } from "@xgent/runtime";
import { isNativeMobileRuntime } from "../runtimePlatform";

/**
 * Read the desktop clipboard outside the webview first. WKWebView may show a
 * second native paste-confirmation bubble when clipboard text came from a
 * different application. Mobile and browser-only builds fall back to the
 * standard Clipboard API because the desktop command is not registered there.
 */
export async function readClipboardText(): Promise<string | null> {
  if (isTauriRuntime() && !isNativeMobileRuntime()) {
    try {
      return await invoke<string>("system_clipboard_read_text");
    } catch {
      // Fall through to the webview clipboard API.
    }
  }
  try {
    return (await navigator.clipboard?.readText?.()) ?? "";
  } catch {
    return null;
  }
}

function fallbackWriteClipboardText(text: string): boolean {
  let textarea: HTMLTextAreaElement | null = null;
  const focused = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.insetInlineStart = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea?.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (selection && ranges.length) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false;
  // A LAN browser must copy to the viewing device, not the server's clipboard.
  if (isTauriRuntime() && !isNativeMobileRuntime()) {
    try {
      await invoke("system_clipboard_write_text", { text });
      return true;
    } catch {
      // Fall through to the webview clipboard API.
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Keep the synchronous copy fallback for restricted WebViews.
  }
  return fallbackWriteClipboardText(text);
}
