/**
 * Parsing and highlighting cost grows with the complete streamed response,
 * not merely with the latest token delta. Keep short replies frame-paced and
 * progressively batch very long replies to protect input and scroll latency.
 */
export function resolveStreamingRenderDelay(renderedCharacters: number) {
  const size = Math.max(0, Number.isFinite(renderedCharacters) ? renderedCharacters : 0);
  if (size < 12_000) return 0;
  if (size < 48_000) return 16;
  if (size < 120_000) return 32;
  if (size < 240_000) return 64;
  return 96;
}
