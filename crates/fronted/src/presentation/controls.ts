import { flushSync } from "react-dom";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

/** Shared state/action contract; each client owns its control layout and styling. */
export function presentationControls() {
  const handlers = new Map<string, PresentationHandler>();
  function bind(
    id: string,
    run: (value: PresentationValue) => unknown,
    accepts: PresentationHandler["accepts"],
    enabled = true,
    normalize?: PresentationHandler["normalize"],
  ) {
    handlers.set(id, { run, accepts, enabled, normalize });
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
      enabled = true,
      normalize?: (value: string) => string,
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
          enabled,
          normalize ? (next) => normalize(next as string) : undefined,
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
          (next) => run(next as string),
          (next) => typeof next === "string" && /^#[\da-f]{6}$/i.test(next),
          true,
          (next) => (next as string).toLowerCase(),
        ),
      };
    },
    number(
      id: string,
      label: string,
      value: number,
      minimum: number,
      maximum: number,
      step: number,
      run: (value: number) => unknown,
      enabled = true,
      normalize?: (value: number) => number,
      integerOnly = false,
    ): PresentationNode {
      return {
        id,
        kind: "NumberInput",
        label,
        value,
        minimum,
        maximum,
        step,
        integerOnly,
        ...bind(
          id,
          (next) => {
            let result: unknown;
            flushSync(() => {
              result = run(next as number);
            });
            return result;
          },
          (next) =>
            typeof next === "number" &&
            Number.isFinite(next) &&
            (!integerOnly || Number.isInteger(next)),
          enabled,
          (next) => {
            const number = normalize ? normalize(next as number) : (next as number);
            return Math.min(maximum, Math.max(minimum, number));
          },
        ),
      };
    },
    optionalNumber(
      id: string,
      label: string,
      value: number | null,
      minimum: number,
      maximum: number | undefined,
      step: number,
      run: (value: number | null) => unknown,
      enabled = true,
      integerOnly = false,
    ): PresentationNode {
      return {
        id,
        kind: "NumberInput",
        label,
        value,
        minimum,
        maximum,
        step,
        integerOnly,
        clearable: true,
        ...bind(
          id,
          (next) => {
            let result: unknown;
            flushSync(() => {
              result = run(next as number | null);
            });
            return result;
          },
          (next) =>
            next === null ||
            (typeof next === "number" &&
              Number.isFinite(next) &&
              (!integerOnly || Number.isInteger(next))),
          enabled,
          (next) =>
            next === null
              ? null
              : Math.min(maximum ?? Number.MAX_VALUE, Math.max(minimum, next as number)),
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
      enabled = true,
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
          enabled,
        ),
      };
    },
    group(id: string, label: string, children: PresentationNode[]): PresentationNode {
      return { id, kind: "SettingsGroup", label, children };
    },
  };
}
