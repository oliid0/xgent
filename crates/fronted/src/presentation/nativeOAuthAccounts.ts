import type { useCodexOAuthAccounts } from "../pages/settings/useCodexOAuthAccounts";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

/** Uses the existing settings controls; business behavior is shared with Astryx. */
export function nativeOAuthAccounts(
  c: ReturnType<typeof presentationControls>,
  data: ReturnType<typeof useCodexOAuthAccounts>,
  value: string,
  t: (key: string) => string,
): PresentationNode {
  const children: PresentationNode[] = [];
  if (data.loading)
    children.push({ id: "oauth-loading", kind: "Progress", label: t("settings.loading") });
  if (!data.loaded && !data.loading)
    children.push(c.action("oauth-retry", t("presentation.retry"), data.reload, !data.locked));
  if (data.loaded && !data.status.accounts.length)
    children.push({
      id: "oauth-empty",
      kind: "EmptyState",
      label: t("settings.providerOAuthNoAccounts"),
    });
  for (const account of data.status.accounts) {
    children.push({
      id: `oauth-account:${account.id}`,
      kind: "VStack",
      children: [
        {
          id: `oauth-account-label:${account.id}`,
          kind: "Text",
          text: account.email || t("settings.providerOAuthOpenAIAccount"),
        },
        {
          id: `oauth-account-info:${account.id}`,
          kind: "Text",
          text: [account.planType, account.id].filter(Boolean).join(" · "),
          secondary: true,
        },
        {
          ...c.action(
            `oauth-select:${account.id}`,
            t("settings.providerOAuthSelectedAccount"),
            () => data.selectAccount(account.id),
            !data.locked && !data.deviceCode,
          ),
          selected: value === account.id,
          prominent: value === account.id,
        },
        {
          ...c.action(
            `oauth-remove:${account.id}`,
            t("settings.providerOAuthRemoveAccount"),
            () => data.removeAccount(account.id),
            !data.locked && !data.deviceCode,
          ),
          destructive: true,
        },
      ],
    });
  }
  if (data.deviceCode)
    children.push({
      id: "oauth-login",
      kind: "VStack",
      children: [
        { id: "oauth-login-label", kind: "Text", text: t("settings.providerOAuthWaiting") },
        { id: "oauth-code", kind: "Text", text: data.deviceCode.userCode },
        { id: "oauth-waiting", kind: "Progress", label: t("settings.providerOAuthWaitingHint") },
        c.action("oauth-copy", t("settings.providerOAuthCopyCode"), data.copyCode, !data.locked),
        c.action(
          "oauth-open",
          t("settings.providerOAuthOpenBrowser"),
          data.reopenLogin,
          !data.locked,
        ),
        c.action("oauth-cancel", t("settings.cancel"), data.cancelLogin),
      ],
    });
  children.push(
    c.action(
      "oauth-add",
      t("settings.providerOAuthAddAccount"),
      data.startLogin,
      !data.locked && !data.deviceCode,
    ),
  );
  if (data.error)
    children.push({ id: "oauth-error", kind: "Banner", label: data.error, status: "error" });
  return c.group("oauth-accounts", t("settings.providerOAuthAccounts"), children);
}
