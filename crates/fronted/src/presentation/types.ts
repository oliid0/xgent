/** Serializable presentation contract. Business callbacks never cross the native boundary. */
import type { PresentationKind } from "./kinds.generated";

export type { PresentationKind } from "./kinds.generated";

export type PresentationValue = string | number | boolean | null;

export type PresentationPalette = {
  accent: string;
  accentText: string;
  background: string;
  surface: string;
  card: string;
  popover: string;
  muted: string;
  text: string;
  secondaryText: string;
  disabledText: string;
  border: string;
  emphasizedBorder: string;
  shadow: string;
};

export type PresentationTheme = {
  light: PresentationPalette;
  dark: PresentationPalette;
  radius: { inner: number; element: number; container: number; overlay: number; chat: number };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  control: { small: number; medium: number; large: number };
  typography: { caption: number; supporting: number; body: number };
  motion: { fast: number; medium: number; slow: number; curve: [number, number, number, number] };
  material: {
    light: { surfaceOpacity: number; popoverOpacity: number; shadowOpacity: number };
    dark: { surfaceOpacity: number; popoverOpacity: number; shadowOpacity: number };
    blur: number;
    saturation: number;
  };
  fontScale: number;
};

export type PresentationNode = {
  id: string;
  kind: PresentationKind;
  label?: string;
  text?: string;
  value?: PresentationValue;
  action?: string;
  disabled?: boolean;
  destructive?: boolean;
  prominent?: boolean;
  secure?: boolean;
  secondary?: boolean;
  spacing?: number;
  padding?: number;
  indent?: number;
  fill?: boolean;
  alignment?: "leading" | "center" | "trailing";
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  height?: number;
  minHeight?: number;
  maxHeight?: number;
  maxLines?: number;
  wrap?: boolean;
  variant?: string;
  size?: "small" | "medium" | "large";
  icon?: string;
  selected?: boolean;
  role?: "user" | "assistant" | "system";
  status?: "pending" | "running" | "completed" | "error" | "paused";
  language?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  current?: number;
  total?: number;
  options?: { value: string; label: string; disabled?: boolean }[];
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityValue?: string;
  children?: PresentationNode[];
};

export type PresentationDocument = {
  version: 1;
  surface: string;
  revision: number;
  mode: "root" | "sheet" | "alert" | "sidebar";
  title: string;
  appearance: "system" | "light" | "dark";
  formFactor?: "mobile" | "desktop";
  theme?: PresentationTheme;
  nodes: PresentationNode[];
  dismissAction?: string;
  removed?: boolean;
};

export type PresentationAction = {
  surface: string;
  action: string;
  requestId: string;
  value: PresentationValue;
};

export type PresentationActionResult = {
  surface: string;
  requestId: string;
  ok: boolean;
  error?: string;
};

export type PresentationHandler = {
  enabled: boolean;
  accepts: (value: PresentationValue) => boolean;
  run: (value: PresentationValue) => unknown | Promise<unknown>;
};
