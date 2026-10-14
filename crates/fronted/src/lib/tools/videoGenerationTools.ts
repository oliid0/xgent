import type { Tool, ToolResultMessage } from "@earendil-works/pi-ai";
import { isTauriRuntime } from "@xgent/runtime";
import { Type } from "typebox";
import { captureBackgroundLease } from "../automation/backgroundLease";
import type { BackgroundExecutionLease } from "../automation/types";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import type { ImageGenerationContext } from "./imageGenerationTools";
import type { ToolCommandPort } from "./toolCommandPort";

export type VideoGenerationContext = ImageGenerationContext & {
  executionId: string;
  lease: BackgroundExecutionLease;
};

export function createVideoGenerationTools(
  context: VideoGenerationContext,
  port: ToolCommandPort,
): BuiltinToolBundle | null {
  if (!isTauriRuntime() || !context.executionId) return null;
  const executionId = context.executionId;
  const lease = captureBackgroundLease(context.lease);
  const tools: Tool[] = [
    {
      name: "VideoModels",
      description:
        "List original accepted video accounts with no provider_id; follow nextOffset using offset. With an actual provider_id, read configured active video models and their supported durations/resolutions/aspect ratios from the dedicated catalog. Only the canonical OpenRouter API-key protocol is implemented. No model-name inference, relay/OAuth/video skill substitution or new account grant. Discovery is not a generation or quota guarantee.",
      parameters: Type.Object(
        {
          provider_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 4096 })),
        },
        { additionalProperties: false },
      ),
    },
    {
      name: "GenerateVideo",
      description:
        "Start one durable original-account text-to-video job through OpenRouter. Select provider_id/model and optional duration/resolution/aspect_ratio from VideoModels. path must be a portable relative .mp4 artifact path. Returns acceptance and the original callId, not a finished video. Native PC polling/download continues without the phone or model polling, retaining actual verified MP4 bytes up to 512 MiB in the parent artifact store. Finish independent branches, then RecordBackgroundOutcome(action=wait,wait_for_video_call_id=<this actual callId>,reason=...). On native continuation read VideoJob with that callId; inspect its artifact/error and verify the actual artifact IDs. Four submissions per task; one admitted start, never automatically resubmit an unknown POST. No arbitrary URLs, job IDs, keys, images, video-only chat delegates or placeholders. Parent stop/configuration changes prevent further collection; an already accepted upstream job may still run and cannot be undone by stopping this app.",
      parameters: Type.Object(
        {
          provider_id: Type.String({ minLength: 1, maxLength: 128 }),
          model: Type.String({ minLength: 1, maxLength: 512 }),
          prompt: Type.String({ minLength: 1, maxLength: 16000 }),
          path: Type.String({ minLength: 1, maxLength: 1000 }),
          duration: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
          resolution: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
          aspect_ratio: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        },
        { additionalProperties: false },
      ),
    },
    {
      name: "VideoJob",
      description:
        "Read the retained native observation of this task's original GenerateVideo call_id. This performs no provider request or generation. completed means actual MP4 bytes were durably published; its artifact carries ID/path/bytes/hash for parent evidence and inbox delivery. pending/in_progress is unfinished. failed/cancelled/expired is not successful evidence. Unknown submission requires original-operation inspection. Do not invent a job ID or call from another task.",
      parameters: Type.Object(
        { call_id: Type.String({ minLength: 1, maxLength: 256 }) },
        { additionalProperties: false },
      ),
    },
  ];
  return {
    groupId: "fs",
    tools,
    metadataByName: createBuiltinMetadataMap(
      tools.map((tool) => [
        tool.name,
        {
          groupId: "fs",
          kind: "fs",
          isReadOnly: tool.name !== "GenerateVideo",
          displayCategory: "file",
        },
      ]),
    ),
    async executeToolCall(call, signal) {
      let result: unknown,
        uncertain = false,
        startInvoked = false;
      try {
        signal?.throwIfAborted();
        await context.verifyConfiguration();
        signal?.throwIfAborted();
        const args = call.arguments as Record<string, unknown>;
        const binding = { execution_id: executionId, lease };
        if (call.name === "GenerateVideo") {
          if (
            !args ||
            Object.keys(args).some(
              (key) =>
                ![
                  "provider_id",
                  "model",
                  "prompt",
                  "path",
                  "duration",
                  "resolution",
                  "aspect_ratio",
                ].includes(key),
            ) ||
            [
              ["provider_id", 128],
              ["model", 512],
              ["prompt", 16000],
              ["path", 1000],
            ].some(
              ([key, limit]) =>
                typeof args[key as string] !== "string" ||
                !(args[key as string] as string).trim() ||
                (args[key as string] as string).length > (limit as number),
            ) ||
            typeof args.path !== "string" ||
            !args.path.toLowerCase().endsWith(".mp4") ||
            (args.duration !== undefined &&
              (!Number.isInteger(args.duration) ||
                Number(args.duration) < 1 ||
                Number(args.duration) > 600)) ||
            ["resolution", "aspect_ratio"].some(
              (key) =>
                args[key] !== undefined &&
                (typeof args[key] !== "string" ||
                  !(args[key] as string).length ||
                  (args[key] as string).length > 64),
            )
          )
            throw new Error("Invalid bounded original video arguments");
          await context.beforeRequest();
          signal?.throwIfAborted();
          startInvoked = true;
          const receipt = await port.invoke<ToolResultMessage>("automation_video_start", {
            ...binding,
            call_id: call.id,
            input: args,
          });
          if (
            receipt.role !== "toolResult" ||
            receipt.toolCallId !== call.id ||
            receipt.toolName !== call.name ||
            receipt.isError !== false ||
            receipt.details?.kind !== "video_job"
          )
            throw new Error(
              "video_submission_unconfirmed: native receipt does not match the original call",
            );
          // Native journal committed this exact receipt with the original job.
          // Retain a confirmed effect even when cancellation arrived afterward.
          return receipt;
        }
        if (call.name === "VideoModels") {
          if (Object.keys(args).some((key) => !["provider_id", "offset"].includes(key)))
            throw new Error("Unknown video discovery argument");
          result = await port.invoke("automation_video_models", {
            ...binding,
            provider_id: args.provider_id,
            offset: args.offset,
          });
        } else if (call.name === "VideoJob") {
          if (
            typeof args.call_id !== "string" ||
            !args.call_id.trim() ||
            args.call_id.length > 256 ||
            Object.keys(args).some((key) => key !== "call_id")
          )
            throw new Error("Original video generation call_id is required");
          result = await port.invoke("automation_video_result", {
            ...binding,
            call_id: args.call_id,
          });
        } else throw new Error("Unknown video tool");
        signal?.throwIfAborted();
        await context.verifyConfiguration();
        signal?.throwIfAborted();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        uncertain =
          message.includes("video_submission_unconfirmed:") ||
          (startInvoked && !message.startsWith("video_preflight_rejected:"));
        return {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: uncertain
                  ? "Original video submission is unconfirmed; inspect it without resubmitting"
                  : message,
              }),
            },
          ],
          details: { kind: "video_job", ...(uncertain ? { outcomeUncertain: true } : {}) },
          isError: true,
          timestamp: Date.now(),
        };
      }
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { kind: "video_job", result },
        isError: false,
        timestamp: Date.now(),
      };
    },
  };
}
