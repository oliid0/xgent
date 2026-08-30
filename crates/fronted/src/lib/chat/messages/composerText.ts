/**
 * Canonical line-ending model for user-authored chat text.
 * CRLF and bare CR are transport spellings of one logical line break.
 */
export function normalizeLogicalLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}
