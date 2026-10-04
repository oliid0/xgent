import { useEffect, useState } from "react";
import { isValidSystemProxyHost, type SystemProxyConfig, updateSystem } from "../lib/settings";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";

type ProxyDraft = Partial<Pick<SystemProxyConfig, "host" | "username" | "password">> & {
  port?: string;
};

/** Match SystemSettingsForm's expansion and blur/Return commits using the shared Rust pipeline. */
export function useNativeDesktopProxy(
  { settings, setSettings }: SettingsSectionProps,
  enabled: boolean,
  t: (key: string) => string,
) {
  const [draft, setDraft] = useState<ProxyDraft>({});
  const [configOpen, setConfigOpen] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setDraft({});
      setConfigOpen(false);
    }
  }, [enabled]);
  const c = presentationControls();
  if (!enabled) return { nodes: [], handlers: c.handlers };

  const proxy = settings.system.systemProxy;
  const type = proxy.type;
  const host = draft.host ?? proxy.host;
  const port = draft.port ?? (proxy.port > 0 ? String(proxy.port) : "");
  const username = draft.username ?? proxy.username;
  const password = draft.password ?? proxy.password;
  const parsedPort = Number(port.trim());
  const hostValid = isValidSystemProxyHost(host);
  const portValid = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
  const valid = hostValid && portValid;
  const passwordConfigured = proxy.passwordConfigured === true || proxy.password.length > 0;

  function patchProxy(patch: Partial<SystemProxyConfig>) {
    setSettings((previous) =>
      updateSystem(previous, {
        systemProxy: { ...previous.system.systemProxy, ...patch },
      }),
    );
  }

  function commit(key: keyof ProxyDraft, value: string) {
    if (key === "port") {
      const parsed = Number(value.trim());
      patchProxy({ port: Number.isInteger(parsed) ? parsed : 0 });
    } else if (key === "password") {
      // A blank field preserves a redacted credential; the clear action owns removal.
      if (value.length > 0 || !passwordConfigured) patchProxy({ password: value });
    } else patchProxy({ [key]: value.trim() });
    setDraft((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  const fields = [
    {
      ...c.toggle("proxy-enabled", t("settings.systemProxy"), proxy.enabled, (nextEnabled) => {
        if (!nextEnabled) {
          patchProxy({ enabled: false });
          setConfigOpen(false);
        } else if (!valid) setConfigOpen(true);
        else {
          patchProxy({
            enabled: true,
            host: host.trim(),
            port: parsedPort,
            username: username.trim(),
            ...(draft.password !== undefined && (password.length > 0 || !passwordConfigured)
              ? { password }
              : {}),
          });
          setDraft({});
          setConfigOpen(false);
        }
      }),
      text: t(
        proxy.enabled && !valid
          ? "settings.systemProxyInvalid"
          : configOpen && !valid
            ? "settings.systemProxyEnableHint"
            : "settings.systemProxyDesc",
      ),
    },
    ...(proxy.enabled || configOpen
      ? [
          c.select(
            "proxy-type",
            t("settings.systemProxyType"),
            type,
            [
              { value: "http", label: "HTTP" },
              { value: "socks5", label: "SOCKS5" },
            ],
            (value) => patchProxy({ type: value as SystemProxyConfig["type"] }),
          ),
          {
            ...c.committedInput(
              "proxy-host",
              t("settings.systemProxyHost"),
              host,
              (value) => setDraft((previous) => ({ ...previous, host: value })),
              (value) => commit("host", value),
              false,
              true,
              (value) => value.trim(),
            ),
            text: "127.0.0.1",
            accessibilityHint:
              host.trim() && !hostValid ? t("settings.systemProxyInvalid") : undefined,
          },
          {
            ...c.committedInput(
              "proxy-port",
              t("settings.systemProxyPort"),
              port,
              (value) => setDraft((previous) => ({ ...previous, port: value })),
              (value) => commit("port", value),
              false,
              true,
              (value) => {
                const parsed = Number(value.trim());
                return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "";
              },
            ),
            text: type === "socks5" ? "1080" : "7890",
            accessibilityHint: !portValid ? t("settings.systemProxyInvalid") : undefined,
          },
          c.committedInput(
            "proxy-username",
            t("settings.systemProxyUsername"),
            username,
            (value) => setDraft((previous) => ({ ...previous, username: value })),
            (value) => commit("username", value),
            false,
            true,
            (value) => value.trim(),
          ),
          c.committedInput(
            "proxy-password",
            t("settings.systemProxyPassword"),
            password,
            (value) => setDraft((previous) => ({ ...previous, password: value })),
            (value) => commit("password", value),
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
          ...(!valid
            ? [
                {
                  id: "proxy-validation",
                  kind: "StatusDot" as const,
                  status: "error" as const,
                  label: t("settings.systemProxyInvalid"),
                },
              ]
            : []),
          ...(passwordConfigured
            ? [
                c.action("proxy-password-clear", t("settings.systemProxyPasswordClear"), () => {
                  patchProxy({ password: "", passwordConfigured: false });
                  setDraft((previous) => ({ ...previous, password: "" }));
                }),
              ]
            : []),
        ]
      : []),
  ];
  return {
    nodes: [c.group("desktop-proxy", t("settings.systemProxy"), fields)],
    handlers: c.handlers,
  };
}
