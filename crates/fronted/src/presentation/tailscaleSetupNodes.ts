import { tailscaleStatusText } from "../lib/localAccess";
import { tailscaleErrorMessage } from "../lib/tailscaleSetup";
import type { useTailscaleSetup } from "../lib/useTailscaleSetup";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function tailscaleSetupNodes(
  c: ReturnType<typeof presentationControls>,
  setup: ReturnType<typeof useTailscaleSetup>,
  t: (key: string) => string,
  _mobile: boolean,
  enabled: boolean,
): PresentationNode[] {
  const available = enabled && !setup.busy;
  return [
    c.group("tailscale-setup", "Tailscale", [
      {
        id: "tailscale-observed",
        kind: "Text",
        text: tailscaleStatusText(setup.status, t),
        secondary: true,
      },
      c.select(
        "tailscale-auth-mode",
        t("settings.tailscaleAuthMethod"),
        setup.mode,
        [
          { value: "auth-key", label: t("settings.tailscaleAuthKey") },
          { value: "oauth", label: t("settings.tailscaleOAuth") },
        ],
        (value) => setup.setMode(value === "oauth" ? "oauth" : "auth-key"),
        available,
      ),
      c.input(
        "tailscale-credential",
        t(setup.mode === "oauth" ? "settings.tailscaleOAuth" : "settings.tailscaleAuthKey"),
        setup.credential,
        setup.setCredential,
        true,
        available,
      ),
      ...(setup.mode === "oauth"
        ? [
            c.input(
              "tailscale-tags",
              t("settings.tailscaleTags"),
              setup.tags,
              setup.setTags,
              false,
              available,
            ),
          ]
        : []),
      c.action(
        "tailscale-connect",
        t("settings.tailscaleConnect"),
        setup.connect,
        available && setup.canConnect && !!setup.credential.trim(),
      ),
      c.action(
        "tailscale-logout",
        t("settings.tailscaleLogout"),
        setup.logout,
        available && setup.canLogout,
      ),
      c.action("tailscale-refresh", t("projectTools.gitReview.refresh"), setup.refresh, available),
      ...(setup.busy
        ? [
            {
              id: "tailscale-progress",
              kind: "Progress" as const,
              label: t("settings.tailscaleBusy"),
            },
          ]
        : []),
      ...(setup.error
        ? [
            {
              id: "tailscale-error",
              kind: "Banner" as const,
              label: tailscaleErrorMessage(setup.error, t),
              status: "error" as const,
            },
          ]
        : []),
    ]),
  ];
}
