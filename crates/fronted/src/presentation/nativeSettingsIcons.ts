import type { PresentationNode } from "./types";

// Explicit semantic glyphs keep independently mounted settings details consistent
// with the mobile index, without depending on translated labels or array positions.
const icons: Record<string, string> = {
  theme: "sun.max",
  "appearance-preset": "paintpalette",
  mode: "terminal",
  "execution-mode": "terminal",
  language: "globe",
  locale: "globe",
  thinking: "brain",
  "appearance-customized": "slider.horizontal.3",
  "appearance-radius": "rectangle.roundedtop",
  "backup-preset": "cloud",
  "backup-auto": "arrow.triangle.2.circlepath",
  "memory-organizer-enabled": "brain",
  "memory-organizer-frequency": "calendar",
  "memory-organizer-weekday": "calendar",
  "memory-organizer-scope": "square.stack",
  "memory-organizer-mode": "slider.horizontal.3",
  "memory-organizer-history": "clock.arrow.circlepath",
  "provider-system-proxy": "network",
  "provider-stream-retry": "arrow.clockwise",
  "provider-prompt-cache": "externaldrive",
  "provider-cache-retention": "clock",
  "provider-cache-hint": "slider.horizontal.3",
};

export function withNativeSettingsIcons(node: PresentationNode): PresentationNode {
  const icon =
    icons[node.id] ??
    (node.id.startsWith("font-scale:")
      ? "textformat.size"
      : node.id.startsWith("font-family:") && node.kind === "Selector"
        ? "textformat"
        : node.id.startsWith("model-settings:") && node.id.endsWith(":inputMode")
          ? "photo"
          : node.id.startsWith("model-settings:") && node.id.endsWith(":cacheHint")
            ? "slider.horizontal.3"
            : undefined);
  return {
    ...node,
    icon: node.icon ?? icon,
    children: node.children?.map(withNativeSettingsIcons),
  };
}
