import type { ServerDraft } from "../lib/mcpServerDraft";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

/** Connection fields use the same draft and parser as the Astryx MCP form. */
export function nativeMcpServerEditor(options: {
  draft: ServerDraft;
  update: (patch: Partial<ServerDraft>) => void;
  allowStdio: boolean;
  browser: boolean;
  t: (key: string) => string;
  title: string;
  subtitle: string;
  submitLabel: string;
  error: string | null;
  close: () => void;
  submit: () => void;
}) {
  const { draft, update, allowStdio, browser, t } = options;
  const c = presentationControls();
  c.handlers.set("close", {
    enabled: true,
    accepts: (value) => value === null,
    run: options.close,
  });
  const input = (
    field: keyof ServerDraft,
    label: string,
    placeholder = "",
    description?: string,
    multiline = false,
    enabled = true,
  ): PresentationNode => ({
    ...c.input(
      `mcp-editor-${field}`,
      t(label),
      draft[field],
      (value) => update({ [field]: value }),
      false,
      enabled,
    ),
    kind: multiline ? "TextArea" : "TextInput",
    text: placeholder,
    accessibilityHint: description ? t(description) : undefined,
    ...(multiline ? { language: "text", minHeight: 112 } : {}),
  });
  const fields: PresentationNode[] = [
    {
      id: "mcp-editor-general",
      kind: "VStack",
      variant: "mcp-connection-fields",
      children: [
        input(
          "id",
          "mcpHub.serverName",
          t("mcpHub.serverNamePlaceholder"),
          "mcpHub.serverNameHint",
        ),
        c.select(
          "mcp-editor-transport",
          t("mcpHub.transport"),
          draft.transport,
          [
            ...(allowStdio ? [{ value: "stdio", label: t("mcpHub.stdio") }] : []),
            { value: "http", label: t("mcpHub.http") },
            { value: "sse", label: t("mcpHub.sse") },
          ],
          (transport) => update({ transport: transport as ServerDraft["transport"] }),
        ),
        input("timeoutMs", "mcpHub.timeout", "60000"),
      ],
    },
    ...(!allowStdio
      ? [
          {
            id: "mcp-editor-network-only",
            kind: "Banner" as const,
            status: "paused" as const,
            label: t("mcpHub.mobileNetworkOnly"),
          },
        ]
      : []),
    ...(draft.transport === "stdio"
      ? [
          {
            id: "mcp-editor-process",
            kind: "VStack" as const,
            variant: "mcp-connection-fields",
            children: [
              input("command", "mcpHub.command", "npx"),
              input("cwd", "mcpHub.cwd", t("mcpHub.cwdDefault")),
            ],
          },
          input(
            "argsText",
            "mcpHub.args",
            "-y\n@modelcontextprotocol/server-time",
            undefined,
            true,
          ),
          input(
            "envText",
            "mcpHub.env",
            "BRAVE_API_KEY=...\nHTTP_PROXY=...",
            undefined,
            true,
            !browser,
          ),
        ]
      : [
          input(
            "url",
            draft.transport === "http" ? "mcpHub.urlHttp" : "mcpHub.urlSse",
            draft.transport === "http" ? "http://127.0.0.1:3000/mcp" : "http://127.0.0.1:3000/sse",
          ),
          ...(draft.transport === "sse"
            ? [input("messageUrl", "mcpHub.messageUrl", "http://127.0.0.1:3000/message")]
            : []),
          input(
            "headersText",
            "mcpHub.headers",
            "Authorization=Bearer ...\nX-API-Key=...",
            undefined,
            true,
            !browser,
          ),
        ]),
    ...(options.error
      ? [
          {
            id: "mcp-editor-error",
            kind: "Banner" as const,
            label: options.error,
            status: "error" as const,
          },
        ]
      : []),
  ];
  return {
    handlers: c.handlers,
    nodes: [
      {
        id: "mcp-server-editor",
        kind: "VStack" as const,
        variant: "mcp-server-editor",
        fill: true,
        children: [
          { id: "mcp-editor-title", kind: "Heading" as const, text: options.title },
          {
            id: "mcp-editor-subtitle",
            kind: "Text" as const,
            text: options.subtitle,
            secondary: true,
          },
          { id: "mcp-editor-fields", kind: "ScrollView" as const, fill: true, children: fields },
          {
            id: "mcp-editor-footer",
            kind: "VStack" as const,
            variant: "mcp-editor-footer",
            children: [
              c.action("mcp-editor-cancel", t("settings.cancel"), options.close),
              {
                ...c.action("mcp-editor-save", options.submitLabel, options.submit),
                prominent: true,
              },
            ],
          },
        ],
      },
    ],
  };
}
