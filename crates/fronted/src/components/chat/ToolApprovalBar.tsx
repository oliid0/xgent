import { useEffect, useMemo, useState } from "react";
import { useLocale } from "../../i18n";
import type {
  PendingToolApprovalSummary,
  ToolApprovalDecision,
} from "../../lib/tools/toolApproval";
import { Shield } from "../icons";

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function ToolApprovalBar(props: {
  pending: PendingToolApprovalSummary[];
  onDecide: (
    toolCallId: string,
    decision: ToolApprovalDecision,
  ) => Promise<{ ok: boolean; message?: string }>;
  onDecideAll: (decision: "approve" | "deny") => Promise<void>;
}) {
  const { t } = useLocale();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const earliestDeadline = useMemo(
    () =>
      props.pending.length > 0
        ? Math.min(...props.pending.map((item) => item.deadlineAt))
        : Date.now(),
    [props.pending],
  );
  const [remainingMs, setRemainingMs] = useState(() => earliestDeadline - Date.now());

  useEffect(() => {
    const update = () => setRemainingMs(earliestDeadline - Date.now());
    update();
    const timer = globalThis.setInterval(update, 1000);
    return () => globalThis.clearInterval(timer);
  }, [earliestDeadline]);

  if (props.pending.length === 0) return null;

  const guarded = async (task: () => Promise<{ ok: boolean; message?: string } | void>) => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const outcome = await task();
      if (outcome && !outcome.ok) setError(outcome.message || t("chat.toolApproval.failed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.toolApproval.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto mb-[-1px] w-[calc(100%-1.5rem)] max-w-[720px] overflow-hidden rounded-t-2xl border border-b-0 border-amber-500/35 bg-background/92 px-3 py-2.5 shadow-lg backdrop-blur-2xl">
      <header className="flex items-center gap-2">
        <Shield className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 text-xs font-semibold">
          {t("chat.toolApproval.title").replace("{count}", String(props.pending.length))}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {formatCountdown(remainingMs)}
        </span>
      </header>
      {props.pending.length > 1 ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void guarded(() => props.onDecideAll("approve"))}
            className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40"
          >
            {t("chat.toolApproval.approveAll")}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void guarded(() => props.onDecideAll("deny"))}
            className="rounded-lg bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-600 disabled:opacity-40"
          >
            {t("chat.toolApproval.denyAll")}
          </button>
        </div>
      ) : null}
      <ul className="mt-2 space-y-1.5">
        {props.pending.map((item) => (
          <li key={item.toolCallId} className="rounded-xl border border-border/60 bg-muted/25 p-2">
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                {item.toolName}
              </code>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void guarded(() => props.onDecide(item.toolCallId, "approve"))}
                className="rounded-md px-1.5 py-1 text-[10px] text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                {t("chat.toolApproval.approve")}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void guarded(() => props.onDecide(item.toolCallId, "approve_session"))
                }
                className="rounded-md px-1.5 py-1 text-[10px] text-foreground/70 hover:bg-muted disabled:opacity-40"
              >
                {t("chat.toolApproval.approveSession")}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void guarded(() => props.onDecide(item.toolCallId, "deny"))}
                className="rounded-md px-1.5 py-1 text-[10px] text-red-600 hover:bg-red-500/10 disabled:opacity-40"
              >
                {t("chat.toolApproval.deny")}
              </button>
            </div>
            {item.summary ? (
              <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-foreground/[0.04] p-2 font-mono text-[10px] leading-4 text-foreground/70">
                {item.summary}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-[11px] text-red-500">{error}</p> : null}
    </section>
  );
}
