import { useEffect, useState } from "react";
import type { ActivityItem } from "../lib/chat/activityTimeline";
import {
  ASK_USER_QUESTION_CUSTOM_MAX_LENGTH,
  ASK_USER_QUESTION_TOOL_NAME,
  type AskUserQuestionAnswer,
  parseAskUserQuestionResultDetails,
  sanitizeAskUserQuestionItems,
} from "../lib/chat/askUserQuestion";
import {
  answerAskUserQuestion,
  getAskUserQuestionDeadlineAt,
  hasPendingAskUserQuestion,
} from "../lib/tools/askUserQuestionTools";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

type Draft = { value: string; custom: boolean };
type Form = {
  signature: string;
  index: number;
  drafts: Map<string, Draft>;
  accepted: boolean;
  error: string;
};

/** Native controls settle the same pending tool as the Astryx question card. */
export function useNativeAskUserQuestions(
  conversationId: string,
  items: readonly ActivityItem[],
  t: (key: string) => string,
) {
  const [, redraw] = useState(0);
  const [scope] = useState(() => ({
    conversationId,
    items,
    active: true,
    revision: 0,
    forms: new Map<string, Form>(),
  }));
  if (scope.conversationId !== conversationId) {
    scope.conversationId = conversationId;
    scope.revision++;
    scope.forms.clear();
  }
  scope.items = items;
  const visible = new Set(items.map((item) => item.toolCall.id));
  for (const id of scope.forms.keys()) if (!visible.has(id)) scope.forms.delete(id);
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.revision++;
    };
  }, [scope]);
  const pendingKey = items
    .filter(
      (item) =>
        item.toolCall.name === ASK_USER_QUESTION_TOOL_NAME && item.running && !item.toolResult,
    )
    .map((item) => item.toolCall.id)
    .join("\n");
  useEffect(() => {
    if (!pendingKey) return;
    const timer = setInterval(() => {
      if (scope.active) redraw((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [pendingKey, scope]);

  const c = presentationControls();
  const nodes = new Map<string, PresentationNode>();
  for (const item of items) {
    if (item.toolCall.name !== ASK_USER_QUESTION_TOOL_NAME) continue;
    const details = parseAskUserQuestionResultDetails(item.toolResult?.details);
    const questions =
      details?.questions ?? sanitizeAskUserQuestionItems(item.toolCall.arguments?.questions);
    if (!questions.length) continue;
    const signature = JSON.stringify(questions);
    let form = scope.forms.get(item.toolCall.id);
    if (!form || form.signature !== signature) {
      form = { signature, index: 0, drafts: new Map(), accepted: false, error: "" };
      scope.forms.set(item.toolCall.id, form);
    }
    const state = form;
    const revision = scope.revision;
    const prefix = `question:${conversationId}:${item.toolCall.id}`;
    const deadline = getAskUserQuestionDeadlineAt(item.toolCall.id);
    const settled = Boolean(item.toolResult || state.accepted);
    const available =
      item.running &&
      !settled &&
      deadline !== null &&
      deadline > Date.now() &&
      hasPendingAskUserQuestion(item.toolCall.id);
    const current = () =>
      scope.active &&
      scope.conversationId === conversationId &&
      scope.revision === revision &&
      scope.forms.get(item.toolCall.id) === state &&
      scope.items.some(
        (latest) =>
          latest.toolCall.id === item.toolCall.id &&
          latest.running &&
          !latest.toolResult &&
          JSON.stringify(sanitizeAskUserQuestionItems(latest.toolCall.arguments?.questions)) ===
            signature,
      );
    const editable = () =>
      current() &&
      !state.accepted &&
      hasPendingAskUserQuestion(item.toolCall.id) &&
      (getAskUserQuestionDeadlineAt(item.toolCall.id) ?? 0) > Date.now();
    const index = Math.min(state.index, questions.length - 1);
    const question = questions[index];
    const storedAnswer = details?.answers.find((answer) => answer.questionId === question.id);
    const selected = storedAnswer
      ? { value: storedAnswer.selectedLabel, custom: storedAnswer.custom === true }
      : state.drafts.get(question.id);
    const choose = (value: string, custom: boolean) => {
      if (!editable() || state.index !== index) throw new Error(t("chat.askUser.submitFailed"));
      state.error = "";
      state.drafts.set(question.id, { value, custom });
      redraw((value) => value + 1);
    };
    const answered = questions.filter((entry) =>
      Boolean(
        (
          details?.answers.find((answer) => answer.questionId === entry.id)?.selectedLabel ??
          state.drafts.get(entry.id)?.value
        )?.trim(),
      ),
    ).length;
    const children: PresentationNode[] = [];
    if (questions.length > 1) {
      children.push({
        ...c.select(
          `${prefix}:tabs`,
          t("chat.askUser.question"),
          String(index),
          questions.map((entry, entryIndex) => ({
            value: String(entryIndex),
            label: entry.header || `${t("chat.askUser.question")} ${entryIndex + 1}`,
          })),
          (value) => {
            if (
              !scope.active ||
              scope.revision !== revision ||
              scope.conversationId !== conversationId ||
              scope.forms.get(item.toolCall.id) !== state
            )
              return;
            state.index = Number(value);
            redraw((value) => value + 1);
          },
        ),
        kind: "SegmentedControl",
      });
    }
    children.push({ id: `${prefix}:prompt`, kind: "Text", text: question.prompt });
    const options = question.options.map(
      (option, optionIndex): PresentationNode => ({
        ...c.action(
          `${prefix}:option:${index}:${optionIndex}`,
          option.label,
          () => choose(option.label, false),
          available,
        ),
        variant: "question-option",
        text: option.description,
        selected: selected?.custom === false && selected.value === option.label,
        accessibilityLabel: option.recommended
          ? `${option.label} · ${t("chat.askUser.recommended")}`
          : option.label,
        children: option.recommended
          ? [
              {
                id: `${prefix}:option:${index}:${optionIndex}:recommended`,
                kind: "Badge",
                label: t("chat.askUser.recommended"),
              },
            ]
          : [],
      }),
    );
    options.push({
      ...c.action(
        `${prefix}:other:${index}`,
        t("chat.askUser.other"),
        () => {
          const draft = state.drafts.get(question.id);
          choose(draft?.custom ? draft.value : "", true);
        },
        available,
      ),
      variant: "question-option",
      selected: selected?.custom === true,
    });
    children.push({ id: `${prefix}:options`, kind: "VStack", spacing: 8, children: options });
    if (selected?.custom) {
      children.push(
        available
          ? {
              ...c.input(
                `${prefix}:custom:${index}`,
                t("chat.askUser.other"),
                selected.value,
                (value) => choose(value.slice(0, ASK_USER_QUESTION_CUSTOM_MAX_LENGTH), true),
                false,
                true,
                (value) => value.slice(0, ASK_USER_QUESTION_CUSTOM_MAX_LENGTH),
              ),
              text: t("chat.askUser.otherPlaceholder"),
            }
          : { id: `${prefix}:custom-answer`, kind: "Text", text: selected.value, secondary: true },
      );
    }
    const remaining = Math.max(0, Math.ceil(((deadline ?? Date.now()) - Date.now()) / 1000));
    const statusLabel = details?.cancelled
      ? t("chat.askUser.cancelled")
      : details?.timedOut
        ? t("chat.askUser.timedOut")
        : settled
          ? t("chat.askUser.answered")
          : `${answered}/${questions.length} · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
    const footer: PresentationNode[] = [
      { id: `${prefix}:status`, kind: "Text", text: statusLabel, secondary: true },
    ];
    if (!settled)
      footer.push({
        ...c.action(
          `${prefix}:submit`,
          t("chat.askUser.submit"),
          () => {
            if (!editable()) throw new Error(t("chat.askUser.submitFailed"));
            const answers: AskUserQuestionAnswer[] = questions.map((entry) => ({
              questionId: entry.id,
              prompt: entry.prompt,
              selectedLabel: state.drafts.get(entry.id)?.value.trim() ?? "",
              ...(state.drafts.get(entry.id)?.custom ? { custom: true } : {}),
            }));
            const outcome = answerAskUserQuestion(item.toolCall.id, answers, { conversationId });
            if (!outcome.ok) {
              state.error = outcome.message || t("chat.askUser.submitFailed");
              redraw((value) => value + 1);
              throw new Error(state.error);
            }
            state.accepted = true;
            state.error = "";
            redraw((value) => value + 1);
          },
          available && answered === questions.length,
        ),
        prominent: true,
      });
    children.push({
      id: `${prefix}:footer`,
      kind: "VStack",
      variant: "question-footer",
      children: footer,
    });
    if (state.error)
      children.push({ id: `${prefix}:error`, kind: "Banner", label: state.error, status: "error" });
    nodes.set(item.toolCall.id, { id: prefix, kind: "VStack", variant: "question-card", children });
  }
  return { nodes, handlers: c.handlers };
}
