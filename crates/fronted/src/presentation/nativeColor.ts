/** Normalize resolved CSS colors for native attributed text and surfaces. */
export function cssColor(value: string | number, fallbackValue: string) {
  if (typeof value !== "string") return fallbackValue;
  const normalized = value.trim();
  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(normalized)) return normalized.toLowerCase();
  if (/^#[\da-f]{3,4}$/i.test(normalized)) {
    return `#${normalized
      .slice(1)
      .split("")
      .map((part) => part + part)
      .join("")}`.toLowerCase();
  }
  const rgb = /^rgba?\((.+)\)$/i.exec(normalized);
  if (!rgb) return fallbackValue;
  const [channelsText, slashAlpha] = rgb[1]
    .replaceAll(",", " ")
    .split("/")
    .map((part) => part.trim());
  const parts = channelsText.split(/\s+/).filter(Boolean);
  const alphaText = slashAlpha ?? (parts.length === 4 ? parts.pop() : undefined);
  const channels = parts.map((channel) =>
    channel.endsWith("%") ? (Number(channel.slice(0, -1)) / 100) * 255 : Number(channel),
  );
  const alpha = alphaText
    ? alphaText.endsWith("%")
      ? Number(alphaText.slice(0, -1)) / 100
      : Number(alphaText)
    : 1;
  if (channels.length !== 3 || !channels.every(Number.isFinite) || !Number.isFinite(alpha))
    return fallbackValue;
  const hex = channels.map((channel) =>
    Math.round(Math.max(0, Math.min(255, channel)))
      .toString(16)
      .padStart(2, "0"),
  );
  const opacity = Math.max(0, Math.min(1, alpha));
  return `#${hex.join("")}${
    opacity < 1
      ? Math.round(opacity * 255)
          .toString(16)
          .padStart(2, "0")
      : ""
  }`;
}
