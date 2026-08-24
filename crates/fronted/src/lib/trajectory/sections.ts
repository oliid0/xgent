import { hashText } from "../shared/hash";
import type { TrajectorySection, TrajectorySectionRefs } from "./types";

export type TrajectorySectionInput = {
  base?: string;
  agent?: string;
  skills?: string;
  memory?: string;
  toolsSuffix?: string;
  toolCatalog?: string;
  runtime?: string;
};

const SLOT_ORDER: readonly (keyof TrajectorySectionInput)[] = [
  "base",
  "agent",
  "skills",
  "memory",
  "toolsSuffix",
  "toolCatalog",
  "runtime",
];

export function serializeToolCatalog(tools: unknown): string | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  try {
    return JSON.stringify(tools);
  } catch {
    return undefined;
  }
}

export function composeTrajectorySystemPrompt(input: TrajectorySectionInput): string | undefined {
  const parts = SLOT_ORDER.flatMap((slot) => {
    if (slot === "toolCatalog") return [];
    const value = input[slot];
    return typeof value === "string" && value.trim() !== "" ? [value.trim()] : [];
  });
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function buildTrajectoryHeader(
  input: TrajectorySectionInput,
  previous?: { headerId: string; refs: TrajectorySectionRefs },
): {
  headerId: string;
  refs: TrajectorySectionRefs;
  sections: TrajectorySection[];
  change: "none" | "partial" | "all";
} {
  const refs: TrajectorySectionRefs = {};
  const sections: TrajectorySection[] = [];
  for (const slot of SLOT_ORDER) {
    const content = input[slot];
    if (typeof content !== "string" || content === "") continue;
    const sectionId = `${slot}:${hashText(content)}`;
    refs[slot] = sectionId;
    if (previous?.refs[slot] !== sectionId) sections.push({ sectionId, slot, content });
  }
  const headerId = `header:${hashText(JSON.stringify(refs))}`;
  const change =
    previous?.headerId === headerId ? "none" : previous === undefined ? "all" : "partial";
  return { headerId, refs, sections, change };
}
