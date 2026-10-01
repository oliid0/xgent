import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirmDialog } from "../components/astryx/useConfirmDialog";
import { useLocale } from "../i18n";
import type { AppSettings } from "../lib/settings";
import {
  applyTerminalEventToSessions,
  terminalSessionBelongsToProject,
} from "../lib/terminal/sessionStore";
import type { TerminalClient, TerminalSession, TerminalShellOption } from "../lib/terminal/types";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import { createNativeWorkspacePanel } from "./nativeWorkspacePanel";
import type { PresentationNode } from "./types";
import { useNativeSshConnection } from "./useNativeSshConnection";
import { useNativeTerminalStream } from "./useNativeTerminalStream";

export function NativeDesktopTerminalPanel(props: {
  open: boolean;
  workdir: string;
  projectPathKey: string;
  client: TerminalClient;
  settings: AppSettings;
  kind?: "local" | "ssh";
  associatedHostIds?: string[];
  onAssociatedHostIdsChange?: (ids: string[]) => void;
  onOpenSshSettings?: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const kind = props.kind ?? "local";
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const selection = useRef(selectedId);
  selection.current = selectedId;
  const [shells, setShells] = useState<TerminalShellOption[]>([]);
  const [shell, setShell] = useState("");
  const [loading, setLoading] = useState(false);
  const [operationBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [renameId, setRenameId] = useState("");
  const [title, setTitle] = useState("");
  const [hostId, setHostId] = useState("");
  const scope = useRef({
    open: props.open,
    key: props.projectPathKey,
    cwd: props.workdir,
    kind,
    revision: 0,
  });
  const previous = useRef({
    open: props.open,
    key: props.projectPathKey,
    cwd: props.workdir,
    kind,
  });
  if (
    previous.current.open !== props.open ||
    previous.current.key !== props.projectPathKey ||
    previous.current.cwd !== props.workdir ||
    previous.current.kind !== kind
  ) {
    previous.current = { open: props.open, key: props.projectPathKey, cwd: props.workdir, kind };
    scope.current = {
      open: props.open,
      key: props.projectPathKey,
      cwd: props.workdir,
      kind,
      revision: scope.current.revision + 1,
    };
  }
  const operation = useRef(false);
  const { confirm, cancel, dialog } = useConfirmDialog();
  const session = sessions.find((item) => item.id === selectedId) ?? sessions[0] ?? null;
  const stream = useNativeTerminalStream(props.client, session, props.open);
  const ssh = useNativeSshConnection(
    props.client,
    JSON.stringify([props.workdir, props.projectPathKey, kind, hostId]),
    props.open && kind === "ssh",
  );
  const busy = operationBusy || ssh.connecting;
  const ready = Boolean(props.workdir.trim() && props.projectPathKey.trim());
  const hosts = useMemo(
    () => props.settings.ssh.hosts.filter((host) => host.host.trim()),
    [props.settings.ssh.hosts],
  );
  const associated = useMemo(() => props.associatedHostIds ?? [], [props.associatedHostIds]);
  const host = hosts.find((item) => item.id === hostId);

  useEffect(() => {
    setHostId((id) =>
      hosts.some((item) => item.id === id)
        ? id
        : (hosts.find((item) => associated.includes(item.id))?.id ?? hosts[0]?.id ?? ""),
    );
  }, [hosts, associated]);

  useEffect(() => {
    let retired = false;
    const previousSelectedId = selection.current;
    const revision = ++scope.current.revision;
    scope.current.open = props.open;
    const current = () => !retired && scope.current.open && scope.current.revision === revision;
    setSessions([]);
    setSelectedId("");
    setError("");
    setRenameId("");
    setTitle("");
    operation.current = false;
    setBusy(false);
    setLoading(props.open && ready);
    cancel();
    if (props.open && ready) {
      void Promise.all([
        props.client.list(props.projectPathKey),
        kind === "local"
          ? props.client.shellOptions()
          : Promise.resolve({ options: [], defaultShell: "" }),
      ])
        .then(([listed, available]) => {
          if (!current()) return;
          const local = listed.filter(
            (item) =>
              item.kind === kind && terminalSessionBelongsToProject(item, props.projectPathKey),
          );
          setSessions(local);
          setSelectedId(
            local.some((item) => item.id === previousSelectedId)
              ? previousSelectedId
              : (local.at(-1)?.id ?? ""),
          );
          setShells([...new Map(available.options.map((item) => [item.command, item])).values()]);
          setShell((value) =>
            available.options.some((item) => item.command === value)
              ? value
              : available.defaultShell,
          );
        })
        .catch((failure: unknown) => {
          if (current()) setError(failure instanceof Error ? failure.message : String(failure));
        })
        .finally(() => {
          if (current()) setLoading(false);
        });
    }
    const unsubscribe =
      props.open && ready
        ? props.client.subscribe((event) => {
            if (
              !current() ||
              event.kind === "output" ||
              event.projectPathKey !== props.projectPathKey
            )
              return;
            if (event.kind !== "closed" && event.session?.kind !== kind) return;
            setSessions((items) => applyTerminalEventToSessions(items, event));
          })
        : undefined;
    return () => {
      retired = true;
      if (scope.current.revision === revision) scope.current.open = false;
      unsubscribe?.();
    };
  }, [props.client, props.open, props.projectPathKey, props.workdir, kind, ready, refresh, cancel]);

  const create = async () => {
    if (!ready || loading || operation.current || !scope.current.open || (kind === "ssh" && !host))
      return;
    const revision = scope.current.revision;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      const snapshot =
        kind === "ssh"
          ? await ssh.connect({
              cwd: props.workdir,
              projectPathKey: props.projectPathKey,
              hostId,
              cols: 80,
              rows: 24,
              sftpEnabled: true,
            })
          : await props.client.create({
              cwd: props.workdir,
              projectPathKey: props.projectPathKey,
              ...(shell ? { shell } : {}),
              cols: 80,
              rows: 24,
            });
      if (!snapshot) return;
      if (!scope.current.open || scope.current.revision !== revision) return;
      setSessions((items) => [
        ...items.filter((item) => item.id !== snapshot.session.id),
        snapshot.session,
      ]);
      setSelectedId(snapshot.session.id);
    } catch (failure) {
      if (scope.current.open && scope.current.revision === revision)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (scope.current.revision === revision) {
        operation.current = false;
        setBusy(false);
      }
    }
  };
  const closeSession = async () => {
    if (!session || operation.current || loading || !scope.current.open) return;
    const target = session;
    const revision = scope.current.revision;
    const current = () => scope.current.open && scope.current.revision === revision;
    operation.current = true;
    setBusy(true);
    try {
      if (
        target.running &&
        !(await confirm({
          title: t("projectTools.closeRunningTerminal").replace(
            "{title}",
            target.title || target.shell,
          ),
          confirmLabel: t("projectTools.closeTerminal"),
          cancelLabel: t("chat.cancel"),
          tone: "destructive",
        }))
      )
        return;
      if (!current()) return;
      await props.client.close(target.id, target.projectPathKey);
      if (!current()) return;
      setSessions((items) => items.filter((item) => item.id !== target.id));
      setSelectedId((id) => (id === target.id ? "" : id));
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (scope.current.revision === revision) {
        operation.current = false;
        setBusy(false);
      }
    }
  };
  const rename = async () => {
    const target = sessions.find((item) => item.id === renameId);
    const name = title.trim();
    if (!target || !name || name.length > 200 || operation.current || !scope.current.open) return;
    const revision = scope.current.revision;
    const current = () => scope.current.open && scope.current.revision === revision;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      const renamed = await props.client.rename(target.id, name, target.projectPathKey);
      if (!current()) return;
      setSessions((items) => items.map((item) => (item.id === renamed.id ? renamed : item)));
      setRenameId("");
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (scope.current.revision === revision) {
        operation.current = false;
        setBusy(false);
      }
    }
  };
  const reconnectSsh = async () => {
    if (!session || kind !== "ssh" || busy || operation.current || !scope.current.open) return;
    const revision = scope.current.revision;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      const reconnected = await props.client.sshReconnect(session.id, session.projectPathKey);
      if (!scope.current.open || scope.current.revision !== revision) return;
      setSessions((items) =>
        items.map((item) => (item.id === reconnected.id ? reconnected : item)),
      );
      stream.reconnect();
    } catch (failure) {
      if (scope.current.open && scope.current.revision === revision)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (scope.current.revision === revision) {
        operation.current = false;
        setBusy(false);
      }
    }
  };
  if (!props.open) return null;
  const controls = presentationControls();
  const close = () => {
    scope.current.open = false;
    stream.retire();
    ssh.retire();
    cancel();
    props.onClose();
  };
  const panelTitle = t(
    kind === "ssh" ? "projectTools.sshConnectionTitle" : "projectTools.terminalTitle",
  );
  const createLabel = t(
    kind === "ssh" ? "projectTools.sshConnectionConnect" : "projectTools.newTerminal",
  );
  const canCreate = ready && !busy && !loading && (kind !== "ssh" || Boolean(host));
  const children: PresentationNode[] = [
    {
      id: "terminal-selectors",
      kind: "TerminalToolbar",
      label: panelTitle,
      spacing: 12,
      padding: 12,
      children: [
        controls.select(
          "terminal-session",
          t("projectTools.terminalTitle"),
          session?.id ?? "",
          sessions.map((item) => ({ value: item.id, label: item.title || item.shell || item.id })),
          setSelectedId,
          !busy && sessions.length > 0,
        ),
        kind === "ssh"
          ? controls.select(
              "terminal-host",
              t("projectTools.sshConnectionHost"),
              hostId,
              [...hosts]
                .sort(
                  (a, b) => Number(associated.includes(b.id)) - Number(associated.includes(a.id)),
                )
                .map((item) => ({
                  value: item.id,
                  label: item.name || `${item.username}@${item.host}:${item.port || 22}`,
                })),
              setHostId,
              !busy && hosts.length > 0,
            )
          : controls.select(
              "terminal-shell",
              t("projectTools.shell"),
              shell,
              shells.map((item) => ({ value: item.command, label: item.label })),
              setShell,
              !busy && shells.length > 0,
            ),
      ],
    },
    {
      id: "terminal-toolbar",
      kind: "TerminalToolbar",
      label: panelTitle,
      spacing: 12,
      padding: 12,
      children: [
        controls.action("terminal-new", createLabel, create, canCreate),
        controls.action(
          "terminal-rename",
          t("projectTools.fileTree.rename"),
          () => {
            if (!session) return;
            setRenameId(session.id);
            setTitle(session.title || session.shell);
          },
          Boolean(session) && !busy && !loading,
        ),
        {
          ...controls.action(
            "terminal-end",
            t("projectTools.closeTerminal"),
            closeSession,
            Boolean(session) && !busy && !loading,
          ),
          destructive: true,
        },
        {
          ...controls.action(
            "terminal-refresh",
            t("projectTools.fileTree.refresh"),
            () => setRefresh((value) => value + 1),
            !busy && !loading,
          ),
          kind: "IconButton",
          icon: "arrow.clockwise",
        },
      ],
    },
    ...(kind === "ssh"
      ? [
          {
            id: "terminal-host-settings",
            kind: "TerminalToolbar" as const,
            label: panelTitle,
            spacing: 12,
            padding: 12,
            children: [
              ...(host && props.onAssociatedHostIdsChange
                ? [
                    controls.toggle(
                      "terminal-associate-host",
                      t("chat.workspaceSection"),
                      associated.includes(host.id),
                      (enabled) =>
                        props.onAssociatedHostIdsChange?.(
                          enabled
                            ? [...new Set([...associated, host.id])]
                            : associated.filter((id) => id !== host.id),
                        ),
                      !busy && ready,
                    ),
                  ]
                : []),
              ...(props.onOpenSshSettings
                ? [
                    controls.action(
                      "terminal-host-configure",
                      t("projectTools.sshConnectionSettings"),
                      () => {
                        close();
                        props.onOpenSshSettings?.();
                      },
                    ),
                  ]
                : []),
              ...(session && !session.running && session.ssh?.status !== "reconnecting"
                ? [
                    controls.action(
                      "terminal-ssh-reconnect",
                      t("projectTools.terminalReconnect"),
                      reconnectSsh,
                      !busy && !loading,
                    ),
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(ssh.prompt
      ? [
          {
            id: "terminal-auth",
            kind: "VStack" as const,
            spacing: 8,
            padding: 12,
            children: [
              {
                id: "terminal-auth-title",
                kind: "Heading" as const,
                text: t(
                  ssh.prompt.kind === "hostKey"
                    ? "projectTools.sshConnectionPromptTitle"
                    : "projectTools.sshConnectionAuthPromptTitle",
                ),
              },
              { id: "terminal-auth-message", kind: "Text" as const, text: ssh.prompt.message },
              ...(ssh.prompt.fingerprintSha256
                ? [
                    {
                      id: "terminal-auth-fingerprint",
                      kind: "Text" as const,
                      text: `${t("projectTools.sshConnectionFingerprint")}: ${ssh.prompt.fingerprintSha256}`,
                    },
                  ]
                : []),
              ...(ssh.prompt.kind === "hostKey"
                ? []
                : [
                    controls.input(
                      "terminal-auth-answer",
                      t("settings.sshAuthMethod"),
                      ssh.answer,
                      ssh.setAnswer,
                      !ssh.prompt.answerEcho,
                      !ssh.answering,
                    ),
                  ]),
              {
                id: "terminal-auth-actions",
                kind: "HStack" as const,
                spacing: 8,
                children: [
                  controls.action(
                    "terminal-auth-submit",
                    t(
                      ssh.prompt.kind === "hostKey"
                        ? "projectTools.sshConnectionTrustHost"
                        : "projectTools.sshConnectionPromptSubmit",
                    ),
                    ssh.submit,
                    !ssh.answering,
                  ),
                  controls.action(
                    "terminal-auth-cancel",
                    t("projectTools.sshConnectionPromptCancel"),
                    ssh.cancel,
                  ),
                ],
              },
            ],
          },
        ]
      : ssh.connecting
        ? [
            {
              id: "terminal-connecting",
              kind: "VStack" as const,
              spacing: 8,
              padding: 12,
              children: [
                {
                  id: "terminal-connect-progress",
                  kind: "Progress" as const,
                  label: t("projectTools.sshConnectionConnecting"),
                },
                controls.action("terminal-connect-cancel", t("chat.cancel"), ssh.cancel),
              ],
            },
          ]
        : []),
    ...(renameId
      ? [
          {
            id: "terminal-rename-form",
            kind: "VStack" as const,
            spacing: 8,
            padding: 12,
            children: [
              controls.input(
                "terminal-name",
                t("projectTools.terminalTitle"),
                title,
                setTitle,
                false,
                !busy,
              ),
              {
                id: "terminal-name-actions",
                kind: "HStack" as const,
                spacing: 8,
                children: [
                  controls.action(
                    "terminal-name-save",
                    t("projectTools.fileTree.rename"),
                    rename,
                    Boolean(title.trim()) && title.trim().length <= 200 && !busy,
                  ),
                  controls.action(
                    "terminal-name-cancel",
                    t("chat.cancel"),
                    () => setRenameId(""),
                    !busy,
                  ),
                ],
              },
            ],
          },
        ]
      : []),
    ...(error || stream.error
      ? [
          {
            id: "terminal-error",
            kind: "Banner" as const,
            status: "error" as const,
            text: error || stream.error,
            children: [
              controls.action(
                "terminal-reconnect",
                t("projectTools.fileTree.refresh"),
                error ? () => setRefresh((value) => value + 1) : stream.reconnect,
                !busy && !loading,
              ),
            ],
          },
        ]
      : []),
    ...(loading || stream.loading
      ? [
          {
            id: "terminal-loading",
            kind: "Progress" as const,
            label: t("projectTools.terminalLoading"),
          },
        ]
      : []),
    ...(session
      ? [
          {
            id: "terminal-session-status",
            kind: "Text" as const,
            secondary: true,
            padding: 8,
            text: `${session.cwd} · ${session.running ? session.shell : `${t("projectTools.terminalTitle")} (${session.exitCode ?? "—"})`}`,
          },
          {
            id: "terminal-viewport",
            kind: "TerminalViewport" as const,
            value: stream.packet,
            label: session.title || t("projectTools.terminalTitle"),
            action: `terminal-events:${session.id}`,
            disabled: !stream.packet,
            fill: true,
            minHeight: 300,
          },
        ]
      : !loading
        ? [
            {
              id: "terminal-empty",
              kind: "EmptyState" as const,
              label: panelTitle,
              text: t(
                kind === "ssh"
                  ? "projectTools.sshConnectionDescription"
                  : "projectTools.terminalDescription",
              ),
              children: [controls.action("terminal-create-first", createLabel, create, canCreate)],
            },
          ]
        : []),
  ];
  controls.handlers.set("close", { enabled: true, accepts: (value) => value === null, run: close });
  if (session)
    controls.handlers.set(`terminal-events:${session.id}`, {
      enabled: Boolean(stream.packet),
      accepts: stream.accepts,
      run: stream.dispatch,
    });
  return (
    <>
      <NativeSurface
        document={{
          ...createNativeWorkspacePanel(t, false),
          title: panelTitle,
          appearance: props.settings.theme,
          formFactor: "desktop",
          dismissAction: "close",
          theme: createNativePresentationTheme(props.settings, false, "workspaceTools"),
          nodes: [{ id: "terminal-layout", kind: "TerminalLayout", fill: true, children }],
        }}
        handlers={controls.handlers}
        onError={(failure) =>
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      />
      {dialog}
    </>
  );
}
