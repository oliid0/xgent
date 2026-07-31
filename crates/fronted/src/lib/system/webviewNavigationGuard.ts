export interface GuardKeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface GuardKeyOptions {
  isMac: boolean;
  allowReloadChords: boolean;
}

const BROWSER_NAV_KEYS = new Set([
  "BrowserBack",
  "BrowserForward",
  "BrowserHome",
  "BrowserSearch",
  "BrowserFavorites",
  "BrowserStop",
]);

const PRIMARY_BLOCKED_CODES = new Set(["KeyP", "KeyF", "KeyS", "KeyO", "KeyU"]);
const PRIMARY_BLOCKED_KEYS = new Set(["p", "f", "s", "o", "u"]);

export function shouldBlockBrowserKeyDefault(
  event: GuardKeyInput,
  options: GuardKeyOptions,
): boolean {
  const primary = event.ctrlKey || event.metaKey;
  if (event.key === "F5" || event.key === "BrowserRefresh") {
    return !options.allowReloadChords;
  }
  if (event.key === "F3" || event.key === "F7" || BROWSER_NAV_KEYS.has(event.key)) {
    return true;
  }

  // Windows reports AltGr as Ctrl+Alt. Let it through so international text
  // input does not lose characters.
  if (primary && !event.altKey) {
    if (event.code === "KeyR" || event.key.toLowerCase() === "r") {
      return !options.allowReloadChords;
    }
    if (
      PRIMARY_BLOCKED_CODES.has(event.code) ||
      PRIMARY_BLOCKED_KEYS.has(event.key.toLowerCase())
    ) {
      return true;
    }
  }

  // Option+Arrow is normal cursor navigation on macOS, so history shortcuts
  // are blocked only on Windows and Linux.
  return (
    !options.isMac &&
    event.altKey &&
    !primary &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home")
  );
}

function isEditableDragTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable === true
  );
}

export interface WebviewNavigationGuardOptions {
  isMac: boolean;
  allowReloadChords?: boolean;
}

export interface GuardEventSource {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

let uninstallCurrent: (() => void) | null = null;

/**
 * Prevent browser-level navigation inside the installed desktop WebView.
 * Application handlers still receive the events because the guard only calls
 * preventDefault and never stops propagation.
 */
export function installWebviewNavigationGuard(
  options: WebviewNavigationGuardOptions,
  target?: GuardEventSource,
): () => void {
  const eventSource = target ?? (typeof window === "undefined" ? null : window);
  if (!eventSource) return () => {};
  uninstallCurrent?.();

  const keyOptions: GuardKeyOptions = {
    isMac: options.isMac,
    allowReloadChords: options.allowReloadChords ?? false,
  };
  const onKeyDown = (rawEvent: Event) => {
    const event = rawEvent as KeyboardEvent;
    if (shouldBlockBrowserKeyDefault(event, keyOptions)) event.preventDefault();
  };
  const onNavigationMouseButton = (rawEvent: Event) => {
    const event = rawEvent as MouseEvent;
    if (event.button === 3 || event.button === 4) event.preventDefault();
  };
  const onDragOver = (rawEvent: Event) => {
    const event = rawEvent as DragEvent;
    if (event.defaultPrevented || isEditableDragTarget(event.target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  };
  const onDrop = (rawEvent: Event) => {
    const event = rawEvent as DragEvent;
    if (event.defaultPrevented || isEditableDragTarget(event.target)) return;
    event.preventDefault();
  };
  const onSubmit = (event: Event) => {
    if (!event.defaultPrevented) event.preventDefault();
  };

  eventSource.addEventListener("keydown", onKeyDown, { capture: true });
  eventSource.addEventListener("mousedown", onNavigationMouseButton, { capture: true });
  eventSource.addEventListener("mouseup", onNavigationMouseButton, { capture: true });
  eventSource.addEventListener("dragover", onDragOver);
  eventSource.addEventListener("drop", onDrop);
  eventSource.addEventListener("submit", onSubmit);

  const uninstall = () => {
    eventSource.removeEventListener("keydown", onKeyDown, { capture: true });
    eventSource.removeEventListener("mousedown", onNavigationMouseButton, { capture: true });
    eventSource.removeEventListener("mouseup", onNavigationMouseButton, { capture: true });
    eventSource.removeEventListener("dragover", onDragOver);
    eventSource.removeEventListener("drop", onDrop);
    eventSource.removeEventListener("submit", onSubmit);
    if (uninstallCurrent === uninstall) uninstallCurrent = null;
  };
  uninstallCurrent = uninstall;
  return uninstall;
}
