export const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";
export const ASK_USER_QUESTION_MAX_QUESTIONS = 4;
export const ASK_USER_QUESTION_MIN_OPTIONS = 2;
export const ASK_USER_QUESTION_MAX_OPTIONS = 6;
export const ASK_USER_QUESTION_TIMEOUT_MS = 3 * 60 * 1000;
export const ASK_USER_QUESTION_CUSTOM_MAX_LENGTH = 2000;
export const ASK_USER_QUESTION_DEADLINE_ARG = "__askUserQuestionDeadlineAt";

export type AskUserQuestionOption = {
  label: string;
  description?: string;
  recommended?: boolean;
};

export type AskUserQuestionItem = {
  id: string;
  header?: string;
  prompt: string;
  options: AskUserQuestionOption[];
};

export type AskUserQuestionAnswer = {
  questionId: string;
  prompt: string;
  selectedLabel: string;
  custom?: boolean;
};

export type AskUserQuestionResultDetails = {
  kind: "ask_user_question";
  questions: AskUserQuestionItem[];
  answers: AskUserQuestionAnswer[];
  cancelled?: boolean;
  timedOut?: boolean;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readAskUserQuestionDeadlineAt(args: unknown): number | null {
  if (!args || typeof args !== "object") return null;
  const value = (args as Record<string, unknown>)[ASK_USER_QUESTION_DEADLINE_ARG];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function orderOptions(options: AskUserQuestionOption[]) {
  const recommendedIndex = options.findIndex((option) => option.recommended === true);
  if (recommendedIndex <= 0) return options;
  return [
    options[recommendedIndex],
    ...options.slice(0, recommendedIndex),
    ...options.slice(recommendedIndex + 1),
  ];
}

export function sanitizeAskUserQuestionItems(raw: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(raw)) return [];
  const questions: AskUserQuestionItem[] = [];
  for (const [index, value] of raw.entries()) {
    if (questions.length >= ASK_USER_QUESTION_MAX_QUESTIONS) break;
    if (!value || typeof value !== "object") continue;
    const candidate = value as Record<string, unknown>;
    const prompt = normalizeText(candidate.prompt);
    if (!prompt || !Array.isArray(candidate.options)) continue;
    const options = candidate.options
      .flatMap((rawOption) => {
        if (!rawOption || typeof rawOption !== "object") return [];
        const option = rawOption as Record<string, unknown>;
        const label = normalizeText(option.label);
        if (!label) return [];
        return [
          {
            label,
            ...(normalizeText(option.description)
              ? { description: normalizeText(option.description) }
              : {}),
            ...(option.recommended === true ? { recommended: true } : {}),
          } satisfies AskUserQuestionOption,
        ];
      })
      .slice(0, ASK_USER_QUESTION_MAX_OPTIONS);
    if (options.length === 0) continue;
    questions.push({
      id: normalizeText(candidate.id) || `q${index + 1}`,
      ...(normalizeText(candidate.header) ? { header: normalizeText(candidate.header) } : {}),
      prompt,
      options: orderOptions(options),
    });
  }
  return questions;
}

export function parseAskUserQuestionItems(raw: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("AskUserQuestion requires a non-empty `questions` array.");
  }
  if (raw.length > ASK_USER_QUESTION_MAX_QUESTIONS) {
    throw new Error(
      `AskUserQuestion supports at most ${ASK_USER_QUESTION_MAX_QUESTIONS} questions per call; got ${raw.length}.`,
    );
  }

  const questionIds = new Set<string>();
  return raw.map((value, questionIndex) => {
    if (!value || typeof value !== "object") {
      throw new Error(`AskUserQuestion questions[${questionIndex}] must be an object.`);
    }
    const candidate = value as Record<string, unknown>;
    const prompt = normalizeText(candidate.prompt);
    if (!prompt) {
      throw new Error(
        `AskUserQuestion questions[${questionIndex}].prompt must be a non-empty string.`,
      );
    }
    if (!Array.isArray(candidate.options)) {
      throw new Error(`AskUserQuestion questions[${questionIndex}].options must be an array.`);
    }
    if (
      candidate.options.length < ASK_USER_QUESTION_MIN_OPTIONS ||
      candidate.options.length > ASK_USER_QUESTION_MAX_OPTIONS
    ) {
      throw new Error(
        `AskUserQuestion questions[${questionIndex}] needs ${ASK_USER_QUESTION_MIN_OPTIONS}-${ASK_USER_QUESTION_MAX_OPTIONS} options; got ${candidate.options.length}.`,
      );
    }
    const labels = new Set<string>();
    let recommendedCount = 0;
    const options = candidate.options.map((value, optionIndex) => {
      if (!value || typeof value !== "object") {
        throw new Error(
          `AskUserQuestion questions[${questionIndex}].options[${optionIndex}] must be an object.`,
        );
      }
      const option = value as Record<string, unknown>;
      const label = normalizeText(option.label);
      if (!label) {
        throw new Error(
          `AskUserQuestion questions[${questionIndex}].options[${optionIndex}].label must be a non-empty string.`,
        );
      }
      if (labels.has(label)) {
        throw new Error(
          `AskUserQuestion questions[${questionIndex}] has duplicate option label: ${label}.`,
        );
      }
      labels.add(label);
      const recommended = option.recommended === true;
      if (recommended) recommendedCount += 1;
      return {
        label,
        ...(normalizeText(option.description)
          ? { description: normalizeText(option.description) }
          : {}),
        ...(recommended ? { recommended: true } : {}),
      } satisfies AskUserQuestionOption;
    });
    if (recommendedCount > 1) {
      throw new Error(
        `AskUserQuestion questions[${questionIndex}] may mark at most one option as recommended; got ${recommendedCount}.`,
      );
    }

    const id = normalizeText(candidate.id) || `q${questionIndex + 1}`;
    if (questionIds.has(id)) {
      throw new Error(`AskUserQuestion has duplicate question id: ${id}.`);
    }
    questionIds.add(id);
    return {
      id,
      ...(normalizeText(candidate.header) ? { header: normalizeText(candidate.header) } : {}),
      prompt,
      options: orderOptions(options),
    };
  });
}

export function buildDefaultAskUserQuestionAnswers(
  questions: AskUserQuestionItem[],
): AskUserQuestionAnswer[] {
  return questions.map((question) => {
    const selected =
      question.options.find((option) => option.recommended === true) ?? question.options[0];
    return {
      questionId: question.id,
      prompt: question.prompt,
      selectedLabel: selected?.label ?? "",
    };
  });
}

export function resolveAskUserQuestionAnswers(
  questions: AskUserQuestionItem[],
  raw: unknown,
): AskUserQuestionAnswer[] | null {
  if (!Array.isArray(raw)) return null;
  const byQuestionId = new Map<string, { selectedLabel: string; custom: boolean }>();
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Record<string, unknown>;
    const questionId = normalizeText(candidate.questionId);
    const custom = candidate.custom === true;
    const selectedLabel =
      candidate.custom === true
        ? normalizeText(candidate.selectedLabel).slice(0, ASK_USER_QUESTION_CUSTOM_MAX_LENGTH)
        : normalizeText(candidate.selectedLabel);
    if (questionId && selectedLabel) {
      byQuestionId.set(questionId, { selectedLabel, custom });
    }
  }

  const answers: AskUserQuestionAnswer[] = [];
  for (const question of questions) {
    const selected = byQuestionId.get(question.id);
    if (!selected) return null;
    if (
      !selected.custom &&
      !question.options.some((option) => option.label === selected.selectedLabel)
    ) {
      return null;
    }
    answers.push({
      questionId: question.id,
      prompt: question.prompt,
      selectedLabel: selected.selectedLabel,
      ...(selected.custom ? { custom: true } : {}),
    });
  }
  return answers;
}

export function parseAskUserQuestionResultDetails(
  details: unknown,
): AskUserQuestionResultDetails | null {
  if (!details || typeof details !== "object") return null;
  const record = details as Record<string, unknown>;
  if (record.kind !== "ask_user_question") return null;
  const questions = sanitizeAskUserQuestionItems(record.questions);
  const answers: AskUserQuestionAnswer[] = [];
  if (Array.isArray(record.answers)) {
    for (const value of record.answers) {
      if (!value || typeof value !== "object") continue;
      const answerRecord = value as Record<string, unknown>;
      const questionId = normalizeText(answerRecord.questionId);
      const selectedLabel = normalizeText(answerRecord.selectedLabel);
      if (!questionId || !selectedLabel) continue;
      answers.push({
        questionId,
        prompt: normalizeText(answerRecord.prompt),
        selectedLabel,
        ...(answerRecord.custom === true ? { custom: true } : {}),
      });
    }
  }
  return {
    kind: "ask_user_question",
    questions,
    answers,
    cancelled: record.cancelled === true,
    timedOut: record.timedOut === true,
  };
}

export function buildAskUserQuestionResultText(
  answers: AskUserQuestionAnswer[],
  options?: { timedOut?: boolean },
) {
  const heading = options?.timedOut
    ? "The user did not answer within the time limit; the recommended (or first) option was auto-selected for every question. Proceed accordingly:"
    : "The user answered every question. Their selections are final — proceed accordingly:";
  return [
    heading,
    ...answers.map(
      (answer, index) =>
        `${index + 1}. ${answer.prompt}\n   → ${answer.selectedLabel}${
          answer.custom ? ' (user-typed answer via "Other", not a listed option)' : ""
        }`,
    ),
  ].join("\n");
}
