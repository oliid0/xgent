import type { ExternalMcpServerEntry, ExternalMcpToolScan } from "../lib/skills";
import { presentationControls } from "./controls";
import { decodeNativeFiles } from "./nativeFiles";
import type { PresentationNode } from "./types";

export function nativeMcpImport(options: {
  t: (key: string) => string;
  scans: ExternalMcpToolScan[];
  activeScan: ExternalMcpToolScan | undefined;
  activeTool: string;
  sourceLabel: (scan: ExternalMcpToolScan) => string;
  chooseSource: (tool: string) => void;
  error: string | null;
  fileError: string | null;
  importedCount: number | null;
  loading: boolean;
  filePicking: boolean;
  installedIds: Set<string>;
  allowStdio: boolean;
  selected: ReadonlySet<string>;
  selectedInActive: number;
  importableCount: number;
  allActiveSelected: boolean;
  toggleAllActive: () => void;
  toggleServer: (tool: string, server: ExternalMcpServerEntry) => void;
  rescan: () => Promise<void>;
  importSelected: () => void;
  pickFile: (file: File) => Promise<void>;
  onChangeView?: (view: "installed" | "store" | "import") => void;
  onOpenSidebar?: () => void;
}) {
  const { t, activeScan, installedIds, allowStdio } = options;
  const c = presentationControls();
  if (options.onOpenSidebar)
    c.handlers.set("close", {
      enabled: true,
      accepts: (value) => value === null,
      run: options.onOpenSidebar,
    });
  const picker = c.input(
    "mcp-import-file",
    t("mcpHub.importFromFile"),
    "",
    async (payload) => {
      const files = decodeNativeFiles(payload);
      if (files.length !== 1) throw new Error(t("mcpHub.importFromFileHint"));
      await options.pickFile(files[0]);
    },
    false,
    !options.loading && !options.filePicking,
  );
  const rows: PresentationNode[] = (activeScan?.servers ?? []).map((server) => {
    const key = `${activeScan!.tool}:${server.id.toLowerCase()}`;
    const id = `mcp-import:${key}`;
    const imported = installedIds.has(server.id.trim().toLowerCase());
    const unsupported = !allowStdio && server.transport === "stdio";
    const tags = [
      server.transport.toUpperCase(),
      ...(server.origin !== "user" ? [t("mcpHub.importOriginProject")] : []),
      ...(server.args.length ? [`${t("mcpHub.previewArgs")} ${server.args.length}`] : []),
      ...(Object.keys(server.env).length
        ? [`${t("mcpHub.previewEnv")} ${Object.keys(server.env).length}`]
        : []),
      ...(Object.keys(server.headers).length
        ? [`${t("mcpHub.previewHeaders")} ${Object.keys(server.headers).length}`]
        : []),
    ];
    return {
      id,
      kind: "VStack",
      variant: "mcp-import-row",
      label: server.id,
      children: [
        {
          id: `${id}:metadata`,
          kind: "VStack",
          variant: "mcp-server-metadata",
          children: tags.map((label, i) => ({ id: `${id}:tag:${i}`, kind: "Badge", label })),
        },
        {
          id: `${id}:preview`,
          kind: "Text",
          secondary: true,
          maxLines: 2,
          text:
            server.transport === "stdio" ? [server.command, ...server.args].join(" ") : server.url,
        },
        ...(imported || unsupported
          ? [
              {
                id: `${id}:status`,
                kind: "Badge" as const,
                label: t(imported ? "mcpHub.importAlreadyImported" : "mcpHub.mobileNetworkOnly"),
              },
            ]
          : [
              c.toggle(`${id}:selected`, server.id, options.selected.has(key), () =>
                options.toggleServer(activeScan!.tool, server),
              ),
            ]),
      ],
    };
  });
  const nodes: PresentationNode[] = [
    ...(options.onOpenSidebar
      ? [
          {
            ...c.action("mcp-import-sidebar", t("tooltip.openSidebar"), options.onOpenSidebar),
            kind: "IconButton" as const,
            icon: "xgent.sidebar",
          },
        ]
      : []),
    { id: "mcp-import-heading", kind: "Heading", text: t("mcpHub.title") },
    ...(options.onChangeView
      ? [
          {
            ...c.select(
              "mcp-view",
              t("mcpHub.title"),
              "import",
              ["installed", "store", "import"].map((value) => ({
                value,
                label: t(`mcpHub.tab${value[0].toUpperCase()}${value.slice(1)}`),
              })),
              (value) => options.onChangeView!(value as "installed" | "store" | "import"),
            ),
            kind: "SegmentedControl" as const,
          },
        ]
      : []),
    ...(options.error
      ? [
          {
            id: "mcp-import-scan-error",
            kind: "Banner" as const,
            status: "error" as const,
            label: t("mcpHub.importScanFailed"),
            text: options.error,
          },
        ]
      : []),
    ...(options.fileError
      ? [
          {
            id: "mcp-import-file-error",
            kind: "Banner" as const,
            status: "error" as const,
            label: t("mcpHub.importFileFailed"),
            text: options.fileError,
          },
        ]
      : []),
    ...(!allowStdio
      ? [
          {
            id: "mcp-import-network-only",
            kind: "Banner" as const,
            status: "paused" as const,
            label: t("mcpHub.mobileNetworkOnly"),
          },
        ]
      : []),
    ...(options.importedCount !== null && options.importedCount > 0
      ? [
          {
            id: "mcp-import-done",
            kind: "Banner" as const,
            status: "completed" as const,
            label: t("mcpHub.importDone").replace("{count}", String(options.importedCount)),
          },
        ]
      : []),
    ...(options.scans.length
      ? [
          c.select(
            "mcp-import-source",
            t("mcpHub.tabImport"),
            options.activeTool,
            options.scans.map((scan) => ({
              value: scan.tool,
              label: `${options.sourceLabel(scan)}${scan.exists ? ` (${scan.servers.length})` : ""}`,
            })),
            options.chooseSource,
          ),
        ]
      : []),
    {
      ...picker,
      kind: "FilePicker",
      variant: "mcp-config",
      text: t("mcpHub.importFromFileHint"),
      options: [{ value: "files", label: t("mcpHub.importFromFile") }],
    },
    {
      id: "mcp-import-actions",
      kind: "VStack",
      variant: "mcp-editor-footer",
      children: [
        c.action("mcp-import-rescan", t("mcpHub.importRescan"), options.rescan, !options.loading),
        {
          ...c.action(
            "mcp-import-save",
            `${t("mcpHub.importButton")}${options.selected.size ? ` (${options.selected.size})` : ""}`,
            options.importSelected,
            options.selected.size > 0 && !options.loading && !options.filePicking,
          ),
          prominent: true,
        },
      ],
    },
    ...(options.loading || options.filePicking
      ? [{ id: "mcp-import-loading", kind: "Progress" as const, label: t("mcpHub.importScanning") }]
      : []),
    ...(activeScan
      ? [
          {
            id: "mcp-import-path",
            kind: "Text" as const,
            text: activeScan.configPath,
            secondary: true,
          },
          ...(activeScan.errors.length
            ? [
                {
                  id: "mcp-import-unparsable",
                  kind: "Banner" as const,
                  status: "paused" as const,
                  label: t("mcpHub.importUnparsable").replace(
                    "{count}",
                    String(activeScan.errors.length),
                  ),
                  text: activeScan.errors.join("\n"),
                },
              ]
            : []),
          ...(options.importableCount
            ? [
                c.toggle(
                  "mcp-import-select-all",
                  t("mcpHub.importSelectedCount")
                    .replace("{selected}", String(options.selectedInActive))
                    .replace("{total}", String(options.importableCount)),
                  options.allActiveSelected,
                  options.toggleAllActive,
                ),
              ]
            : []),
          {
            id: "mcp-import-results",
            kind: "ScrollView" as const,
            fill: true,
            children:
              !activeScan.exists || rows.length === 0
                ? [
                    {
                      id: "mcp-import-empty",
                      kind: "EmptyState" as const,
                      label: t(
                        !activeScan.exists ? "mcpHub.importNotDetected" : "mcpHub.importEmpty",
                      ),
                      text: !activeScan.exists ? activeScan.configPath : undefined,
                    },
                  ]
                : rows,
          },
        ]
      : []),
  ];
  return { nodes, handlers: c.handlers };
}
