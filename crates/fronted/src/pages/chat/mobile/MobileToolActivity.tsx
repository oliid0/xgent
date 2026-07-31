import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { useMemo, useSyncExternalStore } from "react";
import {
  Check,
  ChevronRight,
  Globe,
  Loader2,
  Terminal,
  Wrench,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type {
  LiveTranscriptState,
  LiveTranscriptStore,
} from "../../../lib/chat/conversation/liveTranscriptStore";
import {
  safeStringify,
  summarizeToolCall,
  type ToolTraceItem,
  toolResultMessageToText,
} from "../../../lib/chat/messages/uiMessages";
import { cn } from "../../../lib/shared/utils";

type MobileToolActivityProps = {
  store: LiveTranscriptStore;
  open: boolean;
  onOpen: () => void;
  onOpenBrowser?: () => void;
  onOpenTerminal?: () => void;
  onClose: () => void;
  bottomOffsetPx: number;
};

type ActivityItem = ToolTraceItem & {
  running: boolean;
  round: number;
};

function subscribeNoop() {
  return () => {};
}

const EMPTY_TRANSCRIPT: LiveTranscriptState = {
  draftAssistantText: "",
  toolStatus: null,
  liveRounds: [],
  retryAttempts: [],
  isSettled: true,
};

function collectActivityItems(snapshot: LiveTranscriptState): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const round of snapshot.liveRounds) {
    const runningIds = new Set(round.runningToolCallIds);
    for (const block of round.blocks) {
      if (block.kind !== "tool") continue;
      items.push({
        ...block.item,
        running: runningIds.has(block.item.toolCall.id),
        round: round.round,
      });
    }
  }
  return items;
}

function activityKind(name: string): "shell" | "browser" | "tool" {
  const normalized = name.toLowerCase();
  if (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "shell";
  }
  if (
    normalized.includes("browser") ||
    normalized.includes("websearch") ||
    normalized.includes("web_search")
  ) {
    return "browser";
  }
  return "tool";
}

function ActivityIcon({ name, running }: { name: string; running: boolean }) {
  if (running) return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  switch (activityKind(name)) {
    case "shell":
      return <Terminal className="h-3.5 w-3.5" />;
    case "browser":
      return <Globe className="h-3.5 w-3.5" />;
    case "tool":
      return <Wrench className="h-3.5 w-3.5" />;
  }
}

function toolOutput(item: ActivityItem) {
  if (!item.toolResult) return "";
  const output = toolResultMessageToText(item.toolResult);
  return output.trim();
}

function toolFailed(result: ToolResultMessage | undefined) {
  return Boolean(result && "isError" in result && result.isError);
}

function ActivityDetail({ item }: { item: ActivityItem }) {
  const { t } = useLocale();
  const output = toolOutput(item);
  const failed = toolFailed(item.toolResult);

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-start gap-2.5 border-b border-border/45 px-3.5 py-3">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            item.running
              ? "bg-blue-500/12 text-blue-600 dark:text-blue-300"
              : failed
                ? "bg-destructive/10 text-destructive"
                : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
          )}
        >
          {item.running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{item.toolCall.name}</span>
          <span className="mt-0.5 block break-words text-[11px] leading-4 text-muted-foreground">
            {summarizeToolCall(item.toolCall, { includeName: false }) ||
              t("chat.mobileActivity.noArguments")}
          </span>
        </span>
        <span className="text-[10px] text-muted-foreground/70">
          {t("chat.mobileActivity.round").replace("{round}", String(item.round))}
        </span>
      </div>
      <div className="space-y-2 px-3.5 py-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t("chat.mobileActivity.input")}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted/55 p-2.5 font-mono text-[10.5px] leading-4 text-foreground/85">
            {safeStringify(item.toolCall.arguments || {})}
          </pre>
        </div>
        {output ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t("chat.mobileActivity.output")}
            </div>
            <pre
              data-edge-swipe-ignore
              className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-zinc-950 p-2.5 font-mono text-[10.5px] leading-4 text-zinc-100"
            >
              {output}
            </pre>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function MobileToolActivity({
  store,
  open,
  onOpen,
  onOpenBrowser,
  onOpenTerminal,
  onClose,
  bottomOffsetPx,
}: MobileToolActivityProps) {
  const { t } = useLocale();
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNoop,
    store?.getSnapshot ?? (() => EMPTY_TRANSCRIPT),
    () => EMPTY_TRANSCRIPT,
  );
  const items = useMemo(() => collectActivityItems(snapshot), [snapshot]);
  const activeItem = [...items].reverse().find((item) => item.running) ?? null;
  const latestItem = items.at(-1) ?? null;
  const capsuleItem = activeItem;
  const status = snapshot.toolStatus?.trim() || "";

  return (
    <>
      {capsuleItem || status ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-5"
          style={{ bottom: `${Math.max(0, bottomOffsetPx) + 7}px` }}
        >
          <button
            type="button"
            onClick={() => {
              const kind = capsuleItem ? activityKind(capsuleItem.toolCall.name) : "tool";
              if (kind === "browser" && onOpenBrowser) {
                onOpenBrowser();
                return;
              }
              if (kind === "shell" && onOpenTerminal) {
                onOpenTerminal();
                return;
              }
              onOpen();
            }}
            className="pointer-events-auto flex h-9 max-w-[min(86vw,420px)] items-center gap-2 rounded-full border border-black/[0.07] bg-white/82 px-3 text-left shadow-[0_8px_24px_-12px_rgba(15,23,42,0.38),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl backdrop-saturate-150 active:scale-[0.98] dark:border-white/[0.12] dark:bg-zinc-900/82 dark:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.09)]"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/12 text-blue-600 dark:text-blue-300">
              <ActivityIcon name={capsuleItem?.toolCall.name ?? ""} running />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold leading-4 text-foreground">
                {capsuleItem?.toolCall.name || t("chat.mobileActivity.working")}
              </span>
              <span className="block truncate text-[10px] leading-3 text-muted-foreground">
                {capsuleItem
                  ? summarizeToolCall(capsuleItem.toolCall, { includeName: false }) || status
                  : status}
              </span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/55" />
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          "fixed inset-0 z-[70] bg-background transition-opacity duration-150",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!open}
      >
        <aside
          data-mobile-right-drawer
          className={cn(
            "absolute inset-0 flex w-full flex-col overflow-hidden bg-background pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)] transition-transform duration-200",
            open ? "translate-x-0" : "translate-x-[8%]",
          )}
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3.5">
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted"
              aria-label={t("chat.mobileActivity.close")}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold tracking-tight">
                {t("chat.mobileActivity.title")}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {activeItem ? t("chat.mobileActivity.running") : t("chat.mobileActivity.recent")}
              </div>
            </div>
            {activeItem ? (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground">
                <ActivityIcon name={activeItem.toolCall.name} running />
              </div>
            ) : null}
          </header>

          <div
            data-edge-swipe-ignore
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3.5"
          >
            {items.length > 0 ? (
              [...items]
                .reverse()
                .map((item) => <ActivityDetail key={item.toolCall.id} item={item} />)
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-8 text-center text-muted-foreground">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Wrench className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {t("chat.mobileActivity.empty")}
                  </div>
                  <div className="mt-1 text-xs leading-5">
                    {t("chat.mobileActivity.emptyDescription")}
                  </div>
                </div>
              </div>
            )}
            {!activeItem && latestItem && status ? (
              <div className="rounded-xl bg-muted/55 px-3 py-2 text-xs text-muted-foreground">
                {status}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </>
  );
}
