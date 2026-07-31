import type { Tool } from "@earendil-works/pi-ai";

/**
 * MCP servers provide ordinary JSON Schema while pi-ai types parameters as a
 * TypeBox schema. They are runtime-compatible, but untrusted dynamic schemas
 * still need a structural boundary before being sent to a model provider.
 */
export function normalizeToolParametersSchema(input: unknown, label: string): Tool["parameters"] {
  const fallback = { type: "object" as const };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    if (input !== undefined && input !== null) {
      console.warn(
        `[tools] ${label} parameters is not a JSON Schema object; using {type:"object"}.`,
      );
    }
    return fallback as unknown as Tool["parameters"];
  }

  const schema = input as Record<string, unknown>;
  if (schema.type !== undefined && schema.type !== "object") {
    console.warn(
      `[tools] ${label} parameters has top-level type "${String(schema.type)}"; coercing to object schema.`,
    );
    return { ...schema, type: "object" } as unknown as Tool["parameters"];
  }
  if (schema.type === undefined) {
    return { type: "object", ...schema } as unknown as Tool["parameters"];
  }
  return schema as unknown as Tool["parameters"];
}
