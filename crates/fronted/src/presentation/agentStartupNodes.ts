import type { useAgentStartup } from "../lib/automation/useAgentStartup";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function agentStartupNodes(
  c: ReturnType<typeof presentationControls>,
  startup: ReturnType<typeof useAgentStartup>,
  t: (key: string) => string,
): PresentationNode[] {
  const data = startup.data;
  return [
    c.group("agent-startup", t("agentStartup.title"), [
      c.action(
        "agent-startup-refresh",
        startup.busy ? t("agentStartup.loading") : t("agentStartup.refresh"),
        startup.refresh,
        !startup.busy,
      ),
      ...(startup.error
        ? [
            {
              id: "agent-startup-error",
              kind: "Banner" as const,
              status: "error" as const,
              label: startup.error,
            },
          ]
        : []),
      ...(data
        ? [
            ...(data.supported && data.registered !== null
              ? [
                  c.toggle(
                    "agent-startup-enabled",
                    t("agentStartup.enable"),
                    data.registered,
                    startup.setRegistered,
                    !startup.busy,
                  ),
                ]
              : [
                  {
                    id: "agent-startup-unavailable",
                    kind: "Text" as const,
                    text: t(`agentStartup.${data.reason ?? "plugin_unavailable"}`),
                  },
                ]),
            {
              id: "agent-startup-ready",
              kind: "Text" as const,
              text: t(data.workerReady ? "agentStartup.ready" : "agentStartup.notReady"),
            },
            ...(data.backgroundLaunch
              ? [
                  {
                    id: "agent-startup-mode",
                    kind: "Text" as const,
                    text: t("agentStartup.backgroundLaunch"),
                    secondary: true,
                  },
                ]
              : []),
            {
              id: "agent-startup-observed",
              kind: "Text" as const,
              text: `${t("agentStartup.observed")}: ${new Date(data.observedAtMs).toLocaleString()}`,
              secondary: true,
            },
          ]
        : !startup.busy && !startup.error
          ? [
              {
                id: "agent-startup-not-read",
                kind: "Text" as const,
                text: t("agentStartup.notRead"),
              },
            ]
          : []),
    ]),
  ];
}
