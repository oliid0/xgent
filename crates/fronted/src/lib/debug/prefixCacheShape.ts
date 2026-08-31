const FNV_PRIME = 0x01000193;
const FNV_OFFSET_BASIS = 0x811c9dc5;

const FNV_SECOND_SEED = 0x7ee3a1cf;

export type PrefixShapeTool = {
  name: string;
  description?: string;
  parameters?: unknown;
  constrainedSampling?: unknown;
};

export type PrefixShapeCacheControl = {
  cacheRetention?: string;
  ttl?: string;
  breakpointStrategy?: string;
  cacheKey?: string;
};

export type PrefixShape = {
  systemHash: string;
  toolsHash: string;
  cacheControlHash: string;
  prefixHash: string;
  toolCount: number;
};

export type PrefixChangeReason = "system" | "tools" | "cacheControl";

export type PrefixChangeSummary =
  | "initial"
  | "unchanged"
  | "system"
  | "tools"
  | "cacheControl"
  | "multiple";

export type PrefixCacheDiagnostics = {
  prefixHash: string;
  systemHash: string;
  toolsHash: string;
  cacheControlHash: string;
  toolCount: number;
  prefixChanged: boolean;
  prefixChangeReasons: PrefixChangeReason[];
  prefixChangeSummary: PrefixChangeSummary;
};

function fnv1a32(input: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);

    hash = Math.imul(hash ^ (code & 0xff), FNV_PRIME) >>> 0;
    hash = Math.imul(hash ^ ((code >>> 8) & 0xff), FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function toHex8(value: number) {
  return value.toString(16).padStart(8, "0");
}

function stableHash(input: string) {
  const salted = `${input.length}:${input}`;
  return `${toHex8(fnv1a32(salted, FNV_OFFSET_BASIS))}${toHex8(fnv1a32(salted, FNV_SECOND_SEED))}`;
}

function stringifyParameters(parameters: unknown) {
  if (parameters === undefined) return "";
  try {
    return JSON.stringify(parameters) ?? "";
  } catch {
    return "[unserializable]";
  }
}

function normalizeTools(tools: readonly PrefixShapeTool[]) {
  return tools.map((tool) => [
    tool.name,
    tool.description ?? "",
    stringifyParameters(tool.parameters),
    stringifyParameters(tool.constrainedSampling),
  ]);
}

function normalizeCacheControl(cacheControl: PrefixShapeCacheControl | undefined) {
  return [
    cacheControl?.cacheRetention ?? "",
    cacheControl?.ttl ?? "",
    cacheControl?.breakpointStrategy ?? "",
    cacheControl?.cacheKey ?? "",
  ];
}

export function capturePrefixShape(params: {
  systemPrompt?: string;
  tools?: readonly PrefixShapeTool[];
  cacheControl?: PrefixShapeCacheControl;
}): PrefixShape {
  const tools = params.tools ?? [];
  const systemHash = stableHash(params.systemPrompt ?? "");
  const toolsHash = stableHash(JSON.stringify(normalizeTools(tools)));
  const cacheControlHash = stableHash(JSON.stringify(normalizeCacheControl(params.cacheControl)));
  return {
    systemHash,
    toolsHash,
    cacheControlHash,
    prefixHash: stableHash(`${systemHash}:${toolsHash}:${cacheControlHash}`),
    toolCount: tools.length,
  };
}

export function comparePrefixShape(
  previous: PrefixShape | null | undefined,
  current: PrefixShape,
): PrefixCacheDiagnostics {
  const reasons: PrefixChangeReason[] = [];
  if (previous) {
    if (previous.systemHash !== current.systemHash) reasons.push("system");
    if (previous.toolsHash !== current.toolsHash) reasons.push("tools");
    if (previous.cacheControlHash !== current.cacheControlHash) reasons.push("cacheControl");
  }

  let summary: PrefixChangeSummary;
  if (!previous) {
    summary = "initial";
  } else if (reasons.length === 0) {
    summary = "unchanged";
  } else if (reasons.length > 1) {
    summary = "multiple";
  } else {
    summary = reasons[0];
  }

  return {
    prefixHash: current.prefixHash,
    systemHash: current.systemHash,
    toolsHash: current.toolsHash,
    cacheControlHash: current.cacheControlHash,
    toolCount: current.toolCount,
    prefixChanged: reasons.length > 0,
    prefixChangeReasons: reasons,
    prefixChangeSummary: summary,
  };
}
