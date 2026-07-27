import type { ToolCall } from "@earendil-works/pi-ai";

import {
  countTextLines,
  FILE_TOOL_TEXT_FIELDS,
  LIVE_TOOL_PREVIEW_META_KEY,
  type PreviewFieldMetrics,
  type StreamPreviewMeta,
} from "../../../lib/chat/messages/toolPreview";

const TOOL_TEXT_PREVIEW_MAX_CHARS = 4000;

function buildHeadTailPreview(input: string, maxChars = TOOL_TEXT_PREVIEW_MAX_CHARS) {
  if (input.length <= maxChars) {
    return {
      text: input,
      metrics: {
        chars: input.length,
        lines: countTextLines(input),
        truncated: false,
      } satisfies PreviewFieldMetrics,
    };
  }

  const omittedChars = Math.max(0, input.length - maxChars);
  const marker = `\n...[truncated ${omittedChars} chars]...\n`;
  const budget = Math.max(0, maxChars - marker.length);
  const headChars = Math.max(0, Math.floor(budget * 0.68));
  const tailChars = Math.max(0, budget - headChars);
  const text =
    budget > 0
      ? `${input.slice(0, headChars)}${marker}${tailChars > 0 ? input.slice(-tailChars) : ""}`
      : input.slice(0, maxChars);

  return {
    text,
    metrics: {
      chars: input.length,
      lines: countTextLines(input),
      truncated: true,
    } satisfies PreviewFieldMetrics,
  };
}

// All remote representations of a file tool's streaming arguments use this
// canonical preview shape and monotonic progress value.
export function buildToolCallPreviewArguments(toolCall: Pick<ToolCall, "name" | "arguments">) {
  const fieldsToPreview = FILE_TOOL_TEXT_FIELDS[toolCall.name];
  const sourceArgs = toolCall.arguments || {};
  if (!fieldsToPreview) {
    return sourceArgs;
  }

  const args: Record<string, unknown> = { ...sourceArgs };
  const fields: Record<string, PreviewFieldMetrics> = {};
  let progress = 0;

  for (const field of fieldsToPreview) {
    const value = args[field];
    if (typeof value !== "string") continue;
    const preview = buildHeadTailPreview(value);
    args[field] = preview.text;
    fields[field] = preview.metrics;
    progress += preview.metrics.chars;
  }

  if (Object.keys(fields).length > 0) {
    args[LIVE_TOOL_PREVIEW_META_KEY] = { v: 2, progress, fields } satisfies StreamPreviewMeta;
  }

  return args;
}
