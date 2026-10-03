import { type CronTask, DEFAULT_CRON_TIMEOUT_SECONDS } from "../lib/automation";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function nativeCronTaskDetails(
  task: CronTask,
  t: (key: string) => string,
): PresentationNode[] {
  const c = presentationControls();
  const value = (id: string, label: string, text: string): PresentationNode => ({
    id: `cron-detail:${id}`,
    kind: "VStack",
    variant: "cron-detail-value",
    label: t(label),
    text,
  });
  const basic: PresentationNode[] = [
    value(
      "description",
      "settings.cronDescription",
      task.description || t("settings.cronViewNoDesc"),
    ),
    value(
      "status",
      "settings.cronViewStatus",
      t(task.enabled ? "settings.cronViewStatusEnabled" : "settings.cronViewStatusDisabled"),
    ),
    value("schedule", "settings.cronViewSchedule", task.cron),
    value(
      "remaining",
      "settings.cronRemainingExecutions",
      task.remainingExecutions == null
        ? t("settings.cronRemainingExecutionsUnlimited")
        : String(task.remainingExecutions),
    ),
    value(
      "timeout",
      "settings.cronTimeoutSeconds",
      String(task.timeoutSeconds ?? DEFAULT_CRON_TIMEOUT_SECONDS),
    ),
    ...(task.workdir ? [value("workdir", "settings.cronWorkdir", task.workdir)] : []),
    ...(task.lastError
      ? [
          {
            id: "cron-detail:error",
            kind: "Banner" as const,
            label: t("settings.cronScheduleError"),
            text: task.lastError,
            status: "error" as const,
          },
        ]
      : []),
  ];
  const config: PresentationNode[] =
    task.type === "bash"
      ? [
          {
            id: "cron-detail:script",
            kind: "CodeBlock",
            language: "bash",
            label: t("settings.cronCommand"),
            text: task.script || t("settings.cronViewNoConfig"),
          },
        ]
      : task.type === "prompt"
        ? [
            ...(task.selectedModel
              ? [
                  value("model", "settings.cronPromptModelLabel", task.selectedModel.model),
                  value("provider", "settings.providerName", task.selectedModel.customProviderId),
                ]
              : []),
            value("reasoning", "settings.reasoning", task.reasoning || "medium"),
            {
              id: "cron-detail:prompt",
              kind: "Text",
              text: task.prompt || t("settings.cronViewNoConfig"),
            },
          ]
        : (task.requests ?? []).map((request, index) =>
            c.group(
              `cron-detail:http:${request.id}`,
              `${t("settings.cronTypeHttp")} ${index + 1}`,
              [
                value(`http:${request.id}:method`, "settings.cronViewHttpMethod", request.method),
                value(`http:${request.id}:url`, "settings.cronViewHttpUrl", request.url),
                ...(request.headers
                  ? [
                      {
                        id: `cron-detail:http:${request.id}:headers`,
                        kind: "CodeBlock" as const,
                        label: t("settings.cronViewHttpHeaders"),
                        language: "json",
                        text: JSON.stringify(request.headers, null, 2),
                      },
                    ]
                  : []),
                ...(request.body !== undefined
                  ? [
                      {
                        id: `cron-detail:http:${request.id}:body`,
                        kind: "CodeBlock" as const,
                        label: t("settings.cronViewHttpBody"),
                        language: "json",
                        text: JSON.stringify(request.body, null, 2),
                      },
                    ]
                  : []),
              ],
            ),
          );
  return [
    c.group("cron-detail:metadata", t("settings.cronViewType"), [
      {
        id: "cron-detail:type",
        kind: "Badge",
        label: t(
          task.type === "bash"
            ? "settings.cronTypeBash"
            : task.type === "http"
              ? "settings.cronTypeHttp"
              : "settings.cronTypePrompt",
        ),
      },
      ...basic,
    ]),
    c.group("cron-detail:configuration", t("settings.cronViewConfig"), config),
  ];
}
