import { type CronTask, DEFAULT_CRON_TIMEOUT_SECONDS } from "../lib/automation";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function nativeCronTaskDetails(
  task: CronTask,
  t: (key: string) => string,
): PresentationNode[] {
  const c = presentationControls();
  const reasoning = task.reasoning || "medium";
  const reasoningKey = `settings.reasoning.${reasoning}`;
  const reasoningLabel = t(reasoningKey);
  const value = (id: string, label: string, text: string): PresentationNode => ({
    id: `cron-detail:${id}`,
    kind: "VStack",
    variant: "cron-detail-value",
    label: t(label),
    text,
  });
  const basic: PresentationNode[] = [
    ...(task.description ? [value("description", "settings.cronTaskDesc", task.description)] : []),
    value(
      "type",
      "settings.cronViewType",
      t(
        task.type === "bash"
          ? "settings.cronTypeBash"
          : task.type === "http"
            ? "settings.cronTypeHttp"
            : "settings.cronTypePrompt",
      ),
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
    ...(task.workdir ? [value("workdir", "settings.cronWorkdirLabel", task.workdir)] : []),
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
            label: t("settings.cronCommandList"),
            text: task.script || t("settings.cronViewNoConfig"),
          },
        ]
      : task.type === "prompt"
        ? [
            ...(task.selectedModel
              ? [value("model", "settings.cronPromptModelLabel", task.selectedModel.model)]
              : []),
            value(
              "reasoning",
              "settings.reasoning",
              reasoningLabel === reasoningKey ? reasoning : reasoningLabel,
            ),
            {
              id: "cron-detail:prompt",
              kind: "CodeBlock",
              label: t("settings.cronPromptLabel"),
              language: "text",
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
    { ...c.group("cron-detail:metadata", "", basic), variant: "cron-detail-section" },
    {
      ...c.group("cron-detail:configuration", t("settings.cronViewConfig"), config),
      variant: "cron-detail-section",
    },
  ];
}
