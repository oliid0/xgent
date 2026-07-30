import { useEffect, useMemo, useState } from "react";

import { useLocale } from "../../i18n";
import {
  ASK_USER_QUESTION_CUSTOM_MAX_LENGTH,
  ASK_USER_QUESTION_TIMEOUT_MS,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
} from "../../lib/chat/askUserQuestion";
import { cn } from "../../lib/shared/utils";
import { Check, Sparkles } from "../icons";

type SubmitOutcome = { ok: boolean; message?: string };
type DraftAnswer =
  | { kind: "option"; value: string }
  | { kind: "custom"; value: string };

function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AskUserQuestionCard({
  questions,
  answers,
  cancelled = false,
  timedOut = false,
  interactive,
  deadlineAt,
  onSubmit,
}: {
  questions: AskUserQuestionItem[];
  answers?: AskUserQuestionAnswer[];
  cancelled?: boolean;
  timedOut?: boolean;
  interactive: boolean;
  deadlineAt?: number;
  onSubmit?: (answers: AskUserQuestionAnswer[]) => Promise<SubmitOutcome>;
}) {
  const { t } = useLocale();
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fallbackDeadline] = useState(() => Date.now() + ASK_USER_QUESTION_TIMEOUT_MS);
  const effectiveDeadline = deadlineAt ?? fallbackDeadline;
  const [remaining, setRemaining] = useState(() => effectiveDeadline - Date.now());

  const settled = useMemo(
    () =>
      new Map(
        (answers ?? []).map((answer) => [
          answer.questionId,
          {
            kind: answer.custom ? ("custom" as const) : ("option" as const),
            value: answer.selectedLabel,
          },
        ]),
      ),
    [answers],
  );

  useEffect(() => {
    if (!interactive || settled.size > 0 || cancelled) return;
    const update = () => setRemaining(effectiveDeadline - Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cancelled, effectiveDeadline, interactive, settled.size]);

  if (questions.length === 0) return null;
  const currentIndex = Math.min(activeIndex, questions.length - 1);
  const current = questions[currentIndex];
  const isSettled = settled.size > 0 || cancelled;
  const selected = isSettled ? settled.get(current.id) : drafts[current.id];
  const canInteract = interactive && !isSettled && !submitting;
  const answeredCount = questions.filter((question) => {
    const answer = isSettled ? settled.get(question.id) : drafts[question.id];
    return Boolean(answer?.value.trim());
  }).length;
  const allAnswered = answeredCount === questions.length;

  const choose = (answer: DraftAnswer) => {
    if (!canInteract) return;
    setError("");
    setDrafts((currentDrafts) => ({ ...currentDrafts, [current.id]: answer }));
  };

  const submit = async () => {
    if (!canInteract || !allAnswered || !onSubmit) return;
    const payload = questions.map((question) => {
      const answer = drafts[question.id];
      return {
        questionId: question.id,
        prompt: question.prompt,
        selectedLabel: answer?.value.trim() ?? "",
        ...(answer?.kind === "custom" ? { custom: true } : {}),
      };
    });
    setSubmitting(true);
    setError("");
    try {
      const outcome = await onSubmit(payload);
      if (!outcome.ok) setError(outcome.message || t("chat.askUser.submitFailed"));
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : t("chat.askUser.submitFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="tool-expand overflow-hidden rounded-xl border border-border/50 bg-background/75 shadow-sm">
      {questions.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-border/40 p-1.5">
          {questions.map((question, index) => {
            const answer = isSettled ? settled.get(question.id) : drafts[question.id];
            return (
              <button
                key={question.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors",
                  index === currentIndex
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.04]",
                )}
              >
                {answer?.value.trim() ? <Check className="h-3 w-3 text-emerald-500" /> : null}
                {question.header || `${t("chat.askUser.question")} ${index + 1}`}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-3 p-3">
        <div className="text-sm font-medium leading-6 text-foreground/90">{current.prompt}</div>
        <div className="space-y-2" role="radiogroup" aria-label={current.prompt}>
          {current.options.map((option) => {
            const checked = selected?.kind === "option" && selected.value === option.label;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={!canInteract}
                onClick={() => choose({ kind: "option", value: option.label })}
                className={cn(
                  "flex min-h-11 w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  checked
                    ? "border-primary/50 bg-primary/[0.07]"
                    : "border-border/45 hover:border-border/80 hover:bg-foreground/[0.025]",
                  !canInteract && !checked ? "opacity-60" : "",
                )}
              >
                <span
                  className={cn(
                    "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    checked ? "border-primary bg-primary text-primary-foreground" : "",
                  )}
                >
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {option.label}
                    {option.recommended ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/[0.12] px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                        <Sparkles className="h-2.5 w-2.5" />
                        {t("chat.askUser.recommended")}
                      </span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}

          <div
            role="radio"
            aria-checked={selected?.kind === "custom"}
            tabIndex={canInteract ? 0 : -1}
            onClick={() => choose({ kind: "custom", value: selected?.value ?? "" })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                choose({ kind: "custom", value: selected?.value ?? "" });
              }
            }}
            className={cn(
              "flex min-h-11 w-full items-start gap-2.5 rounded-lg border px-3 py-2",
              selected?.kind === "custom"
                ? "border-primary/50 bg-primary/[0.07]"
                : "border-border/45",
              canInteract ? "cursor-pointer" : "opacity-60",
            )}
          >
            <span
              className={cn(
                "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                selected?.kind === "custom"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "",
              )}
            >
              {selected?.kind === "custom" ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-sm font-medium">{t("chat.askUser.other")}</span>
              {selected?.kind === "custom" && canInteract ? (
                <input
                  autoFocus
                  value={selected.value}
                  maxLength={ASK_USER_QUESTION_CUSTOM_MAX_LENGTH}
                  placeholder={t("chat.askUser.otherPlaceholder")}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    choose({ kind: "custom", value: event.currentTarget.value })
                  }
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter" && allAnswered) void submit();
                  }}
                  className="mt-2 h-9 w-full rounded-md border border-border/60 bg-background px-2.5 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
                />
              ) : selected?.kind === "custom" && selected.value ? (
                <span className="mt-1 block break-words text-xs text-muted-foreground">
                  {selected.value}
                </span>
              ) : null}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/35 pt-2.5">
          <span className="text-xs text-muted-foreground">
            {cancelled
              ? t("chat.askUser.cancelled")
              : timedOut
                ? t("chat.askUser.timedOut")
                : isSettled
                  ? t("chat.askUser.answered")
                  : `${answeredCount}/${questions.length} · ${formatRemaining(remaining)}`}
          </span>
          {!isSettled ? (
            <button
              type="button"
              disabled={!canInteract || !allAnswered}
              onClick={() => void submit()}
              className="min-h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
            >
              {submitting ? t("chat.askUser.submitting") : t("chat.askUser.submit")}
            </button>
          ) : null}
        </div>
        {error ? <div className="text-xs text-red-500">{error}</div> : null}
      </div>
    </div>
  );
}
