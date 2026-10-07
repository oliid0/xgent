import { canManualCompact, contextUsageRatio } from "../lib/chat/contextUsage";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

/** The same token source, threshold and compaction callback as the Astryx composer. */
export function createNativeChatContextUsage(
  props: {
    conversationId: string;
    usedTokens?: number;
    contextWindow?: number;
    onManualCompact?: () => void;
    manualCompactionDisabled?: boolean;
  },
  t: (key: string) => string,
) {
  const c = presentationControls(JSON.stringify(["context", props.conversationId]));
  const window =
    typeof props.contextWindow === "number" && Number.isFinite(props.contextWindow)
      ? Math.max(0, Math.floor(props.contextWindow))
      : 0;
  const used =
    typeof props.usedTokens === "number" && Number.isFinite(props.usedTokens)
      ? Math.max(0, Math.floor(props.usedTokens))
      : 0;
  if (window <= 0 || used <= 0) return { node: null, handlers: c.handlers };
  const ratio = contextUsageRatio(used, window);
  const usage = `${used.toLocaleString()} / ${window.toLocaleString()} tokens (${Math.min(999, Math.round(ratio * 100))}%)`;
  const offerCompaction = canManualCompact(ratio) && Boolean(props.onManualCompact);
  const node: PresentationNode = {
    id: "context-usage",
    kind: "ProgressBar",
    variant: "context-usage",
    value: props.conversationId,
    label: t("chat.contextUsage"),
    text: usage,
    current: used,
    total: window,
    status: ratio >= 0.8 ? "error" : ratio >= 0.5 ? "paused" : "completed",
    accessibilityValue: usage,
    children: [
      ...(offerCompaction
        ? [
            {
              id: "context-description",
              kind: "Text" as const,
              text: t("chat.manualCompactDescription"),
              secondary: true,
            },
          ]
        : []),
      ...(offerCompaction
        ? [
            {
              ...c.action(
                "context-confirm",
                t("chat.manualCompactConfirm"),
                () => props.onManualCompact?.(),
                !props.manualCompactionDisabled,
              ),
              prominent: true,
            },
          ]
        : []),
    ],
  };
  return { node, handlers: c.handlers };
}
