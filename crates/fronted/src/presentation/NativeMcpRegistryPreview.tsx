import { openUrl } from "@xgent/runtime";
import { useEffect, useState } from "react";
import { useLocale } from "../i18n";
import {
  type McpRegistryCard,
  mcpRegistryConfigInputKey,
  resolveMcpRegistryInstallDraft,
  selectMcpRegistryCardForHost,
} from "../lib/mcpRegistry";
import {
  configTargetLabel,
  configureDraftForCard,
  installLabelKey,
  primaryRegistryLink,
  registryExternalLinks,
} from "../lib/mcpRegistry/preview";
import type { AppSettings } from "../lib/settings";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import type { PresentationNode } from "./types";

export function NativeMcpRegistryPreview(props: {
  card: McpRegistryCard;
  settings: AppSettings;
  compact: boolean;
  allowStdio: boolean;
  installed: boolean;
  installing: boolean;
  installBusy: boolean;
  installError: string;
  close: () => void;
  install: (card: McpRegistryCard) => Promise<void>;
}) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<{ source: McpRegistryCard; card: McpRegistryCard } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setDetail(null);
    setLoading(true);
    setError("");
    void resolveMcpRegistryInstallDraft(props.card)
      .then((card) => {
        if (active) setDetail({ source: props.card, card });
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.card]);

  const data = selectMcpRegistryCardForHost(
    detail?.source === props.card ? detail.card : props.card,
    props.allowStdio,
  );
  const draft = configureDraftForCard(data);
  const server = draft?.server;
  const transports = draft ? [draft.server.transport] : data.transportHints;
  const c = presentationControls();
  c.action("close", t("settings.close"), props.close);
  const value = (id: string, key: string, text: string): PresentationNode => ({
    id: `mcp-preview:${id}`,
    kind: "VStack",
    children: [
      { id: `mcp-preview:${id}:label`, kind: "Text", text: t(key), secondary: true },
      { id: `mcp-preview:${id}:value`, kind: "Text", text },
    ],
  });
  const key = installLabelKey(data);
  const installLabel = props.installing
    ? "mcpHub.storeInstalling"
    : props.installed
      ? "mcpHub.storeInstalled"
      : key === "mcpHub.storeInstall" || key === "mcpHub.storeConfigure"
        ? key
        : "mcpHub.storeAddDraft";
  const primaryLink = primaryRegistryLink(data);
  const nodes: PresentationNode[] = [
    {
      id: "mcp-preview-description",
      kind: "Text",
      text: data.description || t("mcpHub.storeNoDescription"),
    },
    value("source", "mcpHub.storePreviewSource", data.source),
    value(
      "mode",
      "mcpHub.storePreviewMode",
      t(data.remote ? "mcpHub.storePreviewRemote" : "mcpHub.storePreviewLocal"),
    ),
    ...(data.verified
      ? [
          {
            id: "mcp-preview-verified",
            kind: "Badge" as const,
            label: t("mcpHub.storePreviewVerified"),
          },
        ]
      : []),
    ...(data.tags.length ? [value("tags", "mcpHub.storePreviewTags", data.tags.join(", "))] : []),
    ...(loading
      ? [
          {
            id: "mcp-preview-loading",
            kind: "Progress" as const,
            label: t("mcpHub.storePreviewLoadingDetail"),
          },
        ]
      : []),
    ...(error
      ? [
          {
            id: "mcp-preview-error",
            kind: "Banner" as const,
            status: "error" as const,
            label: t("mcpHub.storePreviewDetailUnavailable"),
            text: error,
          },
        ]
      : []),
    {
      id: "mcp-preview-command-title",
      kind: "Heading",
      text: t("mcpHub.storePreviewInstallPreview"),
    },
    ...(draft?.commandPreview
      ? [
          {
            id: "mcp-preview-command",
            kind: "CodeBlock" as const,
            text: draft.commandPreview,
            language: "shell",
          },
        ]
      : [
          {
            id: "mcp-preview-unavailable",
            kind: "Banner" as const,
            status: "paused" as const,
            label: t(
              data.installUnavailableReason === "needs-manual-command"
                ? "mcpHub.storeNeedsCommand"
                : "mcpHub.storeManualOnly",
            ),
          },
        ]),
    value("name", "mcpHub.serverName", server?.id ?? data.name),
    ...(transports.length ? [value("transport", "mcpHub.transport", transports.join(", "))] : []),
    ...(server?.timeoutMs ? [value("timeout", "mcpHub.timeout", `${server.timeoutMs} ms`)] : []),
    ...(server?.command ? [value("executable", "mcpHub.command", server.command)] : []),
    ...(server?.args?.length ? [value("args", "mcpHub.args", server.args.join(" "))] : []),
    ...(server?.url
      ? [value("url", server.transport === "sse" ? "mcpHub.urlSse" : "mcpHub.urlHttp", server.url)]
      : []),
    ...(server?.messageUrl ? [value("message-url", "mcpHub.messageUrl", server.messageUrl)] : []),
    ...(Object.keys(server?.env ?? {}).length
      ? [value("env", "mcpHub.env", Object.keys(server?.env ?? {}).join(", "))]
      : []),
    ...(Object.keys(server?.headers ?? {}).length
      ? [value("headers", "mcpHub.headers", Object.keys(server?.headers ?? {}).join(", "))]
      : []),
    {
      id: "mcp-preview-config-title",
      kind: "Heading",
      text: t("mcpHub.storePreviewRequiredConfig"),
    },
    ...(draft?.requiredConfig.length
      ? draft.requiredConfig.map(
          (input): PresentationNode => ({
            id: `mcp-preview-config:${mcpRegistryConfigInputKey(input)}`,
            kind: "VStack",
            children: [
              {
                id: `mcp-preview-config:${mcpRegistryConfigInputKey(input)}:name`,
                kind: "Text",
                text: input.label ?? input.name,
                icon: input.secret ? "key" : undefined,
              },
              {
                id: `mcp-preview-config:${mcpRegistryConfigInputKey(input)}:target`,
                kind: "Badge",
                label: configTargetLabel(input, t),
              },
              ...(input.description
                ? [
                    {
                      id: `mcp-preview-config:${mcpRegistryConfigInputKey(input)}:description`,
                      kind: "Text" as const,
                      text: input.description,
                      secondary: true,
                    },
                  ]
                : []),
            ],
          }),
        )
      : [
          {
            id: "mcp-preview-no-config",
            kind: "Text" as const,
            text: t("mcpHub.storePreviewNoRequiredConfig"),
            secondary: true,
          },
        ]),
    ...(draft?.warnings.length
      ? [
          {
            id: "mcp-preview-warnings",
            kind: "Banner" as const,
            status: "paused" as const,
            label: t("mcpHub.storePreviewWarnings"),
            text: draft.warnings.join("\n"),
          },
        ]
      : []),
    ...registryExternalLinks(data).map((link) => ({
      ...c.action(`mcp-preview-link:${link.key}`, t(link.labelKey), () => openUrl(link.url)),
      icon: "arrow.up.right",
    })),
    ...(primaryLink
      ? [
          c.action("mcp-preview-external", t("mcpHub.storeOpenExternal"), () =>
            openUrl(primaryLink),
          ),
        ]
      : []),
    ...(props.installError
      ? [
          {
            id: "mcp-preview-install-error",
            kind: "Banner" as const,
            status: "error" as const,
            label: props.installError,
          },
        ]
      : []),
    {
      ...c.action(
        "mcp-preview-install",
        t(installLabel),
        () => props.install(data),
        !props.installed && !props.installBusy && !loading,
      ),
      prominent: true,
    },
  ];
  return (
    <NativeSurface
      document={{
        mode: "sheet",
        title: data.displayName,
        appearance: props.settings.theme,
        formFactor: props.compact ? "mobile" : "desktop",
        theme: createNativePresentationTheme(props.settings, props.compact, "workspaceTools"),
        dismissAction: "close",
        nodes: [
          {
            id: "mcp-registry-preview",
            kind: "VStack",
            variant: "mcp-registry-preview",
            children: nodes,
          },
        ],
      }}
      handlers={c.handlers}
      onError={(cause) => setError(String(cause))}
    />
  );
}
