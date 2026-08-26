import { isBrowserRuntime } from "@xagent/runtime";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Input as AstryxInput } from "@xagent/ui/components/ui/input";
import {
  Heading as AstryxHeading,
  Inline as AstryxInline,
  Paragraph as AstryxParagraph,
  View as AstryxView,
} from "@xagent/ui/components/ui/view";
import { type FormEvent, memo, useEffect, useMemo, useState } from "react";
import { ToolPolicyToggle } from "../../components/hub/ToolPolicyToggle";
import {
  AlertTriangle,
  Globe2,
  Pencil,
  Plug,
  Plus,
  Search,
  Server,
  Terminal,
  Trash2,
  Wifi,
  X,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { ConfirmDeletePopover } from "../../components/ui/confirm-action-popover";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useLocale } from "../../i18n";
import {
  type AppSettings,
  type McpServerConfig,
  type ToolPolicy,
  updateMcp,
  updateSystem,
} from "../../lib/settings";
import { cn } from "../../lib/shared/utils";
import { toolGroupPolicyKey, toolServerPolicyKey } from "../../lib/tools/toolPolicy";
import { SettingsModalShell } from "../settings/SettingsModalShell";

type SetMcpSettingsFn = (updater: (prev: AppSettings) => AppSettings) => void;

type McpServersFormProps = {
  settings: AppSettings;
  setSettings: SetMcpSettingsFn;
  onAddServer?: () => void;
  onEditServer?: (server: McpServerConfig, idx: number) => void;
};

type ServerDraft = {
  id: string;
  transport: McpServerConfig["transport"];
  timeoutMs: string;
  command: string;
  cwd: string;
  argsText: string;
  envText: string;
  url: string;
  messageUrl: string;
  headersText: string;
};

function formatKeyValueRecord(input: Record<string, string> | undefined) {
  return input
    ? Object.entries(input)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")
    : "";
}

function parseLineList(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueDraft(input: string, errorPrefix: string) {
  const out: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`${errorPrefix}${trimmed}`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) {
      throw new Error(`${errorPrefix}${trimmed}`);
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function suggestServerName(existing: string[]): string {
  const taken = new Set(existing.map((id) => id.trim()).filter(Boolean));
  let idx = existing.length + 1;
  let name = `MCP Server ${idx}`;
  while (taken.has(name)) {
    idx += 1;
    name = `MCP Server ${idx}`;
  }
  return name;
}

function blankDraft(existingIds: string[]): ServerDraft {
  return {
    id: suggestServerName(existingIds),
    transport: "stdio",
    timeoutMs: "60000",
    command: "",
    cwd: "",
    argsText: "",
    envText: "",
    url: "",
    messageUrl: "",
    headersText: "",
  };
}

function draftFromServer(server: McpServerConfig): ServerDraft {
  const transport: McpServerConfig["transport"] = server.transport ?? "stdio";
  return {
    id: server.id,
    transport,
    timeoutMs: String(server.timeoutMs ?? 60_000),
    command: server.command ?? "",
    cwd: server.cwd ?? "",
    argsText: (server.args ?? []).join("\n"),
    envText: formatKeyValueRecord(server.env),
    url: server.url ?? "",
    messageUrl: server.messageUrl ?? "",
    headersText: formatKeyValueRecord(server.headers),
  };
}

function buildServerFromDraft(
  draft: ServerDraft,
  base: McpServerConfig | null,
  existingIds: string[],
  t: (key: string) => string,
): McpServerConfig {
  const id = draft.id.trim();
  if (!id) {
    throw new Error(t("mcpHub.invalidName"));
  }
  if (existingIds.includes(id)) {
    throw new Error(t("mcpHub.duplicateName"));
  }

  const parsedTimeout = Number(draft.timeoutMs);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? Math.floor(parsedTimeout) : 60_000;

  if (draft.transport === "stdio") {
    const command = draft.command.trim();
    if (!command) {
      throw new Error(t("mcpHub.invalidCommand"));
    }
    return {
      ...(base ?? {}),
      id,
      enabled: base?.enabled ?? true,
      transport: "stdio",
      command,
      args: parseLineList(draft.argsText),
      cwd: draft.cwd.trim() || undefined,
      env: parseKeyValueDraft(draft.envText, `${t("mcpHub.invalidKeyValue")} `),
      url: "",
      messageUrl: undefined,
      headers: undefined,
      timeoutMs,
    };
  }

  const url = draft.url.trim();
  if (!url) {
    throw new Error(t("mcpHub.invalidUrl"));
  }
  return {
    ...(base ?? {}),
    id,
    enabled: base?.enabled ?? true,
    transport: draft.transport,
    command: "",
    args: [],
    url,
    messageUrl: draft.transport === "sse" ? draft.messageUrl.trim() || undefined : undefined,
    headers: parseKeyValueDraft(draft.headersText, `${t("mcpHub.invalidKeyValue")} `),
    cwd: undefined,
    env: undefined,
    timeoutMs,
  };
}

function transportMeta(transport: string) {
  // Transport badges stay subtly differentiated; using neutral tints to keep the macOS frosted look.
  if (transport === "http") {
    return {
      label: "http",
      tone: "bg-background/70 text-foreground/75 ring-border/45",
      Icon: Globe2,
    } as const;
  }
  if (transport === "sse") {
    return {
      label: "sse",
      tone: "bg-background/70 text-foreground/75 ring-border/45",
      Icon: Wifi,
    } as const;
  }
  return {
    label: "stdio",
    tone: "bg-background/70 text-foreground/75 ring-border/45",
    Icon: Terminal,
  } as const;
}

function CounterPill(props: { label: string; count: number }) {
  return (
    <AstryxView
      as="span"
      layout="inline-flex"
      direction="horizontal"
      className="inline-flex items-center gap-1 rounded-full bg-muted/55 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border/40"
    >
      <AstryxInline className="font-semibold text-foreground/85 tabular-nums">
        {props.count}
      </AstryxInline>
      <AstryxInline className="opacity-70">{props.label}</AstryxInline>
    </AstryxView>
  );
}

const McpServerCard = memo(function McpServerCard(props: {
  server: McpServerConfig;
  idx: number;
  policy: ToolPolicy;
  setSettings: SetMcpSettingsFn;
  onEdit: () => void;
}) {
  const { server: serverConfig, idx, policy, setSettings, onEdit } = props;
  const { t } = useLocale();
  const transport = serverConfig.transport || "stdio";
  const isStdio = transport === "stdio";
  const isHttp = transport === "http";
  const meta = transportMeta(transport);
  const MetaIcon = meta.Icon;
  const enabled = serverConfig.enabled;

  const patchServer = (patch: Partial<McpServerConfig>) => {
    setSettings((prev) =>
      updateMcp(prev, {
        servers: prev.mcp.servers.map((item, index) =>
          index === idx ? { ...item, ...patch } : item,
        ),
      }),
    );
  };

  const argsCount = (serverConfig.args ?? []).filter(Boolean).length;
  const envCount = serverConfig.env ? Object.keys(serverConfig.env).length : 0;
  const headerCount = serverConfig.headers ? Object.keys(serverConfig.headers).length : 0;
  const previewLine = isStdio
    ? [serverConfig.command, ...(serverConfig.args ?? [])].filter(Boolean).join(" ")
    : serverConfig.url || "";
  const previewLabel = isStdio
    ? t("mcpHub.command")
    : isHttp
      ? t("mcpHub.urlHttp")
      : t("mcpHub.urlSse");

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className={cn(
        "mcp-server-card skill-card-enter group rounded-2xl border backdrop-blur-xl transition-[border-color,background-color,box-shadow] duration-150",
        enabled
          ? "border-border/55 bg-background/80 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset,0_4px_18px_-12px_rgba(15,23,42,0.16)] dark:border-white/[0.10] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_4px_18px_-12px_rgba(0,0,0,0.5)]"
          : "border-border/40 bg-background/55 hover:border-border/55 hover:bg-background/70 dark:border-white/[0.05] dark:bg-white/[0.03] dark:hover:border-white/[0.10] dark:hover:bg-white/[0.06]",
      )}
    >
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="mcp-server-card-row flex items-center gap-3 px-4 py-3"
      >
        {/* Toggle */}
        <AstryxButton
          type="button"
          title={enabled ? t("settings.disable") : t("settings.enable")}
          onClick={() => patchServer({ enabled: !enabled })}
          className={cn(
            "mcp-server-toggle",
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ring-1 transition-colors",
            enabled
              ? "bg-foreground/80 ring-foreground/30 shadow-[0_2px_8px_-3px_rgba(15,23,42,0.4)] dark:shadow-[0_2px_8px_-3px_rgba(0,0,0,0.6)]"
              : "bg-muted-foreground/25 ring-border/40",
          )}
        >
          <AstryxInline
            className={cn(
              "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
              enabled ? "translate-x-[1.05rem]" : "translate-x-[0.125rem]",
            )}
          />
        </AstryxButton>

        {/* Clickable body */}
        <AstryxButton
          type="button"
          onClick={onEdit}
          title={t("settings.edit")}
          className="mcp-server-body flex min-w-0 flex-1 items-center gap-3 text-left outline-hidden"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all",
              enabled
                ? "border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
                : "border-border/40 bg-muted/45 text-muted-foreground group-hover:border-border/55 group-hover:bg-background/70 group-hover:text-foreground/85",
            )}
          >
            <MetaIcon className="h-[18px] w-[18px]" />
          </AstryxView>

          <AstryxView
            layout="flex"
            direction="vertical"
            className="flex min-w-0 flex-1 flex-col gap-0.5"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex min-w-0 items-center gap-2"
            >
              <AstryxInline
                className={cn(
                  "truncate text-[13px] font-semibold leading-tight",
                  enabled ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {serverConfig.id || `Server ${idx + 1}`}
              </AstryxInline>
              <AstryxView
                as="span"
                layout="inline-flex"
                direction="horizontal"
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1",
                  meta.tone,
                )}
              >
                {meta.label}
              </AstryxView>
            </AstryxView>
            {previewLine ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="truncate text-[11px] text-muted-foreground/85"
                title={previewLine}
              >
                <AstryxInline className="text-muted-foreground/55">{previewLabel}:</AstryxInline>{" "}
                <AstryxInline className="font-mono">{previewLine}</AstryxInline>
              </AstryxView>
            ) : (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="truncate text-[11px] italic text-muted-foreground/55"
              >
                {isStdio ? "未配置启动命令" : "未配置 URL"}
              </AstryxView>
            )}
          </AstryxView>
        </AstryxButton>

        {/* Counters (≥md) */}
        {argsCount > 0 || envCount > 0 || headerCount > 0 ? (
          <AstryxView
            layout="block"
            direction="horizontal"
            className="hidden shrink-0 items-center gap-1 md:flex"
          >
            {argsCount > 0 ? (
              <CounterPill label={t("mcpHub.previewArgs")} count={argsCount} />
            ) : null}
            {envCount > 0 ? <CounterPill label={t("mcpHub.previewEnv")} count={envCount} /> : null}
            {headerCount > 0 ? (
              <CounterPill label={t("mcpHub.previewHeaders")} count={headerCount} />
            ) : null}
          </AstryxView>
        ) : null}

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="mcp-server-actions flex shrink-0 items-center gap-1"
        >
          <ToolPolicyToggle
            value={policy}
            size="sm"
            ariaLabel={`${serverConfig.id} tool policy`}
            onChange={(next) =>
              setSettings((current) =>
                updateSystem(current, {
                  toolPolicies: {
                    ...(current.system.toolPolicies ?? {}),
                    [toolServerPolicyKey(serverConfig.id)]: next,
                  },
                }),
              )
            }
          />
          <AstryxButton
            type="button"
            onClick={onEdit}
            title={t("settings.edit")}
            className="mcp-server-action rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </AstryxButton>
          <ConfirmDeletePopover
            name={serverConfig.id || `Server ${idx + 1}`}
            onConfirm={() =>
              setSettings((prev) => {
                const next = updateMcp(prev, {
                  servers: prev.mcp.servers.filter((_, index) => index !== idx),
                });
                const toolPolicies = { ...(next.system.toolPolicies ?? {}) };
                delete toolPolicies[toolServerPolicyKey(serverConfig.id)];
                return updateSystem(next, { toolPolicies });
              })
            }
          >
            {(open) => (
              <AstryxButton
                type="button"
                onClick={open}
                className="mcp-server-action rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title={t("settings.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </AstryxButton>
            )}
          </ConfirmDeletePopover>
        </AstryxView>
      </AstryxView>
    </AstryxView>
  );
});

export function McpServerEditModal(props: {
  mode: "add" | "edit";
  initialServer: McpServerConfig | null;
  existingServers: McpServerConfig[];
  allowStdio?: boolean;
  onClose: () => void;
  onSave: (server: McpServerConfig) => void;
}) {
  const { mode, initialServer, existingServers, allowStdio = true, onClose, onSave } = props;
  const { t } = useLocale();
  const browser = isBrowserRuntime();

  const existingIdsExcludingCurrent = useMemo(() => {
    return existingServers
      .filter((server) => mode !== "edit" || server.id !== initialServer?.id)
      .map((server) => server.id);
  }, [existingServers, initialServer, mode]);

  const createInitialDraft = () => {
    const next = initialServer
      ? draftFromServer(initialServer)
      : blankDraft(existingIdsExcludingCurrent);
    return !allowStdio && !initialServer ? { ...next, transport: "http" as const } : next;
  };
  const [draft, setDraft] = useState<ServerDraft>(createInitialDraft);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(createInitialDraft());
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowStdio, initialServer]);

  function updateDraft(patch: Partial<ServerDraft>) {
    setFormError(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    try {
      if (!allowStdio && draft.transport === "stdio") {
        throw new Error(t("mcpHub.mobileNetworkOnly"));
      }
      const server = buildServerFromDraft(draft, initialServer, existingIdsExcludingCurrent, t);
      onSave(server);
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  const isStdio = draft.transport === "stdio";
  const isSse = draft.transport === "sse";
  const title = mode === "add" ? t("mcpHub.addTitle") : t("mcpHub.editTitle");
  const subtitleRaw =
    mode === "add"
      ? t("mcpHub.addSubtitle")
      : t("mcpHub.editSubtitle").replace("{name}", initialServer?.id ?? "");
  const submitLabel = mode === "add" ? t("mcpHub.modalAdd") : t("mcpHub.modalSave");

  return (
    <SettingsModalShell onClose={onClose} purpose="form" ariaLabel={title}>
      <AstryxView
        as="form"
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-modal-header flex items-center gap-3 border-b border-border/40 px-6 py-4"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
          >
            <Plug className="h-5 w-5" />
          </AstryxView>
          <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
            <AstryxHeading level={2} className="text-base font-semibold">
              {title}
            </AstryxHeading>
            <AstryxParagraph
              className="mt-0.5 truncate text-xs text-muted-foreground"
              title={subtitleRaw}
            >
              {subtitleRaw}
            </AstryxParagraph>
          </AstryxView>
          <AstryxButton
            type="button"
            onClick={onClose}
            title={t("settings.cancel")}
            aria-label={t("settings.cancel")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </AstryxButton>
        </AstryxView>

        <AstryxView
          layout="block"
          direction="horizontal"
          className="settings-modal-body flex-1 overflow-y-auto px-6 py-5"
        >
          <AstryxView layout="block" direction="horizontal" className="space-y-5">
            <AstryxView layout="grid" direction="horizontal" className="grid gap-3 sm:grid-cols-3">
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-1.5 sm:col-span-1"
              >
                <Label htmlFor="mcp-edit-id" className="text-xs text-muted-foreground">
                  {t("mcpHub.serverName")}
                </Label>
                <Input
                  id="mcp-edit-id"
                  value={draft.id}
                  placeholder={t("mcpHub.serverNamePlaceholder")}
                  onChange={(event) => updateDraft({ id: event.currentTarget.value })}
                />
                <AstryxParagraph className="text-[10.5px] text-muted-foreground/70">
                  {t("mcpHub.serverNameHint")}
                </AstryxParagraph>
              </AstryxView>
              <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                <Label htmlFor="mcp-edit-transport" className="text-xs text-muted-foreground">
                  {t("mcpHub.transport")}
                </Label>
                <Select
                  value={draft.transport}
                  onValueChange={(value) => {
                    const transport = value === "http" ? "http" : value === "sse" ? "sse" : "stdio";
                    updateDraft({ transport });
                  }}
                >
                  <SelectTrigger id="mcp-edit-transport">
                    <SelectValue placeholder={t("mcpHub.selectTransport")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio" disabled={!allowStdio}>
                      {t("mcpHub.stdio")}
                    </SelectItem>
                    <SelectItem value="http">{t("mcpHub.http")}</SelectItem>
                    <SelectItem value="sse">{t("mcpHub.sse")}</SelectItem>
                  </SelectContent>
                </Select>
                {!allowStdio ? (
                  <AstryxParagraph className="text-[10.5px] leading-4 text-amber-600 dark:text-amber-300">
                    {t("mcpHub.mobileNetworkOnly")}
                  </AstryxParagraph>
                ) : null}
              </AstryxView>
              <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                <Label htmlFor="mcp-edit-timeout" className="text-xs text-muted-foreground">
                  {t("mcpHub.timeout")}
                </Label>
                <Input
                  id="mcp-edit-timeout"
                  type="number"
                  value={draft.timeoutMs}
                  placeholder="60000"
                  onChange={(event) => updateDraft({ timeoutMs: event.currentTarget.value })}
                />
              </AstryxView>
            </AstryxView>

            {isStdio ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-3 rounded-xl border border-border/45 bg-muted/20 p-4"
              >
                <AstryxView
                  layout="grid"
                  direction="horizontal"
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label htmlFor="mcp-edit-command" className="text-xs text-muted-foreground">
                      {t("mcpHub.command")}
                    </Label>
                    <Input
                      id="mcp-edit-command"
                      value={draft.command}
                      placeholder="npx"
                      className="font-mono text-[12.5px]"
                      onChange={(event) => updateDraft({ command: event.currentTarget.value })}
                    />
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label htmlFor="mcp-edit-cwd" className="text-xs text-muted-foreground">
                      {t("mcpHub.cwd")}
                    </Label>
                    <Input
                      id="mcp-edit-cwd"
                      value={draft.cwd}
                      placeholder={t("mcpHub.cwdDefault")}
                      className="font-mono text-[12.5px]"
                      onChange={(event) => updateDraft({ cwd: event.currentTarget.value })}
                    />
                  </AstryxView>
                </AstryxView>
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label htmlFor="mcp-edit-args" className="text-xs text-muted-foreground">
                    {t("mcpHub.args")}
                  </Label>
                  <Textarea
                    id="mcp-edit-args"
                    value={draft.argsText}
                    placeholder={"-y\n@modelcontextprotocol/server-time"}
                    className="min-h-[92px] font-mono text-[12.5px]"
                    onChange={(event) => updateDraft({ argsText: event.currentTarget.value })}
                  />
                </AstryxView>
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label htmlFor="mcp-edit-env" className="text-xs text-muted-foreground">
                    {t("mcpHub.env")}
                  </Label>
                  <Textarea
                    id="mcp-edit-env"
                    value={draft.envText}
                    disabled={browser}
                    placeholder={"BRAVE_API_KEY=...\nHTTP_PROXY=..."}
                    className="min-h-[92px] font-mono text-[12.5px]"
                    onChange={(event) => updateDraft({ envText: event.currentTarget.value })}
                  />
                </AstryxView>
              </AstryxView>
            ) : (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-3 rounded-xl border border-border/45 bg-muted/20 p-4"
              >
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label htmlFor="mcp-edit-url" className="text-xs text-muted-foreground">
                    {draft.transport === "http" ? t("mcpHub.urlHttp") : t("mcpHub.urlSse")}
                  </Label>
                  <Input
                    id="mcp-edit-url"
                    value={draft.url}
                    placeholder={
                      draft.transport === "http"
                        ? "http://127.0.0.1:3000/mcp"
                        : "http://127.0.0.1:3000/sse"
                    }
                    className="font-mono text-[12.5px]"
                    onChange={(event) => updateDraft({ url: event.currentTarget.value })}
                  />
                </AstryxView>
                {isSse ? (
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label htmlFor="mcp-edit-message-url" className="text-xs text-muted-foreground">
                      {t("mcpHub.messageUrl")}
                    </Label>
                    <Input
                      id="mcp-edit-message-url"
                      value={draft.messageUrl}
                      placeholder="http://127.0.0.1:3000/message"
                      className="font-mono text-[12.5px]"
                      onChange={(event) => updateDraft({ messageUrl: event.currentTarget.value })}
                    />
                  </AstryxView>
                ) : null}
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label htmlFor="mcp-edit-headers" className="text-xs text-muted-foreground">
                    {t("mcpHub.headers")}
                  </Label>
                  <Textarea
                    id="mcp-edit-headers"
                    value={draft.headersText}
                    disabled={browser}
                    placeholder={"Authorization=Bearer ...\nX-API-Key=..."}
                    className="min-h-[92px] font-mono text-[12.5px]"
                    onChange={(event) => updateDraft({ headersText: event.currentTarget.value })}
                  />
                </AstryxView>
              </AstryxView>
            )}

            {formError ? (
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <AstryxInline>{formError}</AstryxInline>
              </AstryxView>
            ) : null}
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-modal-footer settings-modal-footer-row flex items-center justify-end gap-2 border-t border-border/40 px-6 py-4"
        >
          <Button type="button" variant="outline" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button type="submit" className="gap-1.5">
            {mode === "add" ? <Plus className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {submitLabel}
          </Button>
        </AstryxView>
      </AstryxView>
    </SettingsModalShell>
  );
}

export function McpServersForm(props: McpServersFormProps) {
  const { settings, setSettings, onAddServer, onEditServer } = props;
  const { t } = useLocale();
  const [filter, setFilter] = useState("");

  const servers = settings.mcp.servers;
  const groupPolicy = settings.system.toolPolicies?.[toolGroupPolicyKey("mcp")] ?? "allow";
  const serverCount = servers.length;

  const filtered = useMemo(() => {
    const text = filter.trim().toLowerCase();
    if (!text) return servers.map((server, idx) => ({ server, idx }));
    return servers
      .map((server, idx) => ({ server, idx }))
      .filter(({ server }) => {
        const haystack = [server.id, server.command, server.url, server.transport ?? ""]
          .join("\n")
          .toLowerCase();
        return haystack.includes(text);
      });
  }, [filter, servers]);

  const showFilter = serverCount > 4;

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="h-full min-h-0 overflow-y-auto px-1 pb-4 pt-2"
    >
      <AstryxView layout="flex" direction="vertical" className="flex flex-col gap-4">
        {showFilter ? (
          <AstryxView
            layout="block"
            direction="horizontal"
            className="hub-panel-enter relative max-w-md"
          >
            <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <AstryxInput
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              placeholder={t("mcpHub.searchInstalled")}
              className="h-10 w-full rounded-xl border border-border/40 bg-background/60 pl-10 pr-3 text-[13px] outline-hidden backdrop-blur-xl transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-border/60 focus:bg-background/85 focus:ring-2 focus:ring-foreground/10"
            />
          </AstryxView>
        ) : null}

        {serverCount === 0 ? (
          <AstryxView
            layout="block"
            direction="horizontal"
            className="hub-panel-enter rounded-2xl border border-dashed border-border/45 bg-background/40 px-6 py-12 text-center backdrop-blur-xl"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
            >
              <Server className="h-6 w-6" />
            </AstryxView>
            <AstryxParagraph className="mt-4 text-sm font-medium text-foreground">
              {t("mcpHub.noServers")}
            </AstryxParagraph>
            <AstryxParagraph className="mt-1 text-xs text-muted-foreground/80">
              {t("mcpHub.noServersHint")}
            </AstryxParagraph>
            {onAddServer ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-1.5 rounded-full"
                onClick={onAddServer}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("mcpHub.add")}
              </Button>
            ) : null}
          </AstryxView>
        ) : null}

        {filter.trim() && filtered.length === 0 && serverCount > 0 ? (
          <AstryxView
            layout="block"
            direction="horizontal"
            className="hub-panel-enter rounded-2xl border border-border/40 bg-background/55 px-6 py-8 text-center backdrop-blur-xl"
          >
            <Plug className="mx-auto h-5 w-5 text-muted-foreground" />
            <AstryxParagraph className="mt-3 text-sm text-muted-foreground">
              {t("mcpHub.noMatchInstalled")}
            </AstryxParagraph>
          </AstryxView>
        ) : null}

        {filtered.length > 0 ? (
          <AstryxView layout="flex" direction="vertical" className="flex flex-col gap-2.5">
            {filtered.map(({ server, idx }) => (
              <McpServerCard
                key={idx}
                server={server}
                idx={idx}
                policy={
                  settings.system.toolPolicies?.[toolServerPolicyKey(server.id)] ?? groupPolicy
                }
                setSettings={setSettings}
                onEdit={() => onEditServer?.(server, idx)}
              />
            ))}
          </AstryxView>
        ) : null}
      </AstryxView>
    </AstryxView>
  );
}
