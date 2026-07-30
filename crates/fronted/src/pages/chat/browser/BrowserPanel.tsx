import { isTauriRuntime } from "@xagent/runtime";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowLeft, Globe, Loader2, Lock, Plus, RefreshCw, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  browserSessionController,
  HIDDEN_BROWSER_VIEWPORT,
  MAX_BROWSER_SESSIONS,
  normalizeBrowserAddress,
} from "../../../lib/browser/browserSessionController";
import { cn } from "../../../lib/shared/utils";

function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function BrowserTabs() {
  const { t } = useLocale();
  const snapshot = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/45 bg-muted/35 px-2">
      <button
        type="button"
        disabled={snapshot.sessions.length >= MAX_BROWSER_SESSIONS}
        onClick={() => void browserSessionController.newSession()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:opacity-35"
        aria-label={t("browser.newTab")}
      >
        <Plus className="h-4 w-4" />
      </button>
      <div
        data-edge-swipe-ignore
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none]"
      >
        {snapshot.sessions.map((session) => {
          const selected = session.sessionId === snapshot.activeSessionId;
          const busy = snapshot.busySessionIds.includes(session.sessionId);
          return (
            <div
              key={session.sessionId}
              className={cn(
                "group flex h-8 min-w-[112px] max-w-[190px] items-center gap-2 rounded-lg border px-2.5 text-left transition-colors",
                selected
                  ? "border-border/65 bg-background text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-background/55 hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => browserSessionController.selectSession(session.sessionId)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                ) : (
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {session.title?.trim() || hostname(session.url) || t("browser.untitled")}
                </span>
              </button>
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md opacity-45 hover:bg-muted hover:opacity-100"
                aria-label={t("browser.closeTab")}
                onClick={(event) => {
                  event.stopPropagation();
                  void browserSessionController.closeSession(session.sessionId);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <span className="shrink-0 px-1 font-mono text-[10px] text-muted-foreground/65">
        {snapshot.sessions.length}/{MAX_BROWSER_SESSIONS}
      </span>
    </div>
  );
}

function BrowserAddressBar() {
  const { t } = useLocale();
  const snapshot = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  const active = snapshot.sessions.find(
    (session) => session.sessionId === snapshot.activeSessionId,
  );
  const busy = Boolean(active && snapshot.busySessionIds.includes(active.sessionId));
  const [value, setValue] = useState(active?.url ?? "");

  useEffect(() => {
    setValue(active?.url ?? "");
  }, [active?.sessionId, active?.url]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!active || !value.trim()) return;
    void browserSessionController.action(
      "navigate",
      { url: normalizeBrowserAddress(value) },
      { sessionId: active.sessionId },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="flex h-12 shrink-0 items-center gap-2 border-b border-border/45 bg-background/90 px-2.5"
    >
      <button
        type="button"
        disabled={!active || busy}
        onClick={() =>
          active &&
          void browserSessionController.action("go_back", {}, { sessionId: active.sessionId })
        }
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
        aria-label={t("browser.back")}
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={!active || busy}
        onClick={() =>
          active &&
          void browserSessionController.action("go_forward", {}, { sessionId: active.sessionId })
        }
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
        aria-label={t("browser.forward")}
      >
        <ArrowLeft className="h-4 w-4 rotate-180" />
      </button>
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border/55 bg-muted/45 px-3 shadow-inner">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
        ) : (
          <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <input
          data-edge-swipe-ignore
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("browser.addressPlaceholder")}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/65"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <button
        type="button"
        disabled={!active || busy}
        onClick={() =>
          active &&
          void browserSessionController.action("reload", {}, { sessionId: active.sessionId })
        }
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
        aria-label={t("browser.reload")}
      >
        <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
      </button>
    </form>
  );
}

function BrowserViewportSlot() {
  const { t } = useLocale();
  const slotRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const previousSessionRef = useRef<string | null>(null);
  const snapshot = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  const activeSessionId = snapshot.activeSessionId;
  const localNativeSurface = isTauriRuntime();

  const syncViewport = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const element = slotRef.current;
      const sessionId = browserSessionController.getSnapshot().activeSessionId;
      if (!localNativeSurface || !element || !sessionId) return;
      const rect = element.getBoundingClientRect();
      void browserSessionController
        .setViewport(sessionId, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          visible: rect.width > 1 && rect.height > 1,
          scaleFactor: window.devicePixelRatio || 1,
        })
        .catch(() => undefined);
    });
  }, [localNativeSurface]);

  useLayoutEffect(() => {
    if (!localNativeSurface) return;
    const previous = previousSessionRef.current;
    if (previous && previous !== activeSessionId) {
      void browserSessionController
        .setViewport(previous, HIDDEN_BROWSER_VIEWPORT)
        .catch(() => undefined);
    }
    previousSessionRef.current = activeSessionId;
    syncViewport();
  }, [activeSessionId, localNativeSurface, syncViewport]);

  useEffect(() => {
    if (!localNativeSurface) return;
    const element = slotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(syncViewport);
    observer.observe(element);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("scroll", syncViewport, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("scroll", syncViewport, true);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      const current = previousSessionRef.current;
      if (current) {
        void browserSessionController
          .setViewport(current, HIDDEN_BROWSER_VIEWPORT)
          .catch(() => undefined);
      }
    };
  }, [localNativeSurface, syncViewport]);

  return (
    <div
      ref={slotRef}
      data-edge-swipe-ignore
      className="relative min-h-0 flex-1 overflow-hidden bg-white"
    >
      {!localNativeSurface ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-8 text-center text-muted-foreground">
          <Globe className="h-6 w-6" />
          <div>
            <div className="text-sm font-medium text-foreground">
              {t("browser.remoteHostTitle")}
            </div>
            <div className="mt-1 max-w-sm text-xs leading-5">
              {t("browser.remoteHostDescription")}
            </div>
          </div>
        </div>
      ) : !activeSessionId ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-xs">{t("browser.preparing")}</span>
        </div>
      ) : null}
    </div>
  );
}

export function BrowserPanel() {
  const { t } = useLocale();
  const snapshot = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );

  useEffect(() => {
    if (snapshot.panelOpen) void browserSessionController.initialize();
  }, [snapshot.panelOpen]);

  if (!snapshot.panelOpen) return null;

  return (
    <section
      data-edge-swipe-ignore
      className="absolute inset-0 z-[66] flex flex-col overflow-hidden bg-background pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)]"
      aria-label={t("browser.title")}
    >
      <header className="flex h-14 min-h-14 shrink-0 items-center gap-3 border-b border-border/45 bg-background/90 px-3 backdrop-blur-xl">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/12 text-blue-600 dark:text-blue-300">
          <Globe className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold tracking-tight">
            {t("browser.title")}
          </div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            {snapshot.busySessionIds.length > 0
              ? t("browser.agentOperating")
              : t("browser.sharedSession")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => browserSessionController.closePanel()}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("browser.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <BrowserTabs />
      <BrowserAddressBar />

      {snapshot.error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/8 px-3 py-2 text-[11px] text-destructive">
          <span className="min-w-0 flex-1 break-words">{snapshot.error}</span>
          <button
            type="button"
            className="rounded-md px-2 py-1 font-medium hover:bg-destructive/10"
            onClick={() => browserSessionController.clearError()}
          >
            {t("browser.dismissError")}
          </button>
        </div>
      ) : null}

      <BrowserViewportSlot />
    </section>
  );
}
