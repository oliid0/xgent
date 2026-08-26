import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import {
  Inline as AstryxInline,
  Paragraph as AstryxParagraph,
  View as AstryxView,
} from "@xagent/ui/components/ui/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HubPanel, HubSegmentedButton, HubSegmentedControl } from "../../components/hub/HubChrome";
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  Folder,
  Globe2,
  Loader2,
  RefreshCw,
  Terminal,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import { type AppSettings, type McpServerConfig, updateMcp } from "../../lib/settings";
import { cn } from "../../lib/shared/utils";
import {
  type ExternalMcpServerEntry,
  type ExternalMcpToolScan,
  scanExternalMcpServers,
  scanMcpConfigContent,
} from "../../lib/skills";

const EXTERNAL_MCP_TOOL_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "claude-desktop": "Claude Desktop",
  codebuddy: "CodeBuddy",
};

/** 与后端 `LOCAL_FILE_MCP_TOOL` 对齐的「从文件导入」来源标识 */
const LOCAL_FILE_TOOL = "local-file";

const DEFAULT_IMPORT_TIMEOUT_MS = 60_000;
const MAX_MCP_CONFIG_FILE_BYTES = 16 * 1024 * 1024;

function fileScanLabel(scan: ExternalMcpToolScan, fallback: string) {
  const basename = scan.configPath.split(/[\\/]/).pop();
  return basename || fallback;
}

function externalServerKey(tool: string, server: ExternalMcpServerEntry) {
  return `${tool}:${server.id.toLowerCase()}`;
}

function toMcpServerConfig(entry: ExternalMcpServerEntry): McpServerConfig {
  const server: McpServerConfig = {
    id: entry.id.trim(),
    enabled: true,
    transport: entry.transport,
    command: entry.command,
    args: entry.args,
    url: entry.url,
    timeoutMs:
      typeof entry.timeoutMs === "number" && entry.timeoutMs > 0
        ? entry.timeoutMs
        : DEFAULT_IMPORT_TIMEOUT_MS,
  };
  if (Object.keys(entry.env).length > 0) server.env = entry.env;
  if (Object.keys(entry.headers).length > 0) server.headers = entry.headers;
  if (entry.cwd) server.cwd = entry.cwd;
  return server;
}

export function McpImportView(props: {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  allowStdio?: boolean;
}) {
  const { settings, setSettings, allowStdio = true } = props;
  const { t } = useLocale();

  const [scans, setScans] = useState<ExternalMcpToolScan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileScan, setFileScan] = useState<ExternalMcpToolScan | null>(null);
  const [filePicking, setFilePicking] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<string>("claude-code");
  const userChoseToolRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allScans = useMemo(
    () => (fileScan ? [...(scans ?? []), fileScan] : (scans ?? [])),
    [scans, fileScan],
  );

  const installedIds = useMemo(
    () => new Set(settings.mcp.servers.map((server) => server.id.trim().toLowerCase())),
    [settings.mcp.servers],
  );

  const rescan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await scanExternalMcpServers();
      setScans(result);
      // 清掉扫描结果中已不存在的选择项（「从文件导入」的选择项不受重扫影响）
      setSelected((prev) => {
        const valid = new Set(
          result.flatMap((scan) =>
            scan.servers.map((server) => externalServerKey(scan.tool, server)),
          ),
        );
        const next = new Set(
          [...prev].filter((key) => valid.has(key) || key.startsWith(`${LOCAL_FILE_TOOL}:`)),
        );
        return next.size === prev.size ? prev : next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scans === null && !loading) {
      void rescan();
    }
  }, [scans, loading, rescan]);

  // 扫描结果就绪后自动定位到第一个有配置的工具；用户手动切换后不再干预
  useEffect(() => {
    if (userChoseToolRef.current || !scans || scans.length === 0) return;
    const preferred =
      scans.find((scan) => scan.servers.length > 0) ??
      scans.find((scan) => scan.exists) ??
      scans[0];
    if (preferred && preferred.tool !== activeTool) {
      setActiveTool(preferred.tool);
    }
  }, [scans, activeTool]);

  const scanSelectedFile = useCallback(async (file: File) => {
    setFileError(null);
    setFilePicking(true);
    try {
      if (file.size > MAX_MCP_CONFIG_FILE_BYTES) {
        throw new Error(`File is larger than ${MAX_MCP_CONFIG_FILE_BYTES / 1024 / 1024} MiB`);
      }
      const scan = await scanMcpConfigContent(file.name, await file.text());
      // 换文件后清掉上一个文件遗留的选择项，避免按 id 误选到新文件的同名条目
      setSelected((prev) => {
        const next = new Set([...prev].filter((key) => !key.startsWith(`${LOCAL_FILE_TOOL}:`)));
        return next.size === prev.size ? prev : next;
      });
      setFileScan(scan);
      userChoseToolRef.current = true;
      setActiveTool(LOCAL_FILE_TOOL);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilePicking(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const activeScan = allScans.find((scan) => scan.tool === activeTool);
  const importableInActive = useMemo(
    () =>
      (activeScan?.servers ?? []).filter(
        (server) =>
          !installedIds.has(server.id.trim().toLowerCase()) &&
          (allowStdio || server.transport !== "stdio"),
      ),
    [activeScan, allowStdio, installedIds],
  );
  const selectedInActive = importableInActive.filter((server) =>
    selected.has(externalServerKey(activeTool, server)),
  ).length;
  const allActiveSelected =
    importableInActive.length > 0 && selectedInActive === importableInActive.length;

  function toggleServer(tool: string, server: ExternalMcpServerEntry) {
    if (!allowStdio && server.transport === "stdio") return;
    const key = externalServerKey(tool, server);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllActive() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allActiveSelected) {
        for (const server of importableInActive) {
          next.delete(externalServerKey(activeTool, server));
        }
      } else {
        for (const server of importableInActive) {
          next.add(externalServerKey(activeTool, server));
        }
      }
      return next;
    });
  }

  function importSelected() {
    const targets = allScans.flatMap((scan) =>
      scan.servers.filter(
        (server) =>
          selected.has(externalServerKey(scan.tool, server)) &&
          (allowStdio || server.transport !== "stdio"),
      ),
    );
    if (targets.length === 0) return;

    let added = 0;
    setSettings((prev) => {
      const existing = new Set(prev.mcp.servers.map((server) => server.id.trim().toLowerCase()));
      const fresh: McpServerConfig[] = [];
      for (const entry of targets) {
        const id = entry.id.trim().toLowerCase();
        if (!id || existing.has(id)) continue;
        existing.add(id);
        fresh.push(toMcpServerConfig(entry));
      }
      added = fresh.length;
      if (fresh.length === 0) return prev;
      return updateMcp(prev, { servers: [...prev.mcp.servers, ...fresh] });
    });
    setSelected(new Set());
    setImportedCount(added);
  }

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="h-full min-h-0 overflow-y-auto px-0.5 pb-4 pr-1 pt-1.5"
    >
      <AstryxView layout="flex" direction="vertical" className="flex flex-col gap-4">
        {error ? (
          <HubPanel tone="error" className="hub-panel-enter">
            <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <AstryxInline className="text-xs text-destructive">
                {t("mcpHub.importScanFailed")}: {error}
              </AstryxInline>
            </AstryxView>
          </HubPanel>
        ) : null}

        {!allowStdio ? (
          <HubPanel tone="muted" className="hub-panel-enter">
            <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <AstryxInline className="text-xs leading-5 text-muted-foreground">
                {t("mcpHub.mobileNetworkOnly")}
              </AstryxInline>
            </AstryxView>
          </HubPanel>
        ) : null}

        {fileError ? (
          <HubPanel tone="error" className="hub-panel-enter">
            <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <AstryxInline className="text-xs text-destructive">
                {t("mcpHub.importFileFailed")}: {fileError}
              </AstryxInline>
            </AstryxView>
          </HubPanel>
        ) : null}

        {importedCount !== null && importedCount > 0 ? (
          <HubPanel tone="muted" className="hub-panel-enter">
            <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-success" />
              <AstryxInline className="text-xs text-muted-foreground">
                {t("mcpHub.importDone").replace("{count}", String(importedCount))}
              </AstryxInline>
            </AstryxView>
          </HubPanel>
        ) : null}

        {loading && !scans ? (
          <HubPanel className="hub-panel-enter">
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-center gap-3 py-4"
            >
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <AstryxInline className="text-xs text-muted-foreground">
                {t("mcpHub.importScanning")}
              </AstryxInline>
            </AstryxView>
          </HubPanel>
        ) : (
          <>
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="hub-panel-enter flex flex-wrap items-center justify-between gap-3"
            >
              <HubSegmentedControl className="shrink-0 max-w-full overflow-x-auto">
                {allScans.map((scan) => {
                  const isLocalFile = scan.tool === LOCAL_FILE_TOOL;
                  const toolLabel = isLocalFile
                    ? fileScanLabel(scan, t("mcpHub.importFileTab"))
                    : (EXTERNAL_MCP_TOOL_LABELS[scan.tool] ?? scan.tool);
                  const active = scan.tool === activeTool;
                  return (
                    <HubSegmentedButton
                      key={scan.tool}
                      active={active}
                      title={isLocalFile ? scan.configPath : undefined}
                      onClick={() => {
                        userChoseToolRef.current = true;
                        setActiveTool(scan.tool);
                      }}
                      className="px-4"
                    >
                      {isLocalFile ? (
                        <FileText className="h-3.5 w-3.5" />
                      ) : (
                        <Folder className="h-3.5 w-3.5" />
                      )}
                      <AstryxInline className="max-w-[10rem] truncate">{toolLabel}</AstryxInline>
                      {scan.exists ? (
                        <AstryxView
                          as="span"
                          layout="inline-flex"
                          direction="horizontal"
                          className={cn(
                            "ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                            active
                              ? "bg-foreground/[0.08] text-foreground/85"
                              : "bg-muted/70 text-muted-foreground",
                          )}
                        >
                          {scan.servers.length}
                        </AstryxView>
                      ) : (
                        <AstryxInline className="ml-0.5 text-[10px] text-muted-foreground/70">
                          {t("mcpHub.importNotDetected")}
                        </AstryxInline>
                      )}
                    </HubSegmentedButton>
                  );
                })}
              </HubSegmentedControl>

              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex shrink-0 items-center gap-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.toml,application/json,text/plain"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void scanSelectedFile(file);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-full"
                  disabled={filePicking}
                  title={t("mcpHub.importFromFileHint")}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {filePicking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                  {t("mcpHub.importFromFile")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-full"
                  disabled={loading}
                  onClick={() => void rescan()}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                  {t("mcpHub.importRescan")}
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 rounded-full"
                  disabled={selected.size === 0 || loading}
                  onClick={importSelected}
                >
                  <Download className="h-3.5 w-3.5" />
                  {`${t("mcpHub.importButton")}${selected.size > 0 ? ` (${selected.size})` : ""}`}
                </Button>
              </AstryxView>
            </AstryxView>

            {activeScan ? (
              <AstryxView
                layout="flex"
                direction="vertical"
                key={activeScan.tool}
                className="hub-panel-enter flex flex-col gap-3"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                >
                  <AstryxParagraph className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/70">
                    <AstryxInline className="font-mono">{activeScan.configPath}</AstryxInline>
                    {activeScan.errors.length > 0 ? (
                      <>
                        <AstryxInline aria-hidden="true">·</AstryxInline>
                        <AstryxInline
                          className="cursor-help underline decoration-dotted underline-offset-2"
                          title={activeScan.errors.join("\n")}
                        >
                          {t("mcpHub.importUnparsable").replace(
                            "{count}",
                            String(activeScan.errors.length),
                          )}
                        </AstryxInline>
                      </>
                    ) : null}
                  </AstryxParagraph>
                  {importableInActive.length > 0 ? (
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex items-center gap-2 text-[11px] text-muted-foreground"
                    >
                      <AstryxInline className="tabular-nums">
                        {t("mcpHub.importSelectedCount")
                          .replace("{selected}", String(selectedInActive))
                          .replace("{total}", String(importableInActive.length))}
                      </AstryxInline>
                      <AstryxButton
                        type="button"
                        onClick={toggleAllActive}
                        className="rounded-full border border-border/45 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-background/90"
                      >
                        {allActiveSelected
                          ? t("mcpHub.importDeselectAll")
                          : t("mcpHub.importSelectAll")}
                      </AstryxButton>
                    </AstryxView>
                  ) : null}
                </AstryxView>

                {!activeScan.exists ? (
                  <HubPanel tone="muted">
                    <AstryxParagraph className="py-2 text-center text-xs text-muted-foreground">
                      {t("mcpHub.importNotDetected")} · {activeScan.configPath}
                    </AstryxParagraph>
                  </HubPanel>
                ) : activeScan.servers.length === 0 ? (
                  <HubPanel tone="muted">
                    <AstryxParagraph className="py-2 text-center text-xs text-muted-foreground">
                      {t("mcpHub.importEmpty")}
                    </AstryxParagraph>
                  </HubPanel>
                ) : (
                  <AstryxView
                    layout="grid"
                    direction="horizontal"
                    className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
                  >
                    {activeScan.servers.map((server) => {
                      const key = externalServerKey(activeScan.tool, server);
                      const alreadyImported = installedIds.has(server.id.trim().toLowerCase());
                      const unsupported = !allowStdio && server.transport === "stdio";
                      const checked = selected.has(key);
                      const isStdio = server.transport === "stdio";
                      const preview = isStdio
                        ? [server.command, ...server.args].join(" ")
                        : server.url;
                      const extras = [
                        server.args.length > 0 ? `args ${server.args.length}` : null,
                        Object.keys(server.env).length > 0
                          ? `env ${Object.keys(server.env).length}`
                          : null,
                        Object.keys(server.headers).length > 0
                          ? `headers ${Object.keys(server.headers).length}`
                          : null,
                      ].filter((item): item is string => Boolean(item));
                      return (
                        <AstryxButton
                          key={key}
                          type="button"
                          disabled={alreadyImported || unsupported}
                          onClick={() => toggleServer(activeScan.tool, server)}
                          className={cn(
                            "group flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all",
                            alreadyImported || unsupported
                              ? "cursor-not-allowed border-border/35 bg-muted/30 opacity-70"
                              : checked
                                ? "border-primary/60 bg-primary/5 shadow-sm shadow-primary/10"
                                : "border-border/40 bg-background/60 hover:border-border/70 hover:bg-background/85",
                          )}
                        >
                          <AstryxView
                            as="span"
                            layout="flex"
                            direction="horizontal"
                            className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                              checked && !alreadyImported
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border/70 bg-background",
                            )}
                          >
                            {checked && !alreadyImported ? <Check className="h-3 w-3" /> : null}
                          </AstryxView>
                          <AstryxInline className="min-w-0 flex-1">
                            <AstryxView
                              as="span"
                              layout="flex"
                              direction="horizontal"
                              className="flex flex-wrap items-center gap-1.5"
                            >
                              <AstryxInline className="truncate text-[13px] font-medium text-foreground">
                                {server.id}
                              </AstryxInline>
                              <AstryxView
                                as="span"
                                layout="inline-flex"
                                direction="horizontal"
                                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground"
                              >
                                {isStdio ? (
                                  <Terminal className="h-2.5 w-2.5" />
                                ) : (
                                  <Globe2 className="h-2.5 w-2.5" />
                                )}
                                {server.transport}
                              </AstryxView>
                              {server.origin !== "user" ? (
                                <AstryxView
                                  as="span"
                                  layout="inline-flex"
                                  direction="horizontal"
                                  className="inline-flex max-w-[10rem] shrink-0 items-center truncate rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                  title={server.origin}
                                >
                                  {t("mcpHub.importOriginProject")}
                                </AstryxView>
                              ) : null}
                              {alreadyImported ? (
                                <AstryxView
                                  as="span"
                                  layout="inline-flex"
                                  direction="horizontal"
                                  className="inline-flex shrink-0 items-center rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-foreground/70 ring-1 ring-border/45"
                                >
                                  {t("mcpHub.importAlreadyImported")}
                                </AstryxView>
                              ) : null}
                              {unsupported ? (
                                <AstryxView
                                  as="span"
                                  layout="inline-flex"
                                  direction="horizontal"
                                  className="inline-flex shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                >
                                  {t("mcpHub.mobileNetworkOnly")}
                                </AstryxView>
                              ) : null}
                            </AstryxView>
                            <AstryxInline className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                              {preview}
                            </AstryxInline>
                            {extras.length > 0 ? (
                              <AstryxView
                                as="span"
                                layout="flex"
                                direction="horizontal"
                                className="mt-1 flex flex-wrap gap-1"
                              >
                                {extras.map((extra) => (
                                  <AstryxInline
                                    key={extra}
                                    className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
                                  >
                                    {extra}
                                  </AstryxInline>
                                ))}
                              </AstryxView>
                            ) : null}
                          </AstryxInline>
                        </AstryxButton>
                      );
                    })}
                  </AstryxView>
                )}
              </AstryxView>
            ) : null}
          </>
        )}
      </AstryxView>
    </AstryxView>
  );
}
