import type { PersonalHistoryMessageRef } from "../api";
import {
  MEMORY_BODY_LIMIT_BYTES,
  PERSONAL_EVIDENCE_QUOTE_CHARS,
  PERSONAL_PATTERN_MIN_DATES,
} from "../config";
import type { ExtractionPlanItem, MemoryEvidenceFields, PlanItemRejectionCode } from "../schema";

export type UserMemoryObservation = {
  id: string;
  text: string;
  timestamp: number | null;
  localDate: string | null;
  timeZone: string;
  inferenceEligible: boolean;
  history?: PersonalHistoryMessageRef & { contentHash: string; truncated: boolean };
};

export type PersonalEvidenceResult =
  | { body: string | undefined; evidence: MemoryEvidenceFields; inferred: boolean }
  | { code: PlanItemRejectionCode; message: string };

/** Only actual messages supplied by the host can establish quote/date evidence.
 * Semantic truth remains a model judgement; corroboration is not confirmation. */
export function validatePersonalEvidence(
  item: ExtractionPlanItem,
  observations: readonly UserMemoryObservation[],
  allowInference: boolean,
  baseEvidence: MemoryEvidenceFields | undefined,
): PersonalEvidenceResult {
  const basis = item.evidence_basis ?? "explicit";
  if (basis !== "explicit" && basis !== "inferred") {
    return { code: "invalid-personal-evidence", message: "Unknown personal evidence basis" };
  }
  const quote = typeof item.source_quote === "string" ? item.source_quote.trim() : "";
  if (!quote || Array.from(quote).length > PERSONAL_EVIDENCE_QUOTE_CHARS) {
    return {
      code: "invalid-personal-evidence",
      message: "Personal memory requires a bounded exact user quote",
    };
  }
  const sources = observations.filter((observation) => observation.text.includes(quote));
  const source =
    sources.filter((observation) => !observation.history).at(-1) ??
    [...sources].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
  if (!source) {
    return {
      code: "invalid-personal-evidence",
      message: "Personal quote was not found in the actual user evidence window",
    };
  }
  const references: Array<{
    id: string;
    timestamp: number | null;
    localDate: string | null;
    timeZone: string;
    quote: string;
    history?: UserMemoryObservation["history"];
  }> = [];
  if (basis === "inferred") {
    if (!allowInference) {
      return {
        code: "invalid-personal-evidence",
        message: "Current reviewer mode does not allow inferred personal patterns",
      };
    }
    if (!Array.isArray(item.observations) || item.observations.length > observations.length) {
      return {
        code: "invalid-personal-evidence",
        message: "Inferred pattern requires references to actual user observations",
      };
    }
    const seen = new Set<string>();
    for (const reference of item.observations) {
      const observed = observations.find((observation) => observation.id === reference?.id);
      const text = typeof reference?.quote === "string" ? reference.quote.trim() : "";
      if (
        !observed ||
        seen.has(observed.id) ||
        !observed.localDate ||
        !observed.inferenceEligible ||
        observed.timestamp === null ||
        !text ||
        Array.from(text).length > PERSONAL_EVIDENCE_QUOTE_CHARS ||
        !observed.text.includes(text)
      ) {
        return {
          code: "invalid-personal-evidence",
          message:
            "Inferred pattern references missing, repeated, undated or misquoted user evidence",
        };
      }
      seen.add(observed.id);
      references.push({
        id: observed.id,
        timestamp: observed.timestamp,
        localDate: observed.localDate,
        timeZone: observed.timeZone,
        quote: text,
        ...(observed.history ? { history: observed.history } : {}),
      });
    }
    if (
      new Set(references.map((reference) => reference.localDate)).size <
        PERSONAL_PATTERN_MIN_DATES ||
      !references.some(
        (reference) =>
          sources.some((observation) => observation.id === reference.id) &&
          reference.quote.includes(quote),
      )
    ) {
      return {
        code: "invalid-personal-evidence",
        message: "Inferred pattern needs distinct dated observations including its source quote",
      };
    }
    if (!item.body?.trim()) {
      return {
        code: "invalid-personal-evidence",
        message: "Inferred pattern needs its qualified candidate body",
      };
    }
  } else {
    references.push({
      id: source.id,
      timestamp: source.timestamp,
      localDate: source.localDate,
      timeZone: source.timeZone,
      quote,
      ...(source.history ? { history: source.history } : {}),
    });
  }
  const provenance = JSON.stringify({ basis, observations: references });
  const body = item.body?.trim()
    ? `${basis === "inferred" ? "Inferred personal pattern; not user-confirmed.\n\n" : ""}${item.body.trim()}\n\n## Personal evidence\n${provenance}`
    : undefined;
  if (body && new TextEncoder().encode(body).length > MEMORY_BODY_LIMIT_BYTES) {
    return {
      code: "body-too-large",
      message: "Personal memory with verified provenance exceeds the existing body limit",
    };
  }
  return {
    body,
    inferred: basis === "inferred",
    evidence: {
      ...baseEvidence,
      ...(basis === "inferred" ? { confidence: "low" } : {}),
      sourceQuote: quote,
      reasoning:
        `Personal evidence basis=${basis}; ${references.length} actual user record(s). ${baseEvidence?.reasoning ?? ""}`.trim(),
    },
  };
}
