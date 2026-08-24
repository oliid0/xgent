import type { Context } from "@earendil-works/pi-ai";
import { type ModelOption, toModelValue } from "../../providers/llm";
import type { AppSettings } from "../../settings";
import { createUuid } from "../../shared/id";
import type { Locale } from "../../../i18n/config";
import type { ChatHistorySummary } from "../history/chatHistory";
import { getMessageText } from "../messages/uiMessages";

const FALLBACK_TITLE_MAX_CHARS = 48;
const TITLE_LOOKAHEAD_TIMEOUT_MS = 1_200;
const TITLE_MAX_CJK_CHARS = 24;
const CJK_CHAR_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g;
const MODEL_GENERATING_STATUS_PATTERN = /^第\s*\d+\s*轮：模型生成中\.\.\.$/;

export const VIBING_STATUS = "Vibing...";

// Must match BRANCH_DEFAULT_TITLE in src-tauri/src/commands/history/chat_history/branch.rs.
export const BRANCH_CONVERSATION_DEFAULT_TITLE = "新分支";

export type ModelOptionGroup = {
  id: string;
  name: string;
  providerType: ModelOption["providerType"];
  opts: ModelOption[];
};

export function groupModelOptionsByProvider(modelOptions: readonly ModelOption[]) {
  const groups: ModelOptionGroup[] = [];
  const groupMap = new Map<string, ModelOptionGroup>();
  for (const option of modelOptions) {
    const existing = groupMap.get(option.providerId);
    if (existing) {
      existing.opts.push(option);
      continue;
    }
    const group: ModelOptionGroup = {
      id: option.providerId,
      name: option.providerName,
      providerType: option.providerType,
      opts: [option],
    };
    groupMap.set(option.providerId, group);
    groups.push(group);
  }
  return groups;
}

export function buildModelOptions(
  settings: AppSettings,
  opts?: { floatSelectedFirst?: boolean },
): ModelOption[] {
  const options: ModelOption[] = [];
  for (const provider of settings.customProviders) {
    for (const model of provider.activeModels) {
      options.push({
        providerType: provider.type,
        providerId: provider.id,
        providerName: provider.name,
        model,
        value: toModelValue(provider.id, model),
        label: model,
      });
    }
  }
  if (!settings.selectedModel || opts?.floatSelectedFirst === false) return options;

  const selectedValue = toModelValue(
    settings.selectedModel.customProviderId,
    settings.selectedModel.model,
  );
  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  if (selectedIndex <= 0) return options;

  const [selectedOption] = options.splice(selectedIndex, 1);
  options.unshift(selectedOption);
  return options;
}

export function buildConversationTitleSystemPrompt(locale: Locale) {
  if (locale === "zh-CN") {
    return "你负责生成简洁的会话标题。只输出标题本身，不要解释、不要引号。标题必须使用简体中文；专有名词（如 Grok、API）可保留原文。";
  }
  return "You generate concise conversation titles. Output the title only, with no extra explanation or quotes.";
}

export function buildConversationTitlePrompt(content: string, locale: Locale) {
  if (locale === "zh-CN") {
    return `根据以下内容，为本次会话生成一个简练的简体中文标题（约 8～18 个字，概括主题，不要照抄整句问话），直接输出标题，不要其他内容：\n${content}`;
  }
  return `Based on the following content, generate a title within 10 words for this conversation and output it directly without any other content:\n${content}`;
}

export function normalizeConversationTitle(raw: string) {
  const singleLine = raw
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[`"'""‘’]+|[`"'""‘’]+$/g, "")
    .trim();

  if (!singleLine) return "";

  const words = singleLine.split(" ").filter(Boolean);
  const limitedWords = words.length > 10 ? words.slice(0, 10).join(" ") : singleLine;
  return limitedWords.slice(0, 80).trim();
}

export function normalizeGeneratedConversationTitle(raw: string) {
  const title = normalizeConversationTitle(raw);
  if (!title) return "";
  const chars = Array.from(title);
  const cjkCount = title.match(CJK_CHAR_PATTERN)?.length ?? 0;
  if (cjkCount * 2 < chars.length) return title;
  return chars.length > TITLE_MAX_CJK_CHARS
    ? chars.slice(0, TITLE_MAX_CJK_CHARS).join("").trim()
    : title;
}

export function buildFallbackConversationTitle(content: string) {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (!singleLine) return "新对话";
  if (singleLine.length <= FALLBACK_TITLE_MAX_CHARS) return singleLine;
  return `${singleLine.slice(0, FALLBACK_TITLE_MAX_CHARS).trimEnd()}...`;
}

export function normalizeLiveToolStatus(status: string | null) {
  if (status && MODEL_GENERATING_STATUS_PATTERN.test(status)) return VIBING_STATUS;
  return status;
}

export function getFirstUserMessageText(context: Context) {
  for (const message of context.messages) {
    if (message.role !== "user") continue;
    const text = getMessageText(message).trim();
    if (text) return text;
  }
  return "";
}

export function waitForTitleLookahead<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), TITLE_LOOKAHEAD_TIMEOUT_MS);
    }),
  ]);
}

export function isAbortLikeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("已取消") || normalized.includes("abort") || normalized.includes("aborted")
  );
}

export function createPendingHistoryItem(params: {
  conversationId: string;
  // The localized pending title (t("chat.pendingTitle")) — callers own i18n.
  title: string;
  providerId: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  createdAt: number;
  updatedAt?: number;
}) {
  const {
    conversationId,
    title,
    providerId,
    model,
    sessionId,
    cwd,
    createdAt,
    updatedAt = Date.now(),
  } = params;
  return {
    id: conversationId,
    title,
    providerId,
    model,
    sessionId,
    cwd,
    createdAt,
    updatedAt,
    isPending: true,
  } satisfies ChatHistorySummary;
}

export function createConversationIdentity() {
  const conversationId = createUuid();
  return {
    conversationId,
    sessionId: conversationId,
    createdAt: Date.now(),
  };
}
