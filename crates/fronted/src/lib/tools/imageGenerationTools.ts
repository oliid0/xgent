import type { Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { prepareProviderRequest } from "../providers/runtime/requestOptions";
import type { CustomProvider } from "../settings";
import { sha256Hex } from "../trajectory/sha256";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import type { ToolCommandPort } from "./toolCommandPort";

export type ImageGenerationContext = {
  providers: readonly CustomProvider[];
  verifyConfiguration: () => Promise<unknown>;
  beforeRequest: () => Promise<unknown>;
};

type ImageModel = { id: string; input: string[] };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Frozen configured accounts; only the verified dedicated OpenRouter protocol. */
export function createImageGenerationTools(
  context: ImageGenerationContext,
  port: ToolCommandPort,
  workdir: string,
): BuiltinToolBundle | null {
  const providers = (JSON.parse(JSON.stringify(context.providers)) as CustomProvider[]).filter(
    (provider) => {
      try {
        const url = new URL(provider.baseUrl);
        return (
          provider.type === "codex" &&
          provider.requestFormat === "openai-completions" &&
          provider.authMode !== "oauth-managed" &&
          !provider.isFullUrl &&
          (provider.apiKey.trim() || provider.apiKeyConfigured === true) &&
          url.origin === "https://openrouter.ai" &&
          url.pathname.replace(/\/$/, "") === "/api/v1" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          provider.activeModels.length > 0
        );
      } catch {
        return false;
      }
    },
  );
  if (!providers.length) return null;
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length)
    throw new Error("Image accounts have ambiguous configured identities");
  const models: Tool = {
    name: "ImageModels",
    description:
      "With no provider_id, list original accepted image-protocol accounts in bounded pages; follow nextOffset with offset. With a returned provider_id, discover its real image output capabilities from the dedicated image catalog. Only active configured model IDs actually returned by that catalog are included. This is metadata, not an image generation, quota/availability probe or new account grant. Errors remain unknown; model names and skill labels never prove image generation. No third-party relays, OAuth or videos are supported by this adapter.",
    parameters: Type.Object(
      {
        provider_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 4096 })),
      },
      { additionalProperties: false },
    ),
  };
  const generate: Tool = {
    name: "GenerateImage",
    description:
      "Generate one actual PNG/JPEG through the configured OpenRouter dedicated Image API. First use ImageModels to select an active image-capable model. provider_id/model refer to the original accepted account, never a URL/key or another device. prompt is the image brief. path is a portable relative workspace basename without extension (e.g. assets/product); the actual MIME determines .png or .jpg. Existing files are never overwritten. Uses one admitted generation request with no retries; account/policy/cancellation and original FS port are checked. Returns actual file path/size/hash, no invented URL or placeholder. Read/inspect the file, then publish it for offline delivery or compose it with OfficeCreate. At most 8 MiB. Unknown generation/write outcomes must not be regenerated automatically. A saved image is not proof that other task requirements or a video are complete.",
    parameters: Type.Object(
      {
        provider_id: Type.String({ minLength: 1, maxLength: 128 }),
        model: Type.String({ minLength: 1, maxLength: 512 }),
        prompt: Type.String({ minLength: 1, maxLength: 16000 }),
        path: Type.String({ minLength: 1, maxLength: 1000 }),
      },
      { additionalProperties: false },
    ),
  };

  async function request(
    provider: CustomProvider,
    suffix: string,
    body: unknown,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    await context.verifyConfiguration();
    signal?.throwIfAborted();
    const prepared = await prepareProviderRequest(
      provider.type,
      {
        providerConfigId: provider.id,
        baseUrl: provider.baseUrl,
        isFullUrl: false,
        apiKey: provider.apiKey,
        authMode: provider.authMode,
        customHeaders: provider.customHeaders,
        requestFormat: provider.requestFormat,
        useSystemProxy: provider.useSystemProxy,
      },
      { invoke: port.invoke },
    );
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(), body === undefined ? 30000 : 180000);
    try {
      const response = await fetch(`${prepared.baseUrl.replace(/\/$/, "")}/${suffix}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { ...prepared.headers, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        redirect: "error",
      });
      const limit = body === undefined ? 2 * 1024 * 1024 : 12 * 1024 * 1024;
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get("content-length")) > limit
      ) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Image service did not return a bounded successful response");
      }
      const reader = response.body.getReader(),
        decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0,
        json = "";
      try {
        for (;;) {
          controller.signal.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) throw new Error("Image response exceeds its byte limit");
          json += decoder.decode(chunk.value, { stream: true });
        }
        json += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      await context.verifyConfiguration();
      signal?.throwIfAborted();
      return JSON.parse(json) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function catalog(provider: CustomProvider, signal?: AbortSignal): Promise<ImageModel[]> {
    const response = await request(provider, "images/models", undefined, signal);
    if (!Array.isArray(response.data) || response.data.length > 4096)
      throw new Error("Image service returned an invalid model catalog");
    const allowed = new Set(
      provider.models.map((model) => model.id).filter((id) => provider.activeModels.includes(id)),
    );
    const result: ImageModel[] = [],
      seen = new Set<string>();
    for (const item of response.data) {
      if (!item || typeof item !== "object") throw new Error("Invalid image catalog entry");
      const model = item as {
        id?: unknown;
        architecture?: { input_modalities?: unknown; output_modalities?: unknown };
      };
      if (typeof model.id !== "string" || !allowed.has(model.id)) continue;
      if (seen.has(model.id)) throw new Error("Image catalog returned ambiguous model identities");
      seen.add(model.id);
      const input = model.architecture?.input_modalities,
        output = model.architecture?.output_modalities;
      if (
        !Array.isArray(input) ||
        !Array.isArray(output) ||
        !input.includes("text") ||
        !output.includes("image")
      )
        continue;
      result.push({
        id: model.id,
        input: input.filter((value): value is string => typeof value === "string").slice(0, 8),
      });
    }
    if (result.length > 128) throw new Error("Configured image catalog exceeds its model bound");
    return result;
  }

  return {
    groupId: "fs",
    tools: [models, generate],
    metadataByName: createBuiltinMetadataMap([
      [models.name, { groupId: "fs", kind: "fs", isReadOnly: true, displayCategory: "system" }],
      [generate.name, { groupId: "fs", kind: "fs", isReadOnly: false, displayCategory: "file" }],
    ]),
    async executeToolCall(call, signal) {
      let effect = false,
        result: unknown,
        isError = false;
      try {
        signal?.throwIfAborted();
        const args = call.arguments as Record<string, unknown>;
        const keys =
          call.name === models.name
            ? ["provider_id", "offset"]
            : ["provider_id", "model", "prompt", "path"];
        if (
          ![models.name, generate.name].includes(call.name) ||
          !args ||
          Object.keys(args).some((key) => !keys.includes(key))
        )
          throw new Error("Invalid image operation arguments");
        if (
          call.name === models.name &&
          args.provider_id !== undefined &&
          args.offset !== undefined
        )
          throw new Error("Image account paging cannot be applied to a selected model catalog");
        await context.verifyConfiguration();
        signal?.throwIfAborted();
        const accountList = call.name === models.name && args.provider_id === undefined;
        const provider = providers.find((provider) => provider.id === args.provider_id);
        if (!provider && !accountList)
          throw new Error("Image account was not accepted or does not support this protocol");
        if (accountList) {
          const offset = args.offset ?? 0;
          if (
            typeof offset !== "number" ||
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            offset > 4096
          )
            throw new Error("Invalid image account cursor");
          result = {
            accounts: providers.slice(offset, offset + 64).map((item) => ({
              providerId: item.id,
              name: item.name.slice(0, 128),
              configuredModels: item.activeModels.length,
            })),
            nextOffset: offset + 64 < providers.length ? offset + 64 : null,
          };
        } else if (call.name === models.name)
          result = {
            providerId: provider!.id,
            models: await catalog(provider!, signal),
            availability: "catalog_observed_not_probed",
          };
        else {
          const { path, prompt, model } = args;
          if (
            typeof path !== "string" ||
            path.length > 1000 ||
            path.includes("\\") ||
            path.includes(":") ||
            Array.from(path).some((character) => character.charCodeAt(0) < 32) ||
            path.split("/").some((part) => !part || part === "." || part === "..") ||
            /\.(png|jpe?g)$/i.test(path) ||
            typeof prompt !== "string" ||
            !prompt.trim() ||
            prompt.length > 16000 ||
            typeof model !== "string" ||
            !model.trim() ||
            model.length > 512
          )
            throw new Error("Image needs a bounded brief and a relative extensionless basename");
          if (!(await catalog(provider!, signal)).some((candidate) => candidate.id === model))
            throw new Error("Selected active model has no observed text-to-image capability");
          for (const extension of ["png", "jpg"]) {
            const status = await port.invoke<{ exists: boolean }>("fs_path_status", {
              workdir,
              path: `${path}.${extension}`,
            });
            signal?.throwIfAborted();
            if (status.exists !== false)
              throw new Error("Generated images never overwrite an existing path");
          }
          await context.verifyConfiguration();
          await context.beforeRequest();
          signal?.throwIfAborted();
          effect = true;
          const response = await request(provider!, "images", { model, prompt }, signal);
          if (!Array.isArray(response.data) || response.data.length !== 1)
            throw new Error("Image service did not return exactly one actual image");
          const source = response.data[0] as { b64_json?: unknown; media_type?: unknown };
          const data = source?.b64_json;
          if (
            typeof data !== "string" ||
            !data ||
            data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
            data.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
          )
            throw new Error("Invalid generated image encoding or byte size");
          const bytes = Uint8Array.from(atob(data), (value) => value.charCodeAt(0));
          const png =
            bytes.length >= 24 &&
            [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
          const jpeg =
            bytes.length >= 4 &&
            bytes[0] === 255 &&
            bytes[1] === 216 &&
            bytes[2] === 255 &&
            bytes.at(-2) === 255 &&
            bytes.at(-1) === 217;
          const mimeType = png ? "image/png" : jpeg ? "image/jpeg" : "";
          if (
            !mimeType ||
            bytes.length > MAX_IMAGE_BYTES ||
            (source.media_type !== undefined && source.media_type !== mimeType)
          )
            throw new Error("Generated image bytes and MIME do not describe PNG/JPEG");
          const output = `${path}.${png ? "png" : "jpg"}`,
            hash = sha256Hex(bytes);
          await context.verifyConfiguration();
          signal?.throwIfAborted();
          const saved = await port.invoke<{
            path: string;
            bytesWritten: number;
            contentHash: string;
          }>("fs_create_binary", {
            workdir,
            path: output,
            content_base64: data,
            expected_content_hash: hash,
          });
          if (
            saved.path !== output ||
            saved.bytesWritten !== bytes.length ||
            saved.contentHash !== hash
          )
            throw new Error(
              "Generated image save returned inconsistent evidence; inspect before retrying",
            );
          // A confirmed save survives late cancellation; the journal retains
          // its real outcome rather than replacing it with an abort error.
          result = {
            providerId: provider!.id,
            model,
            path: saved.path,
            bytes: saved.bytesWritten,
            contentHash: hash,
            mimeType,
          };
        }
      } catch (error) {
        isError = true;
        result = {
          error: effect
            ? "Image generation or saving was not confirmed; inspect the original operation before retrying"
            : error instanceof Error
              ? error.message
              : "Image capability discovery failed",
        };
      }
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: {
          kind: "generated_image",
          result,
          ...(isError && effect ? { outcomeUncertain: true } : {}),
        },
        isError,
        timestamp: Date.now(),
      };
    },
  };
}
