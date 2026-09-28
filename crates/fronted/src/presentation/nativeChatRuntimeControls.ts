import type { ChatRuntimeControls, ReasoningLevel } from "../lib/settings";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

/** Use the provider-normalized state and updater already used by the web composer. */
export function createNativeChatRuntimeControls(
  props: {
    controls: ChatRuntimeControls;
    reasoningOptions: ReasoningLevel[];
    thinkingAlwaysOn: boolean;
    agentMode: boolean;
    disabled: boolean;
    onChange: (patch: Partial<ChatRuntimeControls>) => void;
  },
  t: (key: string) => string,
) {
  const c = presentationControls();
  const thinkingSupported = props.reasoningOptions.length > 0 || props.thinkingAlwaysOn;
  const thinkingOn =
    thinkingSupported && (props.controls.thinkingEnabled || props.thinkingAlwaysOn);
  const nodes: PresentationNode[] = [
    {
      ...c.toggle(
        "runtime-plan",
        t(props.controls.planModeEnabled ? "chat.planMode.on" : "chat.planMode.off"),
        props.controls.planModeEnabled,
        (planModeEnabled) => props.onChange({ planModeEnabled }),
        !props.disabled && props.agentMode,
      ),
      icon: "sparkles",
    },
    {
      ...c.toggle(
        "runtime-web-search",
        t("chat.runtime.webSearchTooltip"),
        props.controls.nativeWebSearchEnabled,
        (nativeWebSearchEnabled) => props.onChange({ nativeWebSearchEnabled }),
        !props.disabled,
      ),
      icon: "globe",
    },
    {
      ...c.toggle(
        "runtime-thinking",
        t(
          !thinkingSupported
            ? "chat.runtime.thinkingUnavailable"
            : thinkingOn
              ? "chat.runtime.thinkingOn"
              : "chat.runtime.thinkingOff",
        ),
        thinkingOn,
        (thinkingEnabled) => props.onChange({ thinkingEnabled }),
        !props.disabled && thinkingSupported && !props.thinkingAlwaysOn,
      ),
      icon: "brain",
    },
  ];
  const levels = props.reasoningOptions.filter((level) => level !== "off");
  if (levels.length > 1) {
    nodes.push(
      c.select(
        "runtime-reasoning",
        t("chat.runtime.reasoning"),
        props.controls.reasoning,
        levels.map((value) => ({ value, label: t(`settings.reasoning.${value}`) })),
        (reasoning) =>
          props.onChange({ reasoning: reasoning as ReasoningLevel, thinkingEnabled: true }),
        !props.disabled,
      ),
    );
  }
  return { nodes, handlers: c.handlers };
}
