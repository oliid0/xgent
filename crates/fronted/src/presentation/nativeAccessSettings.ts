import { invoke, listen } from "@xgent/runtime";
import { useEffect, useState } from "react";
import { useAgentStartup } from "../lib/automation/useAgentStartup";
import { useWorkerPeers } from "../lib/automation/useWorkerPeers";
import { discoveredWorkerLabel } from "../lib/automation/workerDiscovery";
import { browserSessionController } from "../lib/browser/browserSessionController";
import { useGitHubAuthorization } from "../lib/connectors/useGitHubAuthorization";
import {
  type CloudSecretVaultStatus,
  type LanPcClientStatus,
  type LocalAccessStatus,
  normalizeComparableLanUrl,
  normalizeLanControlUrl,
} from "../lib/localAccess";
import { type AppSettings, updateAccessSettings } from "../lib/settings";
import { writeClipboardText } from "../lib/system/clipboardText";
import { useTailscaleSetup } from "../lib/useTailscaleSetup";
import type { SettingsSectionProps } from "../pages/settings/types";
import { agentStartupNodes } from "./agentStartupNodes";
import { presentationControls } from "./controls";
import { githubAuthorizationNodes } from "./githubAuthorizationNodes";
import { tailscaleSetupNodes } from "./tailscaleSetupNodes";
import type { PresentationNode } from "./types";

/** Shared Rust services; SwiftUI owns the native page and each form control. */
export function useNativeAccessSettings(
  { settings, setSettings }: SettingsSectionProps,
  enabled: boolean,
  mobile: boolean,
  t: (key: string) => string,
  onOpenComputer: () => void,
) {
  const startup = useAgentStartup(enabled && !mobile);
  const tailscale = useTailscaleSetup(enabled, mobile);
  const github = useGitHubAuthorization(enabled, async () => {
    const revision = operation.revision;
    const vaultRevision = ++operation.vaultRevision;
    const status = await invoke<CloudSecretVaultStatus>("cloud_secret_vault_status");
    if (
      operation.active &&
      revision === operation.revision &&
      vaultRevision === operation.vaultRevision
    )
      setVault(status);
  });
  const workers = useWorkerPeers(enabled, async () => {
    if (!mobile) return;
    const revision = operation.revision;
    const current = () => operation.active && operation.revision === revision;
    await refreshLan(current);
  });
  const [local, setLocal] = useState<LocalAccessStatus>({
    enabled: false,
    running: false,
    bindAddress: "",
    port: 28367,
    urls: [],
    pairedDevices: 0,
    devices: [],
  });
  const [lan, setLan] = useState<LanPcClientStatus>({ paired: false });
  const [vault, setVault] = useState<CloudSecretVaultStatus>({ githubTokenConfigured: false });
  const [pairingCode, setPairingCode] = useState("");
  const [deviceName, setDeviceName] = useState(mobile ? "Xgent mobile" : "Xgent desktop");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [operation] = useState(() => ({
    active: enabled,
    revision: 0,
    localRevision: 0,
    vaultRevision: 0,
    lanRevision: 0,
    busy: "",
  }));
  operation.active = enabled;

  function patch(patch: Partial<AppSettings["access"]>) {
    setSettings((previous) => updateAccessSettings(previous, patch));
  }

  async function run(id: string, action: (current: () => boolean) => Promise<void>) {
    if (!operation.active || operation.busy) return;
    const revision = operation.revision;
    const current = () => operation.active && operation.revision === revision;
    operation.busy = id;
    setBusy(id);
    setError("");
    try {
      await action(current);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      if (current()) {
        operation.busy = "";
        setBusy("");
      }
    }
  }

  async function refreshLocal(current: () => boolean) {
    const revision = ++operation.localRevision;
    try {
      const status = await invoke<LocalAccessStatus>("local_access_status");
      if (current() && revision === operation.localRevision) setLocal(status);
    } catch (cause) {
      if (current() && revision === operation.localRevision) throw cause;
    }
  }

  async function refreshLan(current: () => boolean) {
    const revision = ++operation.lanRevision;
    try {
      const status = await invoke<LanPcClientStatus>("lan_pc_status");
      if (!current() || revision !== operation.lanRevision) return;
      setLan(status);
      const address = normalizeComparableLanUrl(status.baseUrl);
      if (status.paired && address) patch({ lanControlUrl: `${address}/` });
      else if (!status.paired) patch({ preferLanPcExecution: false });
    } catch (cause) {
      if (current() && revision === operation.lanRevision) throw cause;
    }
  }

  async function pairComputer(current: () => boolean) {
    operation.lanRevision++;
    const baseUrl = normalizeLanControlUrl(settings.access.lanControlUrl);
    const status = await invoke<LanPcClientStatus>("lan_pc_pair", {
      baseUrl,
      code: pairingCode,
      deviceName: deviceName.trim(),
    });
    if (!current()) return;
    operation.lanRevision++;
    setLan(status);
    setPairingCode((previous) => (previous === pairingCode ? "" : previous));
    patch({ lanControlUrl: status.baseUrl ? normalizeLanControlUrl(status.baseUrl) : baseUrl });
    if (status.workerRegistrationError) setError(status.workerRegistrationError);
    void workers.refresh().catch(() => {});
  }

  useEffect(() => {
    operation.active = enabled;
    const revision = ++operation.revision;
    operation.busy = "";
    setBusy("");
    setError("");
    if (!enabled) {
      setToken("");
      return;
    }
    const current = () => operation.active && operation.revision === revision;
    const report = (cause: unknown) => {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    };
    // Each service can fail independently; a vault failure must not hide pairing.
    const vaultRevision = ++operation.vaultRevision;
    void invoke<CloudSecretVaultStatus>("cloud_secret_vault_status")
      .then((status) => {
        if (current() && vaultRevision === operation.vaultRevision) setVault(status);
      })
      .catch((cause) => {
        if (vaultRevision === operation.vaultRevision) report(cause);
      });
    if (mobile) void refreshLan(current).catch(report);
    else {
      let stop: (() => void) | undefined;
      const poll = () => {
        if (current()) void refreshLocal(current).catch(report);
      };
      void listen<LocalAccessStatus>("local-access:status", (event) => {
        if (current()) {
          operation.localRevision++;
          setLocal(event.payload);
        }
      })
        .then((unlisten) => {
          if (!current()) unlisten();
          else {
            stop = unlisten;
            poll();
          }
        })
        .catch((cause) => {
          report(cause);
          poll();
        });
      const timer = settings.access.webUiEnabled ? setInterval(poll, 2000) : undefined;
      return () => {
        operation.active = false;
        operation.revision++;
        if (timer !== undefined) clearInterval(timer);
        stop?.();
      };
    }
    return () => {
      operation.active = false;
      operation.revision++;
    };
  }, [enabled, mobile, settings.access.webUiEnabled]);

  const c = presentationControls();
  if (!enabled) return { nodes: [], handlers: c.handlers };
  const input = (...args: Parameters<typeof c.input>): PresentationNode => ({
    ...c.input(...args),
    ...(mobile ? { variant: "settings-stacked-field" } : {}),
  });
  const nodes: PresentationNode[] = [];
  const available = !busy;
  const note = (id: string, text: string): PresentationNode => ({
    id,
    kind: "Text",
    text,
    secondary: true,
  });
  const copy = (id: string, value: string) => ({
    ...c.action(
      id,
      t("workspaceEditor.context.copy"),
      () =>
        run(id, async () => {
          if (!(await writeClipboardText(value)))
            throw new Error(t("workspaceFilePreview.copyFailed"));
        }),
      available && !!value,
    ),
    icon: "doc.on.doc",
  });

  if (mobile) {
    const ready = lan.paired && !!normalizeComparableLanUrl(lan.baseUrl);
    nodes.push(
      c.group("lan-computer", t("settings.accessLanControl"), [
        {
          id: "lan-status",
          kind: "StatusDot",
          status: ready ? "completed" : "paused",
          label: t(ready ? "settings.accessComputerPaired" : "settings.accessComputerNotPaired"),
        },
        input(
          "lan-url",
          t("settings.accessComputerAddress"),
          settings.access.lanControlUrl,
          (lanControlUrl) => patch({ lanControlUrl }),
        ),
        input(
          "lan-pairing-code",
          t("settings.accessLanPairingCode"),
          pairingCode,
          setPairingCode,
          false,
          available,
          (value) => value.replace(/\D/g, "").slice(0, 6),
        ),
        input("lan-device-name", t("settings.accessLanDeviceName"), deviceName, setDeviceName),
        c.action(
          "lan-pair",
          t("settings.accessPairComputer"),
          () => run("lan-pair", pairComputer),
          available &&
            !!settings.access.lanControlUrl.trim() &&
            pairingCode.length === 6 &&
            !!deviceName.trim(),
        ),
        ...(lan.paired
          ? [
              c.action(
                "lan-refresh",
                t("settings.accessCheckComputer"),
                () => run("lan-refresh", refreshLan),
                available,
              ),
              c.action(
                "lan-disconnect",
                t("settings.accessDisconnectComputer"),
                () =>
                  run("lan-disconnect", async (current) => {
                    operation.lanRevision++;
                    const status = await invoke<LanPcClientStatus>("lan_pc_disconnect");
                    if (current()) {
                      operation.lanRevision++;
                      setLan(status);
                      patch({ preferLanPcExecution: false });
                      void workers.refresh().catch(() => {});
                    }
                  }),
                available,
              ),
            ]
          : []),
        {
          ...c.toggle(
            "lan-prefer",
            t("settings.accessPreferLanPc"),
            settings.access.preferLanPcExecution,
            (preferLanPcExecution) => patch({ preferLanPcExecution }),
            ready,
          ),
          icon: "desktopcomputer",
        },
        c.action(
          "lan-open",
          t("settings.accessOpenComputer"),
          () =>
            run("lan-open", async (current) => {
              const url = normalizeLanControlUrl(settings.access.lanControlUrl);
              await browserSessionController.ensureSession({
                sessionId: "lan-control",
                url,
                visible: false,
              });
              if (current()) {
                patch({ lanControlUrl: url });
                onOpenComputer();
                browserSessionController.openPanel("lan-control", "user");
              }
            }),
          available && !!settings.access.lanControlUrl.trim(),
        ),
        {
          ...c.toggle(
            "ios-ashell",
            t("settings.accessIosAShell"),
            settings.access.iosAShellEnabled,
            (iosAShellEnabled) => patch({ iosAShellEnabled }),
          ),
          icon: "terminal",
        },
      ]),
    );
  } else {
    const phase = local.running
      ? "Running"
      : local.lastError
        ? "Failed"
        : local.enabled || settings.access.webUiEnabled
          ? "Starting"
          : "Stopped";
    nodes.push(
      c.group("local-web-ui", t("settings.accessWebUi"), [
        {
          id: "web-ui-status",
          kind: "StatusDot",
          label: t(`settings.access${phase}`),
          status:
            phase === "Running"
              ? "completed"
              : phase === "Failed"
                ? "error"
                : phase === "Starting"
                  ? "running"
                  : "paused",
        },
        c.toggle(
          "web-ui-enabled",
          t("settings.accessWebUi"),
          settings.access.webUiEnabled,
          (webUiEnabled) => patch({ webUiEnabled }),
        ),
        c.select(
          "web-ui-scope",
          t("settings.accessScope"),
          settings.access.webUiScope,
          [
            { value: "lan", label: t("settings.accessScopeLan") },
            { value: "loopback", label: t("settings.accessScopeLoopback") },
          ],
          (webUiScope) => patch({ webUiScope: webUiScope as "lan" | "loopback" }),
        ),
        c.number(
          "web-ui-port",
          t("settings.accessPort"),
          settings.access.webUiPort,
          1,
          65535,
          1,
          (webUiPort) => patch({ webUiPort }),
          true,
          Math.round,
        ),
        ...(local.urls.length
          ? local.urls
          : [`http://127.0.0.1:${settings.access.webUiPort}`]
        ).flatMap((url, index) => [
          note(`web-ui-url:${index}`, url),
          copy(`web-ui-copy:${index}`, url),
        ]),
        c.action(
          "web-ui-refresh",
          t("projectTools.gitReview.refresh"),
          () => run("web-ui-refresh", refreshLocal),
          available,
        ),
        ...(local.lastError
          ? [
              {
                id: "web-ui-error",
                kind: "Banner" as const,
                status: "error" as const,
                label: local.lastError,
              },
            ]
          : []),
      ]),
    );
    nodes.push(
      c.group("local-pairing", t("settings.accessPairing"), [
        note(
          "paired-devices-count",
          t("settings.accessPairedDevices").replace("{count}", String(local.pairedDevices)),
        ),
        ...(local.pairingCode
          ? [
              note(
                "local-pairing-code",
                `${t("settings.accessLanPairingCode")}: ${local.pairingCode}`,
              ),
              copy("local-pairing-copy", local.pairingCode),
            ]
          : []),
        c.action(
          "local-pairing-rotate",
          t("settings.accessNewPairingCode"),
          () =>
            run("local-pairing-rotate", async (current) => {
              const status = await invoke<LocalAccessStatus>("local_access_rotate_pairing_code");
              if (current()) {
                operation.localRevision++;
                setLocal(status);
              }
            }),
          available && settings.access.webUiEnabled,
        ),
        ...(local.devices.length
          ? local.devices.map((device) =>
              c.group(`local-device:${device.deviceId}`, device.label, [
                note(
                  `local-device:${device.deviceId}:seen`,
                  t("settings.accessDeviceLastSeen").replace(
                    "{time}",
                    new Date(device.lastSeenAt).toLocaleString(),
                  ),
                ),
                {
                  ...c.action(
                    `local-device:${device.deviceId}:revoke`,
                    t("settings.accessRevokeDevice"),
                    () =>
                      run("revoke-device", async (current) => {
                        const status = await invoke<LocalAccessStatus>(
                          "local_access_revoke_device",
                          { deviceId: device.deviceId },
                        );
                        if (current()) {
                          operation.localRevision++;
                          setLocal(status);
                        }
                      }),
                    available,
                  ),
                  destructive: true,
                },
              ]),
            )
          : [note("local-devices-empty", t("settings.accessNoPairedDevices"))]),
      ]),
    );
  }

  nodes.push(
    c.group("worker-peers", t("settings.workerPeersTitle"), [
      ...(workers.discover
        ? [
            c.action(
              "worker-discovery-scan",
              t("settings.workerDiscoveryScan"),
              workers.discover,
              available && !workers.busy,
            ),
            ...(workers.discovered ?? []).flatMap((service) =>
              service.urls.map((url) => ({
                ...c.action(
                  `worker-discovery:${service.hostId}:${encodeURIComponent(url)}`,
                  discoveredWorkerLabel(service),
                  () => {
                    if (!workers.hasDiscoveredEndpoint(service.hostId, url)) return;
                    patch({ lanControlUrl: url });
                    setPairingCode("");
                  },
                  available && !workers.busy,
                ),
                kind: "NavigationRow" as const,
                text: url,
              })),
            ),
            ...(workers.discoveryAttempted && !workers.discovered.length && !workers.busy
              ? [note("worker-discovery-empty", t("settings.workerDiscoveryEmpty"))]
              : []),
          ]
        : []),
      ...(!mobile
        ? [
            input(
              "worker-pair-url",
              t("settings.accessComputerAddress"),
              settings.access.lanControlUrl,
              (lanControlUrl) => patch({ lanControlUrl }),
            ),
            input(
              "worker-pair-code",
              t("settings.accessLanPairingCode"),
              pairingCode,
              setPairingCode,
              false,
              available,
              (value) => value.replace(/\D/g, "").slice(0, 6),
            ),
            input("worker-pair-name", t("settings.accessLanDeviceName"), deviceName, setDeviceName),
            c.action(
              "worker-pair",
              t("settings.accessPairComputer"),
              () => run("worker-pair", pairComputer),
              available &&
                !!settings.access.lanControlUrl.trim() &&
                pairingCode.length === 6 &&
                !!deviceName.trim(),
            ),
          ]
        : []),
      c.action(
        "worker-peers-refresh",
        t("settings.workerPeersRefresh"),
        workers.refresh,
        available && !workers.busy,
      ),
      ...(workers.busy
        ? [
            {
              id: "worker-peers-loading",
              kind: "StatusDot" as const,
              status: "running" as const,
              label: t("settings.workerPeersRefresh"),
            },
          ]
        : []),
      ...(workers.registrationError
        ? [
            {
              id: "worker-peers-registration-error",
              kind: "Banner" as const,
              status: "error" as const,
              label: workers.registrationError,
            },
          ]
        : []),
      ...(workers.error
        ? [
            {
              id: "worker-peers-error",
              kind: "Banner" as const,
              status: "error" as const,
              label: workers.error,
            },
          ]
        : []),
      ...(!workers.peers.length && !workers.busy && !workers.error
        ? [note("worker-peers-empty", t("settings.workerPeersEmpty"))]
        : []),
      ...workers.peers.map((peer) =>
        c.group(`worker-peer:${peer.peerId}`, `${peer.host.platform} · ${peer.peerId}`, [
          {
            id: `worker-peer:${peer.peerId}:status`,
            kind: "StatusDot" as const,
            status: peer.online ? ("completed" as const) : ("paused" as const),
            label: t(peer.online ? "settings.workerPeerOnline" : "settings.workerPeerOffline"),
          },
          ...(peer.online
            ? [
                note(
                  `worker-peer:${peer.peerId}:ready`,
                  t(
                    peer.host.executorReady &&
                      peer.host.acceptsBackgroundTasks &&
                      peer.host.workspaceAvailable
                      ? "settings.workerPeerReady"
                      : "settings.workerPeerNotReady",
                  ),
                ),
              ]
            : []),
          ...(
            peer.endpoints ?? [
              { baseUrl: peer.baseUrl, network: "other", online: peer.online, error: peer.error },
            ]
          ).flatMap((endpoint, index) => [
            note(
              `worker-peer:${peer.peerId}:endpoint:${index}`,
              `${endpoint.baseUrl}\n${t(`settings.workerNetwork${endpoint.network}`)} · ${t(endpoint.online ? "settings.workerPeerOnline" : "settings.workerPeerOffline")}${endpoint.online && peer.online && endpoint.baseUrl === peer.baseUrl ? ` · ${t("settings.workerPeerSelected")}` : ""}`,
            ),
            ...(endpoint.error
              ? [note(`worker-peer:${peer.peerId}:endpoint:${index}:error`, endpoint.error)]
              : []),
            {
              ...c.action(
                `worker-peer:${peer.peerId}:endpoint:${index}:forget`,
                t("settings.workerEndpointForget"),
                () => workers.forgetEndpoint(peer.peerId, endpoint.baseUrl),
                available && !workers.busy,
              ),
              destructive: true,
            },
          ]),
          ...(peer.error
            ? [
                {
                  id: `worker-peer:${peer.peerId}:error`,
                  kind: "Banner" as const,
                  status: "error" as const,
                  label: peer.error,
                },
              ]
            : []),
          {
            ...c.action(
              `worker-peer:${peer.peerId}:forget`,
              t("settings.workerPeerForget"),
              () => workers.forget(peer.peerId),
              available && !workers.busy,
            ),
            destructive: true,
          },
        ]),
      ),
    ]),
  );

  nodes.push(
    c.group(
      "local-capabilities",
      t("settings.accessDevicePermissions"),
      (
        [
          ["terminal", "Terminal", "terminal"],
          ["browser_automation", "BrowserAutomation", "globe"],
          ["ssh", "Ssh", "server.rack"],
          ["git", "Git", "arrow.triangle.branch"],
          ["file_write", "FileWrite", "doc"],
        ] as const
      ).map(([capability, key, icon]) => ({
        ...c.toggle(
          `block:${capability}`,
          t(`settings.accessBlock${key}`),
          settings.access.blockedLocalCapabilities.includes(capability),
          (blocked) => {
            setSettings((previous) => {
              const next = new Set(previous.access.blockedLocalCapabilities);
              if (blocked) next.add(capability);
              else next.delete(capability);
              return updateAccessSettings(previous, { blockedLocalCapabilities: [...next] });
            });
          },
        ),
        icon,
      })),
    ),
  );
  nodes.push(
    c.group("cloud-execution", t("settings.accessCloudExecution"), [
      {
        ...c.toggle(
          "cloud-enabled",
          t("settings.accessCloudExecution"),
          settings.access.cloudExecutionEnabled,
          (cloudExecutionEnabled) => patch({ cloudExecutionEnabled }),
        ),
        icon: "cloud",
      },
      input(
        "github-owner",
        t("settings.accessGithubOwner"),
        settings.access.githubOwner,
        (githubOwner) => patch({ githubOwner }),
      ),
      input(
        "github-repository",
        t("settings.accessGithubRepository"),
        settings.access.githubRepository,
        (githubRepository) => patch({ githubRepository }),
      ),
    ]),
    c.group("cloud-credentials", t("settings.accessSecureVault"), [
      {
        id: "github-token-status",
        kind: "StatusDot",
        status: vault.githubTokenConfigured ? "completed" : "paused",
        label: t(
          vault.githubTokenConfigured
            ? "settings.accessTokenConfigured"
            : "settings.accessTokenMissing",
        ),
      },
      input("github-token", t("settings.accessGithubToken"), token, setToken, true),
      c.action(
        "github-token-save",
        t("settings.accessSaveToken"),
        () =>
          run("github-token-save", async (current) => {
            operation.vaultRevision++;
            const status = await invoke<CloudSecretVaultStatus>(
              "cloud_secret_vault_set_github_token",
              { username: settings.access.githubOwner, token },
            );
            if (current()) {
              operation.vaultRevision++;
              setVault(status);
              setToken((previous) => (previous === token ? "" : previous));
            }
          }),
        available && !!settings.access.githubOwner.trim() && !!token.trim(),
      ),
      ...(vault.githubTokenConfigured
        ? [
            {
              ...c.action(
                "github-token-remove",
                t("settings.accessRemoveToken"),
                () =>
                  run("github-token-remove", async (current) => {
                    operation.vaultRevision++;
                    const status = await invoke<CloudSecretVaultStatus>(
                      "cloud_secret_vault_remove_github_token",
                    );
                    if (current()) {
                      operation.vaultRevision++;
                      setVault(status);
                      setToken("");
                    }
                  }),
                available,
              ),
              destructive: true,
            },
          ]
        : []),
      ...(vault.githubUsername
        ? [
            note(
              "github-token-owner",
              t("settings.accessTokenOwner").replace("{username}", vault.githubUsername),
            ),
          ]
        : []),
    ]),
  );
  if (busy)
    nodes.push({ id: "access-busy", kind: "Progress", label: t("settings.accessConnecting") });
  if (error) nodes.push({ id: "access-error", kind: "Banner", label: error, status: "error" });
  if (!mobile) nodes.push(...agentStartupNodes(c, startup, t));
  nodes.push(...githubAuthorizationNodes(c, github, t));
  nodes.push(...tailscaleSetupNodes(c, tailscale, t, mobile, enabled));
  return { nodes, handlers: c.handlers };
}
