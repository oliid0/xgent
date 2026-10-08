import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { useEffect, useMemo, useRef, useState } from "react";

import { useLocale } from "../../i18n";
import {
  ASK_USER_QUESTION_CUSTOM_MAX_LENGTH,
  ASK_USER_QUESTION_TIMEOUT_MS,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
} from "../../lib/chat/askUserQuestion";
import { ChevronLeft, ChevronRight, Sparkles, X } from "../icons";

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
  onCancel,
}: {
  questions: AskUserQuestionItem[];
  answers?: AskUserQuestionAnswer[];
  cancelled?: boolean;
  timedOut?: boolean;
  interactive: boolean;
  deadlineAt?: number;
  onSubmit?: (answers: AskUserQuestionAnswer[]) => Promise<SubmitOutcome>;
  onCancel?: () => Promise<SubmitOutcome>;
}) {
  const { t } = useLocale();
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resolution, setResolution] = useState<{
    answers?: AskUserQuestionAnswer[];
    cancelled?: boolean;
  }>();
  const request = useRef({ active: true, busy: false, resolved: false, index: 0, deadlineAt: 0 });
  useEffect(() => {
    request.current.active = true;
    return () => {
      request.current.active = false;
    };
  }, []);
  const [fallbackDeadline] = useState(() => Date.now() + ASK_USER_QUESTION_TIMEOUT_MS);
  const effectiveDeadline = deadlineAt ?? fallbackDeadline;
  request.current.deadlineAt = effectiveDeadline;
  const [remaining, setRemaining] = useState(() => effectiveDeadline - Date.now());

  const settled = useMemo(
    () =>
      new Map(
        (answers ?? resolution?.answers ?? []).map((answer) => [
          answer.questionId,
          {
            kind: answer.custom ? ("custom" as const) : ("option" as const),
            value: answer.selectedLabel,
          },
        ]),
      ),
    [answers, resolution],
  );

  useEffect(() => {
    if (!interactive || settled.size > 0 || cancelled || timedOut || resolution?.cancelled) return;
    const update = () => setRemaining(effectiveDeadline - Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cancelled, effectiveDeadline, interactive, settled.size, timedOut, resolution?.cancelled]);

  if (questions.length === 0) return null;
  const currentIndex = Math.min(activeIndex, questions.length - 1);
  request.current.index = currentIndex;
  const current = questions[currentIndex];
  const isCancelled = cancelled || resolution?.cancelled === true;
  const isSettled = settled.size > 0 || isCancelled || timedOut;
  const selected = isSettled ? settled.get(current.id) : drafts[current.id];
  const canInteract = interactive && !isSettled && remaining > 0 && !submitting;
  const answeredCount = questions.filter((question) => {
    const answer = isSettled ? settled.get(question.id) : drafts[question.id];
    return Boolean(answer?.value.trim());
  }).length;
  const allAnswered = answeredCount === questions.length;
  const editable = () =>
    canInteract &&
    request.current.active &&
    !request.current.busy &&
    !request.current.resolved &&
    request.current.index === currentIndex &&
    request.current.deadlineAt > Date.now();

  const choose = (answer: DraftAnswer) => {
    if (!editable()) return;
    setError("");
    setDrafts((currentDrafts) => ({ ...currentDrafts, [current.id]: answer }));
  };

  const submit = async () => {
    if (!editable() || !allAnswered || !onSubmit) return;
    const payload = questions.map((question) => {
      const answer = drafts[question.id];
      return {
        questionId: question.id,
        prompt: question.prompt,
        selectedLabel: answer?.value.trim() ?? "",
        ...(answer?.kind === "custom" ? { custom: true } : {}),
      };
    });
    request.current.busy = true;
    setSubmitting(true);
    setError("");
    try {
      const outcome = await onSubmit(payload);
      if (!request.current.active) return;
      if (outcome.ok) {
        request.current.resolved = true;
        setResolution({ answers: payload });
      } else setError(outcome.message || t("chat.askUser.submitFailed"));
    } catch (submitError) {
      if (request.current.active)
        setError(
          submitError instanceof Error ? submitError.message : t("chat.askUser.submitFailed"),
        );
    } finally {
      request.current.busy = false;
      if (request.current.active) setSubmitting(false);
    }
  };

  const dismiss = async () => {
    if (!editable() || !onCancel) return;
    request.current.busy = true;
    setSubmitting(true);
    setError("");
    try {
      const outcome = await onCancel();
      if (!request.current.active) return;
      if (outcome.ok) {
        request.current.resolved = true;
        setResolution({ cancelled: true });
      } else setError(outcome.message || t("chat.askUser.submitFailed"));
    } catch (cause) {
      if (request.current.active)
        setError(cause instanceof Error ? cause.message : t("chat.askUser.submitFailed"));
    } finally {
      request.current.busy = false;
      if (request.current.active) setSubmitting(false);
    }
  };

  const radioValue = selected?.kind === "option" ? `option:${selected.value}` : "";

  return (
    <Card padding={0} elevation="low" className="tool-expand">
      <VStack gap={0}>
        <VStack gap={2} padding={3}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <Text type="body" weight="medium" wordBreak="break-word">
                {current.prompt}
              </Text>
            </StackItem>
            <HStack gap={0} vAlign="center">
              {questions.length > 1 ? (
                <>
                  <IconButton
                    label={t("chat.askUser.previous")}
                    tooltip={t("chat.askUser.previous")}
                    icon={<Icon icon={ChevronLeft} />}
                    variant="ghost"
                    size="sm"
                    isDisabled={currentIndex === 0 || submitting}
                    onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
                  />
                  <Text type="supporting" color="secondary" hasTabularNumbers>
                    {currentIndex + 1}/{questions.length}
                  </Text>
                  <IconButton
                    label={t("chat.askUser.next")}
                    tooltip={t("chat.askUser.next")}
                    icon={<Icon icon={ChevronRight} />}
                    variant="ghost"
                    size="sm"
                    isDisabled={currentIndex === questions.length - 1 || submitting}
                    onClick={() =>
                      setActiveIndex((index) => Math.min(questions.length - 1, index + 1))
                    }
                  />
                </>
              ) : null}
              {!isSettled ? (
                <IconButton
                  label={t("chat.askUser.close")}
                  tooltip={t("chat.askUser.close")}
                  icon={<Icon icon={X} />}
                  variant="ghost"
                  size="sm"
                  isDisabled={!canInteract || !onCancel}
                  onClick={() => void dismiss()}
                />
              ) : null}
            </HStack>
          </HStack>
          <RadioList
            label={current.prompt}
            isLabelHidden
            value={radioValue}
            width="100%"
            isDisabled={!canInteract}
            onChange={(value) => {
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
          </RadioList>

          {!isSettled ? (
            <TextInput
              label={t("chat.askUser.other")}
              isLabelHidden
              isDisabled={!canInteract}
              value={selected?.kind === "custom" ? selected.value : ""}
              placeholder={t("chat.askUser.otherPlaceholder")}
              width="100%"
              onChange={(value) =>
                choose({
                  kind: "custom",
                  value: value.slice(0, ASK_USER_QUESTION_CUSTOM_MAX_LENGTH),
                })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && allAnswered)
                  void submit();
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
                {isCancelled
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
                label={t("chat.askUser.skip")}
                variant="ghost"
                size="sm"
                isDisabled={!canInteract || !onCancel}
                onClick={() => void dismiss()}
              />
            ) : null}
            {!isSettled ? (
              <Button
                label={submitting ? t("chat.askUser.submitting") : t("chat.askUser.submit")}
                variant="primary"
                size="sm"
                isLoading={submitting}
                isDisabled={!canInteract || !allAnswered || !onSubmit}
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
