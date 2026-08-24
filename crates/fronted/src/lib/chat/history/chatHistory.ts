import type { Message } from "@earendil-works/pi-ai";
import { invoke } from "@xagent/runtime";
import { parseTaskListState } from "../../tools/taskState";
import { normalizeConversationSystemPrompt } from "../context/systemPrompt";
import {
  type ConversationViewState,
  createTranscriptProjection,
  type HistoryMessageRef,
  normalizeConversationState,
  type StoredChatContextMeta,
  type StoredContextSegment,
  type StoredSummaryMessage,
  type TranscriptSegmentSlice,
} from "../conversation/conversationState";
import { parseHistorySegments, type SerializedHistorySegment } from "./chatHistoryParser";

export const CHAT_HISTORY_WINDOW_MESSAGES = 360;

export type ChatHistorySummary = {
  id: string;
  title: string;
  providerId: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  selectedModelJson?: string;
  messageCount?: number;
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
  pinnedAt?: number | null;
  isPending?: boolean;
};

export type ChatHistoryListPage = {
  items: ChatHistorySummary[];
  totalCount: number;
};

export type ChatHistoryListFilter = {
  cwd?: string;
  cwdEmpty?: boolean;
};

export type ChatHistoryWorkdirSummary = {
  path: string;
  conversationCount: number;
  updatedAt: number;
};

export type ChatHistoryWorkdirsResponse = {
  workdirs: ChatHistoryWorkdirSummary[];
};

export type ChatHistorySearchMatch = {
  source: string;
  conversationId: string;
  title: string;
  cwd?: string;
  segmentIndex: number;
  segmentId: string;
  messageIndex?: number;
  messageId?: string;
  role?: string;
  snippet: string;
  score: number;
  rawScore?: number;
  updatedAt: number;
};

type ChatHistorySegmentWireRecord = {
  segmentIndex: number;
  segmentId: string;
  summaryJson?: string | null;
  messagesJson: string;
  messageCount: number;
  startMessageId?: string;
  endMessageId?: string;
  createdAt: number;
  updatedAt: number;
};

type ChatHistoryAppendSegmentInput = {
  conversation: ChatHistoryConversationInput;
  previousSegment: ChatHistorySegmentWireRecord;
  segment: ChatHistorySegmentWireRecord;
};

type ChatHistoryWireRecord = ChatHistorySummary & {
  contextMetaJson: string;
  activeSegmentIndex: number;
  totalSegmentCount: number;
  totalMessageCount: number;
  segments: ChatHistorySegmentWireRecord[];
};

type ChatHistoryActiveSegmentWireRecord = ChatHistorySummary & {
  contextMetaJson: string;
  activeSegmentIndex: number;
  totalSegmentCount: number;
  totalMessageCount: number;
  activeSegment: ChatHistorySegmentWireRecord;
};

export type ChatHistoryRecord = ChatHistorySummary & {
  state: ConversationViewState;
};

export type ChatHistoryActiveSegmentRecord = ChatHistorySummary & {
  meta: StoredChatContextMeta;
  activeSegment: StoredContextSegment;
  revision: string;
};

type ChatHistorySegmentWindowWireRecord = {
  segmentIndex: number;
  segmentId: string;
  summaryJson?: string | null;
  messagesJson: string;
  startMessageIndex: number;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

type ActiveSegmentParserPayload = {
  kind: "active";
  record: Omit<ChatHistorySegmentWireRecord, "summaryJson" | "messagesJson">;
};

type WindowSegmentParserPayload = {
  kind: "window";
  record: Omit<ChatHistorySegmentWindowWireRecord, "summaryJson" | "messagesJson">;
};

type HistorySegmentParserPayload = ActiveSegmentParserPayload | WindowSegmentParserPayload;

type ChatHistoryWindowWireRecord = {
  conversation: ChatHistorySummary;
  segments: ChatHistorySegmentWindowWireRecord[];
  activeSegment: ChatHistorySegmentWireRecord | null;
  contextMetaJson: string;
  activeSegmentIndex: number;
  totalSegmentCount: number;
  totalMessageCount: number;
  returnedMessageCount: number;
  oldestOffset: number;
  hasMoreBefore: boolean;
  revision: string;
  updatedAt: number;
};

export type ChatHistoryWindowRecord = {
  conversation: ChatHistorySummary;
  meta: StoredChatContextMeta;
  segments: TranscriptSegmentSlice[];
  activeSegment?: StoredContextSegment;
  returnedMessageCount: number;
  oldestOffset: number;
  hasMoreBefore: boolean;
  revision: string;
  updatedAt: number;
};

export type ConversationPersistenceCursor = {
  activeSegmentIndex: number;
  activeSegmentId: string;
};

// Shared assembly for a full window record → runtime view state: the active
// segment becomes the (only) runtime segment, and the window's segment slices
// become the transcript projection used by open and edit-resend replacement.
export function buildConversationStateFromWindow(
  record: ChatHistoryWindowRecord,
): ConversationViewState {
  if (!record.activeSegment) throw new Error("历史窗口缺少活跃分段");
  return normalizeConversationState({
    meta: record.meta,
    segments: [record.activeSegment],
    transcript: createTranscriptProjection({
      segments: record.segments,
      activeSegmentIndex: record.meta.activeSegmentIndex,
      oldestMessageOffset: record.oldestOffset,
      hasMoreBefore: record.hasMoreBefore,
      revision: record.revision,
    }),
  });
}

export function buildChatHistoryRevision(params: {
  conversationId: string;
  updatedAt: number;
  activeSegmentIndex: number;
  totalSegmentCount: number;
  totalMessageCount: number;
}) {
  return `${params.conversationId.trim()}:${params.updatedAt}:${params.activeSegmentIndex}:${params.totalSegmentCount}:${params.totalMessageCount}`;
}

const conversationWriteQueues = new Map<string, Promise<void>>();

type ChatHistoryUpsertInput = {
  id: string;
  title: string;
  providerId: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  selectedModelJson?: string;
  contextMetaJson: string;
  activeSegmentIndex: number;
  totalSegmentCount: number;
  totalMessageCount: number;
  segments: ChatHistorySegmentWireRecord[];
  createdAt?: number;
  updatedAt: number;
};

type ChatHistoryConversationInput = Omit<ChatHistoryUpsertInput, "segments">;

type ChatHistorySegmentMutationInput = {
  conversation: ChatHistoryConversationInput;
  segment: ChatHistorySegmentWireRecord;
};

function isMessageArray(value: unknown): value is Message[] {
  return Array.isArray(value);
}

function normalizeStoredSummaryMessage(parsed: unknown): StoredSummaryMessage {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("role" in parsed) ||
    !("id" in parsed) ||
    !("content" in parsed) ||
    !("timestamp" in parsed) ||
    !("summaryMeta" in parsed) ||
    parsed.role !== "summary" ||
    typeof parsed.id !== "string" ||
    typeof parsed.content !== "string" ||
    typeof parsed.timestamp !== "number" ||
    !parsed.summaryMeta ||
    typeof parsed.summaryMeta !== "object"
  ) {
    throw new Error("历史摘要数据格式无效");
  }
  return parsed as StoredSummaryMessage;
}

function parseStoredChatContextMeta(
  raw: string,
  counts: Pick<
    StoredChatContextMeta,
    "activeSegmentIndex" | "totalSegmentCount" | "totalMessageCount"
  >,
  fallbackSystemPrompt?: string,
): StoredChatContextMeta {
  const parsed = JSON.parse(raw) as Partial<StoredChatContextMeta> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("历史上下文元数据格式无效");
  }

  const systemPrompt = normalizeConversationSystemPrompt(
    typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : fallbackSystemPrompt,
  );

  return {
    schemaVersion: 3,
    systemPrompt,
    tools: Array.isArray(parsed.tools) ? parsed.tools : undefined,
    activeSegmentIndex: counts.activeSegmentIndex,
    totalSegmentCount: counts.totalSegmentCount,
    totalMessageCount: counts.totalMessageCount,
    taskList: parseStoredTaskListState(parsed.taskList),
  };
}

function parseStoredTaskListState(value: unknown) {
  if (value === undefined) return undefined;
  try {
    return parseTaskListState(value);
  } catch (error) {
    console.warn("Ignoring invalid persisted task-list state", error);
    return undefined;
  }
}

function parseStoredSegment(record: ChatHistorySegmentWireRecord): StoredContextSegment {
  const parsedMessages = JSON.parse(record.messagesJson) as unknown;
  if (!isMessageArray(parsedMessages)) {
    throw new Error("历史分段消息格式无效");
  }

  return {
    segmentIndex: record.segmentIndex,
    segmentId: record.segmentId,
    summary: record.summaryJson
      ? normalizeStoredSummaryMessage(JSON.parse(record.summaryJson))
      : undefined,
    messages: parsedMessages,
    messageCount: record.messageCount,
    startMessageId: record.startMessageId,
    endMessageId: record.endMessageId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeWireRecord(
  record: ChatHistoryWireRecord,
  fallbackSystemPrompt?: string,
): ChatHistoryRecord {
  if (record.segments.length === 0) {
    throw new Error("历史对话缺少分段数据");
  }
  const meta = parseStoredChatContextMeta(record.contextMetaJson, record, fallbackSystemPrompt);
  const segments = record.segments.map(parseStoredSegment);
  const normalizedState = normalizeConversationState({ meta, segments });
  const state: ConversationViewState = {
    ...normalizedState,
    transcript: {
      ...normalizedState.transcript,
      revision: buildChatHistoryRevision({
        conversationId: record.id,
        updatedAt: record.updatedAt,
        activeSegmentIndex: meta.activeSegmentIndex,
        totalSegmentCount: meta.totalSegmentCount,
        totalMessageCount: meta.totalMessageCount,
      }),
    },
  };

  return {
    id: record.id,
    title: record.title,
    providerId: record.providerId,
    model: record.model,
    sessionId: record.sessionId,
    cwd: record.cwd,
    selectedModelJson: record.selectedModelJson,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isPinned: record.isPinned,
    pinnedAt: record.pinnedAt,
    state,
  };
}

export async function listChatHistory(
  page: number,
  pageSize: number,
  filter?: ChatHistoryListFilter,
) {
  return invoke<ChatHistoryListPage>("chat_history_list", {
    page,
    pageSize,
    cwd: filter?.cwd,
    cwdEmpty: filter?.cwdEmpty,
  });
}

export async function listChatHistoryWorkdirs() {
  return invoke<ChatHistoryWorkdirsResponse>("chat_history_workdirs");
}

export async function searchChatHistory(query: string, limit = 30) {
  const response = await invoke<{ matches: ChatHistorySearchMatch[] }>("chat_history_search", {
    args: { query, limit },
  });
  return response.matches;
}

export async function getChatHistory(id: string, fallbackSystemPrompt?: string) {
  const record = await invoke<ChatHistoryWireRecord>("chat_history_get", { id });
  return normalizeWireRecord(record, fallbackSystemPrompt);
}

export async function getChatHistoryActiveSegment(id: string, fallbackSystemPrompt?: string) {
  const record = await invoke<ChatHistoryActiveSegmentWireRecord>(
    "chat_history_get_active_segment",
    { id },
  );
  if (!record.activeSegment) {
    throw new Error("历史对话缺少活跃分段");
  }

  const meta = parseStoredChatContextMeta(record.contextMetaJson, record, fallbackSystemPrompt);
  return {
    id: record.id,
    title: record.title,
    providerId: record.providerId,
    model: record.model,
    sessionId: record.sessionId,
    cwd: record.cwd,
    selectedModelJson: record.selectedModelJson,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isPinned: record.isPinned,
    pinnedAt: record.pinnedAt,
    meta,
    activeSegment: parseStoredSegment(record.activeSegment),
    revision: buildChatHistoryRevision({
      conversationId: record.id,
      updatedAt: record.updatedAt,
      activeSegmentIndex: meta.activeSegmentIndex,
      totalSegmentCount: meta.totalSegmentCount,
      totalMessageCount: meta.totalMessageCount,
    }),
  } satisfies ChatHistoryActiveSegmentRecord;
}

async function parseChatHistoryWindowRecord(
  record: ChatHistoryWindowWireRecord,
  fallbackSystemPrompt?: string,
): Promise<ChatHistoryWindowRecord> {
  const activeSerialized: SerializedHistorySegment<HistorySegmentParserPayload>[] =
    record.activeSegment
      ? (() => {
          const { summaryJson, messagesJson, ...payload } = record.activeSegment;
          return [
            {
              payload: { kind: "active", record: payload },
              summaryJson,
              messagesJson,
            },
          ];
        })()
      : [];
  const serializedSegments: SerializedHistorySegment<HistorySegmentParserPayload>[] = [
    ...activeSerialized,
    ...record.segments.map(({ summaryJson, messagesJson, ...payload }) => ({
      payload: { kind: "window", record: payload } satisfies WindowSegmentParserPayload,
      summaryJson,
      messagesJson,
    })),
  ];
  const parsedSegments = await parseHistorySegments(serializedSegments);
  const activeSegment = parsedSegments.find((segment) => segment.payload.kind === "active");
  return {
    conversation: record.conversation,
    meta: parseStoredChatContextMeta(record.contextMetaJson, record, fallbackSystemPrompt),
    segments: parsedSegments.flatMap(({ payload, summary, messages }) =>
      payload.kind === "window"
        ? [
            {
              segmentIndex: payload.record.segmentIndex,
              segmentId: payload.record.segmentId,
              summary: summary ? normalizeStoredSummaryMessage(summary) : undefined,
              messages,
              startMessageIndex: payload.record.startMessageIndex,
              createdAt: payload.record.createdAt,
              updatedAt: payload.record.updatedAt,
            },
          ]
        : [],
    ),
    activeSegment:
      activeSegment?.payload.kind === "active"
        ? {
            ...activeSegment.payload.record,
            summary: activeSegment.summary
              ? normalizeStoredSummaryMessage(activeSegment.summary)
              : undefined,
            messages: activeSegment.messages,
          }
        : undefined,
    returnedMessageCount: record.returnedMessageCount,
    oldestOffset: record.oldestOffset,
    hasMoreBefore: record.hasMoreBefore,
    revision: record.revision,
    updatedAt: record.updatedAt,
  };
}

export async function getChatHistoryWindow(params: {
  id: string;
  maxMessages: number;
  beforeOffset?: number;
  expectedRevision?: string;
  includeActiveSegment: boolean;
  fallbackSystemPrompt?: string;
}) {
  const record = await invoke<ChatHistoryWindowWireRecord>("chat_history_get_window", {
    id: params.id,
    maxMessages: params.maxMessages,
    beforeOffset: params.beforeOffset,
    expectedRevision: params.expectedRevision,
    includeActiveSegment: params.includeActiveSegment,
  });
  return parseChatHistoryWindowRecord(record, params.fallbackSystemPrompt);
}

export async function replaceChatHistoryFromMessage(params: {
  id: string;
  baseMessageRef: HistoryMessageRef;
  replacementMessage: Message;
  maxMessages?: number;
  expectedRevision: string;
  fallbackSystemPrompt?: string;
}) {
  return withConversationWriteLock(params.id, async () => {
    const record = await invoke<ChatHistoryWindowWireRecord>("chat_history_replace_from_message", {
      id: params.id,
      baseMessageRef: params.baseMessageRef,
      replacementMessage: params.replacementMessage,
      maxMessages: params.maxMessages ?? CHAT_HISTORY_WINDOW_MESSAGES,
      expectedRevision: params.expectedRevision,
    });
    const parsed = await parseChatHistoryWindowRecord(record, params.fallbackSystemPrompt);
    if (!parsed.activeSegment) throw new Error("历史替换结果缺少活跃分段");
    return parsed;
  });
}

function withConversationWriteLock<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
  const key = conversationId.trim();
  if (!key) {
    return task();
  }

  const previous = conversationWriteQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  conversationWriteQueues.set(key, tail);
  return next.finally(() => {
    if (conversationWriteQueues.get(key) === tail) {
      conversationWriteQueues.delete(key);
    }
  });
}

function buildChatHistoryConversationInput(params: {
  conversationId: string;
  providerId: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  selectedModelJson?: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  state: ConversationViewState;
}): ChatHistoryConversationInput {
  const {
    conversationId,
    providerId,
    model,
    sessionId,
    cwd,
    selectedModelJson,
    title,
    createdAt,
    updatedAt,
    state,
  } = params;

  // Header totals must stay anchored on state.meta. After a conversation is
  // reopened from history, state.segments only holds the active segment while
  // meta.totalMessageCount still counts every sealed row in SQLite — summing
  // the in-memory segments would undercount and trip the backend segment-sum
  // consistency check on every persist.
  return {
    id: conversationId,
    title,
    providerId,
    model,
    sessionId,
    cwd,
    selectedModelJson,
    contextMetaJson: JSON.stringify(state.meta),
    activeSegmentIndex: state.meta.activeSegmentIndex,
    totalSegmentCount: state.meta.totalSegmentCount,
    totalMessageCount: state.meta.totalMessageCount,
    createdAt,
    updatedAt,
  };
}

function resolveSegmentMessageCount(segment: StoredContextSegment): number {
  // Live messages are the source of truth. Fall back to messageCount only when
  // the messages array is absent (defensive); an empty array means zero messages.
  if (Array.isArray(segment.messages)) {
    return segment.messages.length;
  }
  return typeof segment.messageCount === "number" ? segment.messageCount : 0;
}

function buildChatHistorySegmentInput(segment: StoredContextSegment): ChatHistorySegmentWireRecord {
  const messageCount = resolveSegmentMessageCount(segment);
  return {
    segmentIndex: segment.segmentIndex,
    segmentId: segment.segmentId,
    summaryJson: segment.summary ? JSON.stringify(segment.summary) : undefined,
    messagesJson: JSON.stringify(segment.messages ?? []),
    messageCount,
    startMessageId: segment.startMessageId,
    endMessageId: segment.endMessageId,
    createdAt: segment.createdAt,
    updatedAt: segment.updatedAt,
  };
}

// Raw IPC wrappers: callers must already hold the conversation write lock.
async function upsertChatHistoryRaw(input: ChatHistoryUpsertInput) {
  return invoke<ChatHistorySummary>("chat_history_upsert", { input });
}

async function upsertChatHistoryActiveSegmentRaw(input: ChatHistorySegmentMutationInput) {
  return invoke<ChatHistorySummary>("chat_history_upsert_active_segment", { input });
}

async function appendChatHistorySegmentRaw(input: ChatHistoryAppendSegmentInput) {
  return invoke<ChatHistorySummary>("chat_history_append_segment", { input });
}

export async function renameChatHistory(id: string, title: string) {
  return withConversationWriteLock(id, () =>
    invoke<ChatHistorySummary>("chat_history_rename", { id, title }),
  );
}

export async function branchChatHistory(id: string, baseMessageRef: HistoryMessageRef) {
  return withConversationWriteLock(id, () =>
    invoke<ChatHistorySummary>("chat_history_branch", { id, baseMessageRef }),
  );
}

export async function setChatHistoryPinned(id: string, isPinned: boolean) {
  return withConversationWriteLock(id, () =>
    invoke<ChatHistorySummary>("chat_history_set_pinned", { id, isPinned }),
  );
}

export async function setChatHistoryModel(id: string, selectedModelJson: string) {
  return withConversationWriteLock(id, () =>
    invoke<ChatHistorySummary>("chat_history_set_model", { id, selectedModelJson }),
  );
}

export async function setChatHistoryCwd(id: string, cwd: string) {
  return withConversationWriteLock(id, () =>
    invoke<ChatHistorySummary>("chat_history_set_cwd", { id, cwd }),
  );
}

export async function deleteChatHistory(id: string) {
  return withConversationWriteLock(id, async () => {
    await invoke<void>("chat_history_delete", { id });
    // 检查点数据(索引 + blobs)以会话为单位存放，没有独立的 GC。会话都删了
    // 还留着，单个会话最多能压着 512MB blob 永不回收。尽力而为：清理失败不能
    // 反过来让删除会话报错。
    try {
      await invoke<void>("checkpoint_clear", { conversation_id: id });
    } catch {
      // 忽略：残留的检查点目录不影响任何功能，只是占盘。
    }
  });
}

type PersistConversationRuntimeParams = {
  conversationId: string;
  providerId: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  selectedModelJson?: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  state: ConversationViewState;
  getPersistenceCursor: () => ConversationPersistenceCursor | null;
  commitPersistenceCursor: (cursor: ConversationPersistenceCursor) => void;
};

function findSegmentByIndex(
  state: ConversationViewState,
  segmentIndex: number,
): StoredContextSegment | undefined {
  return state.segments.find((segment) => segment.segmentIndex === segmentIndex);
}

function conversationInputForCursor(
  conversation: ChatHistoryConversationInput,
  state: ConversationViewState,
  activeSegmentIndex: number,
): ChatHistoryConversationInput {
  // Each intermediate append must advertise exactly the totals that exist
  // after that step lands: the backend append precondition requires
  // totalSegmentCount == stored count + 1, and the consistency check compares
  // the header against COUNT/SUM over all rows inside the same transaction.
  //
  // Subtract the not-yet-appended in-memory segments from the final header
  // total instead of re-summing in-memory segments from zero: after a
  // conversation is reopened from history, the sealed rows before the loaded
  // active segment exist only in SQLite.
  const pendingBeyondStep = state.segments
    .filter((segment) => segment.segmentIndex > activeSegmentIndex)
    .reduce((sum, segment) => sum + resolveSegmentMessageCount(segment), 0);
  const totalSegmentCount = activeSegmentIndex + 1;
  const totalMessageCount = Math.max(0, conversation.totalMessageCount - pendingBeyondStep);
  let contextMetaJson = conversation.contextMetaJson;
  try {
    const meta = JSON.parse(conversation.contextMetaJson) as Record<string, unknown>;
    contextMetaJson = JSON.stringify({
      ...meta,
      activeSegmentIndex,
      totalSegmentCount,
      totalMessageCount,
    });
  } catch {
    // Keep the original payload if meta is not JSON; header counts still win.
  }
  return {
    ...conversation,
    contextMetaJson,
    activeSegmentIndex,
    totalSegmentCount,
    totalMessageCount,
  };
}

async function writeConversationRuntime(
  conversation: ChatHistoryConversationInput,
  cursor: ConversationPersistenceCursor | null,
  state: ConversationViewState,
  commitPersistenceCursor: (cursor: ConversationPersistenceCursor) => void,
) {
  const activeSegment = getActiveSegment(state);
  if (!activeSegment) {
    throw new Error("无法持久化缺少活跃分段的会话");
  }

  if (!cursor) {
    if (state.segments[0]?.segmentIndex !== 0) {
      throw new Error("已存在的历史会话缺少持久化游标");
    }
    const summary = await upsertChatHistoryRaw({
      ...conversation,
      segments: state.segments.map(buildChatHistorySegmentInput),
    });
    commitPersistenceCursor({
      activeSegmentIndex: activeSegment.segmentIndex,
      activeSegmentId: activeSegment.segmentId,
    });
    return summary;
  }

  if (activeSegment.segmentIndex < cursor.activeSegmentIndex) {
    throw new Error(
      `不支持的历史分段回退：${cursor.activeSegmentIndex} -> ${activeSegment.segmentIndex}`,
    );
  }

  if (activeSegment.segmentIndex === cursor.activeSegmentIndex) {
    if (activeSegment.segmentId !== cursor.activeSegmentId) {
      throw new Error("活跃历史分段身份与持久化游标不一致");
    }
    const summary = await upsertChatHistoryActiveSegmentRaw({
      conversation,
      segment: buildChatHistorySegmentInput(activeSegment),
    });
    commitPersistenceCursor({
      activeSegmentIndex: activeSegment.segmentIndex,
      activeSegmentId: activeSegment.segmentId,
    });
    return summary;
  }

  // Catch up one segment at a time when the in-memory active segment jumped
  // ahead of the durable cursor (e.g. multiple compactions between persists).
  // Previously this threw "不支持的历史分段跳变" and left the DB on the
  // user-only snapshot after a long agent turn.
  let workingCursor: ConversationPersistenceCursor = { ...cursor };
  let summary: ChatHistorySummary | null = null;

  while (workingCursor.activeSegmentIndex < activeSegment.segmentIndex) {
    const previousSegment = findSegmentByIndex(state, workingCursor.activeSegmentIndex);
    const nextSegment = findSegmentByIndex(state, workingCursor.activeSegmentIndex + 1);
    if (!previousSegment) {
      throw new Error("追加历史分段时缺少待封存的上一活跃分段");
    }
    if (!nextSegment) {
      throw new Error(`追加历史分段时缺少目标分段：${workingCursor.activeSegmentIndex + 1}`);
    }
    if (previousSegment.segmentId !== workingCursor.activeSegmentId) {
      throw new Error("待封存历史分段身份与持久化游标不一致");
    }

    summary = await appendChatHistorySegmentRaw({
      conversation: conversationInputForCursor(conversation, state, nextSegment.segmentIndex),
      previousSegment: buildChatHistorySegmentInput(previousSegment),
      segment: buildChatHistorySegmentInput(nextSegment),
    });
    workingCursor = {
      activeSegmentIndex: nextSegment.segmentIndex,
      activeSegmentId: nextSegment.segmentId,
    };
    // Commit after every successful append so a later failure can resume from
    // the durable frontier instead of replaying a sealed segment.
    commitPersistenceCursor(workingCursor);
  }

  if (activeSegment.segmentId !== workingCursor.activeSegmentId) {
    throw new Error("活跃历史分段身份与持久化游标不一致");
  }
  if (!summary) {
    throw new Error(
      `不支持的历史分段跳变：${cursor.activeSegmentIndex} -> ${activeSegment.segmentIndex}`,
    );
  }
  return summary;
}

export async function persistConversationRuntime(params: PersistConversationRuntimeParams) {
  return withConversationWriteLock(params.conversationId, async () => {
    const conversation = buildChatHistoryConversationInput(params);
    return writeConversationRuntime(
      conversation,
      params.getPersistenceCursor(),
      params.state,
      params.commitPersistenceCursor,
    );
  });
}

function segmentPrefixMatches(
  previous: StoredContextSegment[],
  next: StoredContextSegment[],
  count: number,
) {
  if (count < 0 || previous.length < count || next.length < count) return false;
  for (let index = 0; index < count; index += 1) {
    const prevSegment = previous[index];
    const nextSegment = next[index];
    if (
      prevSegment.segmentIndex !== nextSegment.segmentIndex ||
      prevSegment.segmentId !== nextSegment.segmentId ||
      prevSegment.messageCount !== nextSegment.messageCount ||
      prevSegment.startMessageId !== nextSegment.startMessageId ||
      prevSegment.endMessageId !== nextSegment.endMessageId ||
      prevSegment.createdAt !== nextSegment.createdAt ||
      prevSegment.updatedAt !== nextSegment.updatedAt ||
      prevSegment.summary?.id !== nextSegment.summary?.id
    ) {
      return false;
    }
  }
  return true;
}

type PersistConversationStateParams = {
  conversationId: string;
  providerId: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  selectedModelJson?: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  state: ConversationViewState;
  getPreviousState: () => ConversationViewState | null;
  commitPersistedState: (state: ConversationViewState) => void;
};

async function writeConversationState(
  conversation: ChatHistoryConversationInput,
  previousState: ConversationViewState | null,
  nextState: ConversationViewState,
) {
  if (!previousState) {
    return upsertChatHistoryRaw({
      ...conversation,
      segments: nextState.segments.map(buildChatHistorySegmentInput),
    });
  }

  const sameShape =
    previousState.activeSegmentIndex === nextState.activeSegmentIndex &&
    previousState.segments.length === nextState.segments.length;
  if (
    sameShape &&
    segmentPrefixMatches(
      previousState.segments,
      nextState.segments,
      Math.max(0, nextState.activeSegmentIndex),
    )
  ) {
    const activeSegment = nextState.segments[nextState.activeSegmentIndex];
    if (activeSegment) {
      return upsertChatHistoryActiveSegmentRaw({
        conversation,
        segment: buildChatHistorySegmentInput(activeSegment),
      });
    }
  }

  const appendShape =
    nextState.activeSegmentIndex === previousState.activeSegmentIndex + 1 &&
    nextState.segments.length === previousState.segments.length + 1;
  if (
    appendShape &&
    segmentPrefixMatches(previousState.segments, nextState.segments, previousState.segments.length)
  ) {
    const previousSegment = previousState.segments[previousState.activeSegmentIndex];
    const appendedSegment = nextState.segments[nextState.activeSegmentIndex];
    if (previousSegment && appendedSegment) {
      return appendChatHistorySegmentRaw({
        conversation,
        previousSegment: buildChatHistorySegmentInput(previousSegment),
        segment: buildChatHistorySegmentInput(appendedSegment),
      });
    }
  }

  return upsertChatHistoryRaw({
    ...conversation,
    segments: nextState.segments.map(buildChatHistorySegmentInput),
  });
}

/** Compatibility persistence path for the current mobile/full-history baseline. */
export async function persistConversationState(params: PersistConversationStateParams) {
  return withConversationWriteLock(params.conversationId, async () => {
    const conversation = buildChatHistoryConversationInput(params);
    const summary = await writeConversationState(
      conversation,
      params.getPreviousState(),
      params.state,
    );
    params.commitPersistedState(params.state);
    return summary;
  });
}
