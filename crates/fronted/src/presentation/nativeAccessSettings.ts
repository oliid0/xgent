import { invoke, listen } from "@xgent/runtime";
import { useEffect, useState } from "react";
import { browserSessionController } from "../lib/browser/browserSessionController";
import {
  type CloudSecretVaultStatus,
  type LanPcClientStatus,
  type LocalAccessStatus,
  normalizeComparableLanUrl,
  normalizeLanControlUrl,
} from "../lib/localAccess";
import { type AppSettings, updateAccessSettings } from "../lib/settings";
import { writeClipboardText } from "../lib/system/clipboardText";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

/** Shared Rust services; SwiftUI owns the native page and each form control. */
export function useNativeAccessSettings(
  { settings, setSettings }: SettingsSectionProps,
  enabled: boolean,
  mobile: boolean,
  t: (key: string) => string,
  onOpenComputer: () => void,
) {
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
  const [deviceName, setDeviceName] = useState("Xgent mobile");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [operation] = useState(() => ({
    active: enabled,
    revision: 0,
    localRevision: 0,
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
    const status = await invoke<LocalAccessStatus>("local_access_status");
    if (current() && revision === operation.localRevision) setLocal(status);
  }

  async function refreshLan(current: () => boolean) {
    const status = await invoke<LanPcClientStatus>("lan_pc_status");
    if (!current()) return;
    setLan(status);
    const address = normalizeComparableLanUrl(status.baseUrl);
    if (status.paired && address) patch({ lanControlUrl: `${address}/` });
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
    void invoke<CloudSecretVaultStatus>("cloud_secret_vault_status")
      .then((status) => {
        if (current()) setVault(status);
      })
      .catch(report);
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
        note("lan-description", t("settings.accessLanControlHint")),
        {
          id: "lan-status",
          kind: "StatusDot",
          status: ready ? "completed" : "paused",
          label: t(ready ? "settings.accessComputerPaired" : "settings.accessComputerNotPaired"),
        },
        c.input(
          "lan-url",
          t("settings.accessComputerAddress"),
          settings.access.lanControlUrl,
          (lanControlUrl) => patch({ lanControlUrl }),
        ),
        c.input(
          "lan-pairing-code",
          t("settings.accessLanPairingCode"),
          pairingCode,
          setPairingCode,
          false,
          available,
          (value) => value.replace(/\D/g, "").slice(0, 6),
        ),
        c.input("lan-device-name", t("settings.accessLanDeviceName"), deviceName, setDeviceName),
        c.action(
          "lan-pair",
          t("settings.accessPairComputer"),
          () =>
            run("lan-pair", async (current) => {
              const baseUrl = normalizeLanControlUrl(settings.access.lanControlUrl);
              const status = await invoke<LanPcClientStatus>("lan_pc_pair", {
                baseUrl,
                code: pairingCode,
                deviceName: deviceName.trim(),
              });
              if (current()) {
                setLan(status);
                setPairingCode("");
                patch({
                  lanControlUrl: status.baseUrl ? normalizeLanControlUrl(status.baseUrl) : baseUrl,
                });
              }
            }),
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
                    const status = await invoke<LanPcClientStatus>("lan_pc_disconnect");
                    if (current()) {
                      setLan(status);
                      patch({ preferLanPcExecution: false });
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
          text: t("settings.accessPreferLanPcHint"),
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
        c.toggle("ios-ashell", "a-Shell", settings.access.iosAShellEnabled, (iosAShellEnabled) =>
          patch({ iosAShellEnabled }),
        ),
        note("lan-pairing-hint", t("settings.accessLanPairingHint")),
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
        note("web-ui-description", t("settings.accessWebUiHint")),
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
    c.group(
      "local-capabilities",
      t("settings.accessPairing"),
      (
        [
          ["terminal", "Terminal"],
          ["browser_automation", "BrowserAutomation"],
          ["ssh", "Ssh"],
          ["git", "Git"],
          ["file_write", "FileWrite"],
        ] as const
      ).map(([capability, key]) => ({
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
        text: t(`settings.accessBlock${key}Hint`),
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
        text: t("settings.accessCloudExecutionHint"),
      },
      c.input(
        "github-owner",
        t("settings.accessGithubOwner"),
        settings.access.githubOwner,
        (githubOwner) => patch({ githubOwner }),
      ),
      c.input(
        "github-repository",
        t("settings.accessGithubRepository"),
        settings.access.githubRepository,
        (githubRepository) => patch({ githubRepository }),
      ),
      note("cloud-environment-hint", t("settings.accessCloudEnvironmentHint")),
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
      c.input("github-token", t("settings.accessGithubToken"), token, setToken, true),
      c.action(
        "github-token-save",
        t("settings.accessSaveToken"),
        () =>
          run("github-token-save", async (current) => {
            const status = await invoke<CloudSecretVaultStatus>(
              "cloud_secret_vault_set_github_token",
              { username: settings.access.githubOwner, token },
            );
            if (current()) {
              setVault(status);
              setToken("");
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
                    const status = await invoke<CloudSecretVaultStatus>(
                      "cloud_secret_vault_remove_github_token",
                    );
                    if (current()) {
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
      note("github-vault-hint", t("settings.accessVaultHint")),
    ]),
  );
  if (busy)
    nodes.push({ id: "access-busy", kind: "Progress", label: t("settings.accessConnecting") });
  if (error) nodes.push({ id: "access-error", kind: "Banner", label: error, status: "error" });
  return { nodes, handlers: c.handlers };
}
