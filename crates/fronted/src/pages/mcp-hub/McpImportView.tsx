import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Section, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Folder, Globe2, Server, Terminal } from "../../components/icons";
import { useLocale } from "../../i18n";
import { type AppSettings, type McpServerConfig, updateMcp } from "../../lib/settings";
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePicking, setFilePicking] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<string>("claude-code");
  const userChoseToolRef = useRef(false);

  const allScans = useMemo(
    () => (fileScan ? [...(scans ?? []), fileScan] : (scans ?? [])),
    [fileScan, scans],
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
      setSelected((previous) => {
        const valid = new Set(
          result.flatMap((scan) =>
            scan.servers.map((server) => externalServerKey(scan.tool, server)),
          ),
        );
        const next = new Set(
          [...previous].filter((key) => valid.has(key) || key.startsWith(`${LOCAL_FILE_TOOL}:`)),
        );
        return next.size === previous.size ? previous : next;
      });
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scans === null && !loading) void rescan();
  }, [loading, rescan, scans]);

  useEffect(() => {
    if (userChoseToolRef.current || !scans || scans.length === 0) return;
    const preferred =
      scans.find((scan) => scan.servers.length > 0) ??
      scans.find((scan) => scan.exists) ??
      scans[0];
    if (preferred && preferred.tool !== activeTool) setActiveTool(preferred.tool);
  }, [activeTool, scans]);

  const scanSelectedFile = useCallback(async (file: File) => {
    setFileError(null);
    setFilePicking(true);
    try {
      if (file.size > MAX_MCP_CONFIG_FILE_BYTES) {
        throw new Error(`File is larger than ${MAX_MCP_CONFIG_FILE_BYTES / 1024 / 1024} MiB`);
      }
      const scan = await scanMcpConfigContent(file.name, await file.text());
      setSelected((previous) => {
        const next = new Set([...previous].filter((key) => !key.startsWith(`${LOCAL_FILE_TOOL}:`)));
        return next.size === previous.size ? previous : next;
      });
      setFileScan(scan);
      userChoseToolRef.current = true;
      setActiveTool(LOCAL_FILE_TOOL);
    } catch (scanError) {
      setFileError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setFilePicking(false);
      setSelectedFile(null);
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
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllActive() {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const server of importableInActive) {
        const key = externalServerKey(activeTool, server);
        if (allActiveSelected) next.delete(key);
        else next.add(key);
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
    setSettings((previous) => {
      const existing = new Set(
        previous.mcp.servers.map((server) => server.id.trim().toLowerCase()),
      );
      const fresh: McpServerConfig[] = [];
      for (const entry of targets) {
        const id = entry.id.trim().toLowerCase();
        if (!id || existing.has(id)) continue;
        existing.add(id);
        fresh.push(toMcpServerConfig(entry));
      }
      added = fresh.length;
      return fresh.length === 0
        ? previous
        : updateMcp(previous, { servers: [...previous.mcp.servers, ...fresh] });
    });
    setSelected(new Set());
    setImportedCount(added);
  }

  return (
    <VStack height="100%" minHeight={0} gap={3}>
      {error ? (
        <Banner
          status="error"
          title={t("mcpHub.importScanFailed")}
          description={error}
          collapsible={false}
        />
      ) : null}
      {!allowStdio ? (
        <Banner status="warning" title={t("mcpHub.mobileNetworkOnly")} collapsible={false} />
      ) : null}
      {fileError ? (
        <Banner
          status="error"
          title={t("mcpHub.importFileFailed")}
          description={fileError}
          collapsible={false}
        />
      ) : null}
      {importedCount !== null && importedCount > 0 ? (
        <Banner
          status="success"
          title={t("mcpHub.importDone").replace("{count}", String(importedCount))}
          collapsible={false}
        />
      ) : null}

      {loading && !scans ? (
        <Spinner size="md" label={t("mcpHub.importScanning")} />
      ) : (
        <>
          <VStack width="100%" gap={2}>
            <TabList
              value={activeTool}
              overflow="scroll"
              onChange={(value) => {
                userChoseToolRef.current = true;
                setActiveTool(String(value));
              }}
            >
              {allScans.map((scan) => {
                const localFile = scan.tool === LOCAL_FILE_TOOL;
                return (
                  <Tab
                    key={scan.tool}
                    value={scan.tool}
                    panelId={`mcp-import-${scan.tool}`}
                    label={
                      localFile
                        ? fileScanLabel(scan, t("mcpHub.importFileTab"))
                        : (EXTERNAL_MCP_TOOL_LABELS[scan.tool] ?? scan.tool)
                    }
                    icon={<Icon icon={localFile ? FileText : Folder} size="sm" color="inherit" />}
                    endContent={
                      scan.exists ? (
                        <Token label={String(scan.servers.length)} size="sm" />
                      ) : undefined
                    }
                  />
                );
              })}
            </TabList>
            <FileInput
              label={t("mcpHub.importFromFile")}
              isLabelHidden
              mode="input"
              width="100%"
              value={selectedFile}
              accept=".json,.toml,application/json,text/plain"
              maxSize={MAX_MCP_CONFIG_FILE_BYTES}
              isLoading={filePicking}
              isDisabled={filePicking || loading}
              placeholder={t("mcpHub.importFromFileHint")}
              onChange={(files) => {
                const file = Array.isArray(files) ? files[0] : files;
                setSelectedFile(file ?? null);
                if (file) void scanSelectedFile(file);
              }}
            />
            <Grid columns={{ minWidth: 140, max: 2, repeat: "fit" }} gap={2} width="100%">
              <Button
                label={t("mcpHub.importRescan")}
                variant="secondary"
                size="sm"
                width="100%"
                isLoading={loading}
                isDisabled={loading}
                onClick={() => void rescan()}
              />
              <Button
                label={`${t("mcpHub.importButton")}${selected.size > 0 ? ` (${selected.size})` : ""}`}
                variant="primary"
                size="sm"
                width="100%"
                isDisabled={selected.size === 0 || loading}
                onClick={importSelected}
              />
            </Grid>
          </VStack>

          {activeScan ? (
            <Section
              id={`mcp-import-${activeScan.tool}`}
              role="tabpanel"
              variant="transparent"
              padding={0}
              height="100%"
            >
              <VStack height="100%" minHeight={0} gap={2}>
                <HStack width="100%" gap={2} hAlign="between" vAlign="center" wrap="wrap">
                  <VStack gap={0.5}>
                    <Text type="code" color="secondary" wordBreak="break-all">
                      {activeScan.configPath}
                    </Text>
                    {activeScan.errors.length > 0 ? (
                      <Text type="supporting" color="secondary">
                        {t("mcpHub.importUnparsable").replace(
                          "{count}",
                          String(activeScan.errors.length),
                        )}
                      </Text>
                    ) : null}
                  </VStack>
                  {importableInActive.length > 0 ? (
                    <CheckboxInput
                      label={t("mcpHub.importSelectedCount")
                        .replace("{selected}", String(selectedInActive))
                        .replace("{total}", String(importableInActive.length))}
                      value={allActiveSelected}
                      onChange={toggleAllActive}
                      size="sm"
                    />
                  ) : null}
                </HStack>

                {!activeScan.exists ? (
                  <EmptyState
                    title={t("mcpHub.importNotDetected")}
                    description={activeScan.configPath}
                    icon={<Icon icon={Folder} size="lg" color="secondary" />}
                    isCompact
                  />
                ) : activeScan.servers.length === 0 ? (
                  <EmptyState
                    title={t("mcpHub.importEmpty")}
                    icon={<Icon icon={Server} size="lg" color="secondary" />}
                    isCompact
                  />
                ) : (
                  <StackItem size="fill" isScrollable>
                    <List density="balanced" hasDividers>
                      {activeScan.servers.map((server) => {
                        const key = externalServerKey(activeScan.tool, server);
                        const alreadyImported = installedIds.has(server.id.trim().toLowerCase());
                        const unsupported = !allowStdio && server.transport === "stdio";
                        const checked = selected.has(key);
                        const preview =
                          server.transport === "stdio"
                            ? [server.command, ...server.args].join(" ")
                            : server.url;
                        const metadata = [
                          server.args.length > 0 ? `args ${server.args.length}` : null,
                          Object.keys(server.env).length > 0
                            ? `env ${Object.keys(server.env).length}`
                            : null,
                          Object.keys(server.headers).length > 0
                            ? `headers ${Object.keys(server.headers).length}`
                            : null,
                        ].filter((value): value is string => Boolean(value));
                        return (
                          <ListItem
                            key={key}
                            label={server.id}
                            startContent={
                              <Icon
                                icon={server.transport === "stdio" ? Terminal : Globe2}
                                size="md"
                                color={checked ? "accent" : "secondary"}
                              />
                            }
                            description={
                              <VStack gap={1}>
                                <Text type="code" color="secondary" maxLines={1}>
                                  {preview}
                                </Text>
                                <HStack gap={1} wrap="wrap">
                                  <Token label={server.transport.toUpperCase()} size="sm" />
                                  {server.origin !== "user" ? (
                                    <Token label={t("mcpHub.importOriginProject")} size="sm" />
                                  ) : null}
                                  {metadata.map((value) => (
                                    <Token key={value} label={value} size="sm" />
                                  ))}
                                </HStack>
                              </VStack>
                            }
                            endContent={
                              alreadyImported ? (
                                <StatusDot
                                  variant="success"
                                  label={t("mcpHub.importAlreadyImported")}
                                />
                              ) : unsupported ? (
                                <Token label={t("mcpHub.mobileNetworkOnly")} size="sm" />
                              ) : (
                                <CheckboxInput
                                  label={server.id}
                                  isLabelHidden
                                  value={checked}
                                  onChange={() => toggleServer(activeScan.tool, server)}
                                  size="sm"
                                />
                              )
                            }
                          />
                        );
                      })}
                    </List>
                  </StackItem>
                )}
              </VStack>
            </Section>
          ) : null}
        </>
      )}
    </VStack>
  );
}
