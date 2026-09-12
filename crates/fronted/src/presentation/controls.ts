import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

/** One validated action contract for declarative controls and generated SwiftUI. */
export function presentationControls() {
  const handlers = new Map<string, PresentationHandler>();
  function bind(
    id: string,
    run: (value: PresentationValue) => unknown,
    accepts: PresentationHandler["accepts"],
    enabled = true,
  ) {
    handlers.set(id, { run, accepts, enabled });
    return { action: id, disabled: !enabled };
  }
  return {
    handlers,
    action(id: string, label: string, run: () => unknown, enabled = true): PresentationNode {
      return { id, kind: "Button", label, ...bind(id, run, (value) => value === null, enabled) };
    },
    input(
      id: string,
      label: string,
      value: string,
      run: (value: string) => unknown,
      secure = false,
    ): PresentationNode {
      return {
        id,
        kind: "TextInput",
        label,
        value,
        secure,
        ...bind(
          id,
          (next) => run(next as string),
          (next) => typeof next === "string",
        ),
      };
    },
    color(
      id: string,
      label: string,
      value: string,
      run: (value: string) => unknown,
    ): PresentationNode {
      return {
        id,
        kind: "ColorInput",
        label,
        value,
        ...bind(
          id,
          (next) => run((next as string).toLowerCase()),
          (next) => typeof next === "string" && /^#[\da-f]{6}$/i.test(next),
        ),
      };
    },
    toggle(
      id: string,
      label: string,
      value: boolean,
      run: (value: boolean) => unknown,
      enabled = true,
    ): PresentationNode {
      return {
        id,
        kind: "Switch",
        label,
        value,
        ...bind(
          id,
          (next) => run(next as boolean),
          (next) => typeof next === "boolean",
          enabled,
        ),
      };
    },
    select(
      id: string,
      label: string,
      value: string,
      options: { value: string; label: string }[],
      run: (value: string) => unknown,
    ): PresentationNode {
      return {
        id,
        kind: "Selector",
        label,
        value,
        options,
        ...bind(
          id,
          (next) => run(next as string),
          (next) => options.some((option) => option.value === next),
        ),
      };
    },
    group(id: string, label: string, children: PresentationNode[]): PresentationNode {
      return { id, kind: "SettingsGroup", label, children };
    },
  };
}
