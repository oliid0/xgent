import type { Context, UserMessage } from "@earendil-works/pi-ai";

import {
  buildRequestContext,
  type ConversationViewState,
} from "../../../lib/chat/conversation/conversationState";
import { appendSystemPrompt } from "./chatPageRuntime";

export type ConversationContextBuildOptions = {
  includeAbortedMessages?: boolean;
  includeUploadedFilesMetadata?: boolean;
};

export type PreparedSystemPromptSlots = {
  base?: string;
  agent?: string;
  skills?: string;
  memory?: string;
  runtime?: string;
};

export function createPreparedSystemPromptSlotHolder(): {
  capture: (slots: PreparedSystemPromptSlots) => void;
  read: () => PreparedSystemPromptSlots;
} {
  let latest: PreparedSystemPromptSlots = {};
  return {
    capture: (slots) => {
      latest = slots;
    },
    read: () => latest,
  };
}

export function buildCompactionContext(
  state: ConversationViewState,
  tools?: Context["tools"],
  options?: ConversationContextBuildOptions,
): Context {
  const baseContext = buildRequestContext(state, options);
  return Array.isArray(tools) && tools.length > 0
    ? {
        ...baseContext,
        tools,
      }
    : baseContext;
}

export function buildPreparedContext(params: {
  state: ConversationViewState;
  tools?: Context["tools"];
  soulPrompt: string;
  skillsPrompt: string;
  memoryPrompt?: string;
  includeAbortedMessages?: boolean;
  includeUploadedFilesMetadata?: boolean;
  captureSlots?: (slots: PreparedSystemPromptSlots) => void;
}): Context {
  // AGENTS / Skills prompts are fixed runtime instructions and should not be
  // folded into compaction input or token accounting.
  const withTools = buildCompactionContext(params.state, params.tools, {
    includeAbortedMessages: params.includeAbortedMessages,
    includeUploadedFilesMetadata: params.includeUploadedFilesMetadata,
  });

  params.captureSlots?.({
    ...(typeof withTools.systemPrompt === "string" ? { base: withTools.systemPrompt } : {}),
    ...(params.soulPrompt ? { agent: params.soulPrompt } : {}),
    ...(params.skillsPrompt ? { skills: params.skillsPrompt } : {}),
    ...(params.memoryPrompt ? { memory: params.memoryPrompt } : {}),
  });

  let systemPrompt = withTools.systemPrompt;
  if (params.soulPrompt) {
    systemPrompt = appendSystemPrompt(systemPrompt, params.soulPrompt);
  }
  if (params.skillsPrompt) {
    systemPrompt = appendSystemPrompt(systemPrompt, params.skillsPrompt);
  }
  if (params.memoryPrompt) {
    systemPrompt = appendSystemPrompt(systemPrompt, params.memoryPrompt);
  }

  return typeof systemPrompt === "string"
    ? {
        ...withTools,
        systemPrompt,
      }
    : withTools;
}

export function buildResumeContext(params: {
  state: ConversationViewState;
  resumeMessage?: UserMessage;
  tools?: Context["tools"];
  soulPrompt: string;
  skillsPrompt: string;
  memoryPrompt?: string;
  includeAbortedMessages?: boolean;
  includeUploadedFilesMetadata?: boolean;
  captureSlots?: (slots: PreparedSystemPromptSlots) => void;
}): Context {
  const baseContext = buildPreparedContext({
    ...params,
    includeAbortedMessages: params.includeAbortedMessages,
  });
  if (!params.resumeMessage) {
    return baseContext;
  }
  return {
    ...baseContext,
    messages: [...baseContext.messages, params.resumeMessage],
  };
}
