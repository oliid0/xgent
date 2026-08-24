import { invoke } from "@xagent/runtime";

/**
 * Read the desktop clipboard outside the webview first. WKWebView may show a
 * second native paste-confirmation bubble when clipboard text came from a
 * different application. Mobile and browser-only builds fall back to the
 * standard Clipboard API because the desktop command is not registered there.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await invoke<string>("system_clipboard_read_text");
  } catch {
    // Fall through to the webview clipboard API.
  }
  try {
    return (await navigator.clipboard?.readText?.()) ?? "";
  } catch {
    return null;
  }
}
