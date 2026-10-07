/** Serializable presentation contract. Business callbacks never cross the native boundary. */
import type { PresentationKind } from "./protocol";

export type { PresentationKind } from "./protocol";

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
  onAccent?: string;
  neutral?: string;
  error?: string;
  onError?: string;
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
  fontFamily?: string;
  codeFontFamily?: string;
};

export type PresentationNode = {
  id: string;
  kind: PresentationKind;
  label?: string;
  text?: string;
  value?: PresentationValue;
  action?: string;
  commitAction?: string;
  diagramAction?: string;
  focusRequest?: number;
  selectionAction?: string;
  editAction?: string;
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
  integerOnly?: boolean;
  clearable?: boolean;
  current?: number;
  total?: number;
  options?: {
    value: string;
    label: string;
    disabled?: boolean;
    group?: string;
    groupLabel?: string;
  }[];
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityValue?: string;
  children?: PresentationNode[];
};

export type PresentationDocument = {
  version: 1;
  surface: string;
  revision: number;
  mode: "root" | "sheet" | "alert" | "sidebar" | "panel" | "toast" | "status";
  workspacePanel?: {
    focusRequest: number;
    openLabel: string;
    returnLabel: string;
    expandLabel: string;
    restoreLabel: string;
    closeLabel: string;
    closeTabLabel?: string;
    dockLabel?: string;
    undockLabel?: string;
  };
  title: string;
  appearance: "system" | "light" | "dark";
  formFactor?: "mobile" | "desktop";
  theme?: PresentationTheme;
  nodes: PresentationNode[];
  dismissAction?: string;
  /** Hover/VoiceOver focus pauses a toast's actual lifetime without opening a control. */
  readingAction?: string;
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
  acceptedValue?: PresentationValue;
};

export type PresentationHandler = {
  enabled: boolean;
  accepts: (value: PresentationValue) => boolean;
  normalize?: (value: PresentationValue) => PresentationValue;
  run: (value: PresentationValue) => unknown | Promise<unknown>;
  /** Explicit read-only replies; ordinary command return values remain ignored. */
  resultValue?: (result: unknown) => PresentationValue;
};
