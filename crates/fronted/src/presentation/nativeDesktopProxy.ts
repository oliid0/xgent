import { useEffect, useState } from "react";
import { isValidSystemProxyHost, type SystemProxyConfig, updateSystem } from "../lib/settings";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";

type ProxyDraft = Partial<Pick<SystemProxyConfig, "type" | "host" | "username" | "password">> & {
  port?: string;
};

/** Keep incomplete edits local; save through the existing settings/Rust proxy pipeline. */
export function useNativeDesktopProxy(
  { settings, setSettings }: SettingsSectionProps,
  enabled: boolean,
  t: (key: string) => string,
) {
  const [draft, setDraft] = useState<ProxyDraft>({});
  useEffect(() => {
    if (!enabled) setDraft({});
  }, [enabled]);
  const c = presentationControls();
  if (!enabled) return { nodes: [], handlers: c.handlers };

  const proxy = settings.system.systemProxy;
  const type = draft.type ?? proxy.type;
  const host = draft.host ?? proxy.host;
  const port = draft.port ?? (proxy.port > 0 ? String(proxy.port) : "");
  const username = draft.username ?? proxy.username;
  const password = draft.password ?? proxy.password;
  const parsedPort = Number(port.trim());
  const hostValid = isValidSystemProxyHost(host);
  const portValid = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
  const valid = hostValid && portValid;
  const dirty = Object.keys(draft).length > 0;
  const passwordConfigured = proxy.passwordConfigured === true || proxy.password.length > 0;

  function patchProxy(patch: Partial<SystemProxyConfig>) {
    setSettings((previous) =>
      updateSystem(previous, {
        systemProxy: { ...previous.system.systemProxy, ...patch },
      }),
    );
  }

  function save(nextEnabled = proxy.enabled) {
    if (!valid) throw new Error(t("settings.systemProxyEnableHint"));
    patchProxy({
      enabled: nextEnabled,
      type,
      host: host.trim(),
      port: parsedPort,
      username: username.trim(),
      // Blank drafts preserve a configured credential; the separate clear action owns removal.
      ...(draft.password !== undefined && (draft.password.length > 0 || !passwordConfigured)
        ? { password: draft.password }
        : {}),
    });
    setDraft({});
  }

  const fields = [
    {
      ...c.toggle(
        "proxy-enabled",
        t("settings.systemProxyEnable"),
        proxy.enabled,
        (nextEnabled) => {
          if (nextEnabled) save(true);
          else patchProxy({ enabled: false });
        },
        valid || proxy.enabled,
      ),
      text: t(valid ? "settings.systemProxyDesc" : "settings.systemProxyEnableHint"),
    },
    c.select(
      "proxy-type",
      t("settings.systemProxyType"),
      type,
      [
        { value: "http", label: "HTTP" },
        { value: "socks5", label: "SOCKS5" },
      ],
      (value) =>
        setDraft((previous) => ({ ...previous, type: value as SystemProxyConfig["type"] })),
    ),
    {
      ...c.input("proxy-host", t("settings.systemProxyHost"), host, (value) =>
        setDraft((previous) => ({ ...previous, host: value })),
      ),
      text: "127.0.0.1",
      accessibilityHint: !hostValid ? t("settings.systemProxyInvalid") : undefined,
    },
    {
      ...c.input("proxy-port", t("settings.systemProxyPort"), port, (value) =>
        setDraft((previous) => ({ ...previous, port: value })),
      ),
      text: type === "socks5" ? "1080" : "7890",
      accessibilityHint: !portValid ? t("settings.systemProxyInvalid") : undefined,
    },
    c.input("proxy-username", t("settings.systemProxyUsername"), username, (value) =>
      setDraft((previous) => ({ ...previous, username: value })),
    ),
    c.input(
      "proxy-password",
      t("settings.systemProxyPassword"),
      password,
      (value) => setDraft((previous) => ({ ...previous, password: value })),
      true,
    ),
    ...(passwordConfigured && !password.trim()
      ? [
          {
            id: "proxy-password-status",
            kind: "Text" as const,
            secondary: true,
            text: t("settings.systemProxyPasswordConfigured"),
          },
        ]
      : []),
    ...(!valid && (dirty || proxy.enabled)
      ? [
          {
            id: "proxy-validation",
            kind: "StatusDot" as const,
            status: "error" as const,
            label: t("settings.systemProxyInvalid"),
          },
        ]
      : []),
    ...(passwordConfigured || password.length > 0
      ? [
          c.action("proxy-password-clear", t("settings.systemProxyPasswordClear"), () => {
            patchProxy({ password: "", passwordConfigured: false });
            setDraft((previous) => ({ ...previous, password: "" }));
          }),
        ]
      : []),
    c.action("proxy-save", t("settings.save"), () => save(), valid && dirty),
  ];
  return {
    nodes: [c.group("desktop-proxy", t("settings.systemProxy"), fields)],
    handlers: c.handlers,
  };
}
