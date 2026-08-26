import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { useEffect, useMemo, useState } from "react";

import { useLocale } from "../../i18n";
import {
  ASK_USER_QUESTION_CUSTOM_MAX_LENGTH,
  ASK_USER_QUESTION_TIMEOUT_MS,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
} from "../../lib/chat/askUserQuestion";
import { Check, Sparkles } from "../icons";

type SubmitOutcome = { ok: boolean; message?: string };
type DraftAnswer = { kind: "option"; value: string } | { kind: "custom"; value: string };

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
      setError(submitError instanceof Error ? submitError.message : t("chat.askUser.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const radioValue =
    selected?.kind === "custom"
      ? "custom"
      : selected?.kind === "option"
        ? `option:${selected.value}`
        : "";

  return (
    <Card padding={0} elevation="low" className="tool-expand">
      <VStack gap={0}>
        {questions.length > 1 ? (
          <SegmentedControl
            label={t("chat.askUser.question")}
            value={String(currentIndex)}
            onChange={(value) => setActiveIndex(Number(value))}
            size="sm"
          >
            {questions.map((question, index) => {
              const answer = isSettled ? settled.get(question.id) : drafts[question.id];
              const label = question.header || `${t("chat.askUser.question")} ${index + 1}`;
              return (
                <SegmentedControlItem
                  key={question.id}
                  value={String(index)}
                  label={label}
                  icon={
                    answer?.value.trim() ? (
                      <Icon icon={Check} size="xsm" color="success" />
                    ) : undefined
                  }
                />
              );
            })}
          </SegmentedControl>
        ) : null}

        <VStack gap={3} padding={3}>
          <Text type="body" weight="medium">
            {current.prompt}
          </Text>
          <RadioList
            label={current.prompt}
            isLabelHidden
            value={radioValue}
            width="100%"
            isDisabled={!canInteract}
            onChange={(value) => {
              if (value === "custom") {
                choose({ kind: "custom", value: selected?.kind === "custom" ? selected.value : "" });
                return;
              }
              choose({ kind: "option", value: value.slice("option:".length) });
            }}
          >
            {current.options.map((option) => (
              <RadioListItem
                key={option.label}
                label={option.label}
                value={`option:${option.label}`}
                description={option.description}
                endContent={
                  option.recommended ? (
                    <Token
                      label={t("chat.askUser.recommended")}
                      size="sm"
                      color="orange"
                      icon={<Icon icon={Sparkles} size="xsm" color="inherit" />}
                    />
                  ) : undefined
                }
              />
            ))}
            <RadioListItem label={t("chat.askUser.other")} value="custom" />
          </RadioList>

          {selected?.kind === "custom" && canInteract ? (
            <TextInput
              hasAutoFocus
              label={t("chat.askUser.other")}
              value={selected.value}
              placeholder={t("chat.askUser.otherPlaceholder")}
              width="100%"
              onChange={(value) =>
                choose({ kind: "custom", value: value.slice(0, ASK_USER_QUESTION_CUSTOM_MAX_LENGTH) })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && allAnswered) void submit();
              }}
            />
          ) : selected?.kind === "custom" && selected.value ? (
            <Text type="supporting" color="secondary" wordBreak="break-word">
              {selected.value}
            </Text>
          ) : null}

          <HStack gap={2} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {cancelled
                  ? t("chat.askUser.cancelled")
                  : timedOut
                    ? t("chat.askUser.timedOut")
                    : isSettled
                      ? t("chat.askUser.answered")
                      : `${answeredCount}/${questions.length} · ${formatRemaining(remaining)}`}
              </Text>
            </StackItem>
            {!isSettled ? (
              <Button
                label={submitting ? t("chat.askUser.submitting") : t("chat.askUser.submit")}
                variant="primary"
                size="sm"
                isLoading={submitting}
                isDisabled={!canInteract || !allAnswered}
                onClick={() => void submit()}
              />
            ) : null}
          </HStack>
          {error ? <Banner status="error" title={error} collapsible={false} /> : null}
        </VStack>
      </VStack>
    </Card>
  );
}
