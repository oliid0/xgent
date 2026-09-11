/** Serializable presentation contract. Business callbacks never cross the native boundary. */
import type { PresentationKind } from "./kinds.generated";

export type { PresentationKind } from "./kinds.generated";

export type PresentationValue = string | number | boolean | null;

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
  fill?: boolean;
  options?: { value: string; label: string; disabled?: boolean }[];
  children?: PresentationNode[];
};

export type PresentationDocument = {
  version: 1;
  surface: string;
  revision: number;
  mode: "root" | "sheet" | "alert";
  title: string;
  appearance: "system" | "light" | "dark";
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
