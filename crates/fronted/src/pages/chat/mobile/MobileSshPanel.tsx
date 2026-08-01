import { invoke } from "@xagent/runtime";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Key,
  Loader2,
  Send,
  Settings2,
  Square,
  Trash2,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { SshHostConfig } from "../../../lib/settings";
import { MobileFullscreenPanel } from "./MobilePanelScaffold";

type ShellRunResponse = {
  exit_code?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
  timed_out?: boolean;
  timedOut?: boolean;
  cancelled: boolean;
};

type SshCommandEntry = {
  id: string;
  command: string;
  response?: ShellRunResponse;
  error?: string;
};

type MobileSshPanelProps = {
  open: boolean;
  workdir: string;
  hosts: SshHostConfig[];
  onOpenSettings: () => void;
  onClose: () => void;
};

function createRunId() {
  return `mobile-ssh-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function endpoint(host: SshHostConfig) {
  return `${host.username.trim() ? `${host.username.trim()}@` : ""}${host.host.trim()}:${host.port || 22}`;
}

function authLabel(host: SshHostConfig, t: (key: string) => string) {
  if (host.authType === "privateKey") return t("settings.sshAuthPrivateKey");
  if (host.authType === "keyboardInteractive") {
    return t("settings.sshAuthKeyboardInteractive");
  }
  return t("settings.sshAuthPassword");
}

export function MobileSshPanel(props: MobileSshPanelProps) {
  const { open, workdir, hosts, onOpenSettings, onClose } = props;
  const { t } = useLocale();
  const [selectedHostId, setSelectedHostId] = useState("");
  const [command, setCommand] = useState("");
  const [keyboardResponse, setKeyboardResponse] = useState("");
  const [entries, setEntries] = useState<SshCommandEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? null,
    [hosts, selectedHostId],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedHostId((current) =>
      current && hosts.some((host) => host.id === current) ? current : "",
    );
  }, [hosts, open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeRunId, entries]);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    const remoteCommand = command.trim();
    if (
      !selectedHost ||
      !remoteCommand ||
      activeRunId ||
      !workdir.trim() ||
      (selectedHost.authType === "keyboardInteractive" && !keyboardResponse.trim())
    )
      return;
    const id = createRunId();
    setCommand("");
    setActiveRunId(id);
    setEntries((current) => [...current, { id, command: remoteCommand }]);
    try {
      const response = await invoke<ShellRunResponse>("mobile_ssh_exec", {
        host_id: selectedHost.id,
        workdir,
        remote_command: remoteCommand,
        keyboard_response:
          selectedHost.authType === "keyboardInteractive" ? keyboardResponse : null,
        timeout_ms: 300_000,
        run_id: id,
      });
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, response } : entry)),
      );
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, error } : entry)),
      );
    } finally {
      setActiveRunId("");
    }
  };

  const cancel = async () => {
    if (!activeRunId) return;
    await invoke("shell_cancel", { run_id: activeRunId }).catch(() => undefined);
  };

  const close = () => {
    if (activeRunId) void invoke("shell_cancel", { run_id: activeRunId }).catch(() => undefined);
    onClose();
  };

  if (!open) return null;

  return (
    <MobileFullscreenPanel open label={t("chat.mobileSsh.title")}>
      <header className="mobile-panel-header flex min-h-14 shrink-0 items-center gap-3 border-b border-border/55 bg-background/90 px-3 backdrop-blur-xl">
        {selectedHost ? (
          <button
            type="button"
            onClick={() => {
              if (activeRunId) return;
              setSelectedHostId("");
              setKeyboardResponse("");
              setEntries([]);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted disabled:opacity-45"
            disabled={Boolean(activeRunId)}
            aria-label={t("chat.mobileSsh.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
            <Key className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">
            {selectedHost?.name || t("chat.mobileSsh.title")}
          </h2>
          <p className="truncate text-[10px] text-muted-foreground">
            {selectedHost ? endpoint(selectedHost) : t("chat.mobileSsh.savedHosts")}
          </p>
        </div>
        {!selectedHost ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            aria-label={t("settings.sshTitle")}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        ) : entries.length > 0 && !activeRunId ? (
          <button
            type="button"
            onClick={() => setEntries([])}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            aria-label={t("chat.mobileTerminal.clear")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={close}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          aria-label={t("chat.mobileTerminal.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {!selectedHost ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4">
          {hosts.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Key className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold">{t("settings.sshNoHosts")}</h3>
              <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
                {t("settings.sshNoHostsHint")}
              </p>
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-5 rounded-xl bg-foreground px-4 py-2.5 text-xs font-medium text-background"
              >
                {t("settings.sshAdd")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {hosts.map((host) => {
                return (
                  <button
                    key={host.id}
                    type="button"
                    onClick={() => setSelectedHostId(host.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3 text-left active:bg-muted"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Key className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {host.name || host.host}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {endpoint(host)}
                      </span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        {authLabel(host, t)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-4 font-mono text-[12px] leading-5"
          >
            {entries.length === 0 ? (
              <div className="rounded-xl border border-border bg-muted/25 p-4 font-sans text-muted-foreground">
                <div className="text-[13px] font-medium text-foreground">
                  {t("chat.mobileSsh.commandMode")}
                </div>
                <div className="mt-1 text-[11px] leading-5">
                  {selectedHost.authType === "keyboardInteractive"
                    ? t("chat.mobileSsh.keyboardResponseHint")
                    : t("chat.mobileSsh.commandHint")}
                </div>
              </div>
            ) : null}
            {entries.map((entry) => {
              const response = entry.response;
              const code = response?.exitCode ?? response?.exit_code;
              return (
                <article key={entry.id}>
                  <div className="flex gap-2 text-emerald-600">
                    <span>❯</span>
                    <span className="min-w-0 break-all text-foreground">{entry.command}</span>
                  </div>
                  {entry.id === activeRunId ? (
                    <div className="mt-2 flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("chat.mobileTerminal.running")}
                    </div>
                  ) : null}
                  {response?.stdout ? (
                    <pre className="mt-2 whitespace-pre-wrap break-words text-foreground/90">
                      {response.stdout}
                    </pre>
                  ) : null}
                  {response?.stderr ? (
                    <pre className="mt-2 whitespace-pre-wrap break-words text-amber-600">
                      {response.stderr}
                    </pre>
                  ) : null}
                  {entry.error ? (
                    <pre className="mt-2 whitespace-pre-wrap break-words text-destructive">
                      {entry.error}
                    </pre>
                  ) : null}
                  {code !== undefined ? (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {t("chat.mobileTerminal.exitCode").replace("{code}", String(code))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {selectedHost.authType === "keyboardInteractive" ? (
            <label className="shrink-0 border-t border-border bg-background px-3 pt-3">
              <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                {t("chat.mobileSsh.keyboardResponse")}
              </span>
              <input
                type="password"
                value={keyboardResponse}
                onChange={(event) => setKeyboardResponse(event.currentTarget.value)}
                disabled={Boolean(activeRunId)}
                autoComplete="off"
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-primary"
                placeholder={t("chat.mobileSsh.keyboardResponsePlaceholder")}
              />
            </label>
          ) : null}
          <form
            onSubmit={(event) => void run(event)}
            className="flex shrink-0 items-end gap-2 border-t border-border bg-background px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3"
          >
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3">
              <span className="font-mono text-emerald-600">$</span>
              <input
                value={command}
                onChange={(event) => setCommand(event.currentTarget.value)}
                disabled={Boolean(activeRunId)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("chat.mobileSsh.remoteCommandPlaceholder")}
                className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground/60"
              />
            </label>
            <button
              type={activeRunId ? "button" : "submit"}
              onClick={activeRunId ? () => void cancel() : undefined}
              disabled={
                !activeRunId &&
                (!command.trim() ||
                  (selectedHost.authType === "keyboardInteractive" && !keyboardResponse.trim()))
              }
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:bg-muted disabled:text-muted-foreground"
              aria-label={
                activeRunId ? t("chat.mobileTerminal.stop") : t("chat.mobileTerminal.run")
              }
            >
              {activeRunId ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>
        </>
      )}
    </MobileFullscreenPanel>
  );
}
