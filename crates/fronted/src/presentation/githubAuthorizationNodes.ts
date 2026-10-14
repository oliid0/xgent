import { githubAuthorizationError } from "../lib/connectors/githubAuthorization";
import type { useGitHubAuthorization } from "../lib/connectors/useGitHubAuthorization";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function githubAuthorizationNodes(
  c: ReturnType<typeof presentationControls>,
  auth: ReturnType<typeof useGitHubAuthorization>,
  t: (key: string) => string,
): PresentationNode[] {
  const pending = auth.status?.phase === "pending",
    starting = auth.status?.phase === "starting" || auth.status?.phase === "verifying";
  return [
    c.group("github-authorization", "GitHub", [
      ...(auth.status?.account
        ? [
            { id: "github-account-login", kind: "Text" as const, text: auth.status.account.login },
            {
              id: "github-account-scopes",
              kind: "HStack" as const,
              spacing: 8,
              children: [
                {
                  id: "github-account-scopes-label",
                  kind: "Text" as const,
                  text: t("settings.githubOAuthPermissions"),
                },
                {
                  id: "github-account-scopes-value",
                  kind: "Text" as const,
                  text: auth.status.account.scopes.join(" · "),
                  secondary: true,
                },
              ],
            },
          ]
        : []),
      c.input(
        "github-oauth-client",
        t("settings.githubOAuthClientId"),
        auth.clientId,
        auth.setClientId,
        false,
        !auth.busy && !pending && !starting,
      ),
      c.action("github-oauth-connect", t("settings.githubOAuthConnect"), auth.start, auth.canStart),
      ...(pending
        ? [
            {
              id: "github-oauth-code",
              kind: "HStack" as const,
              spacing: 8,
              children: [
                {
                  id: "github-oauth-code-label",
                  kind: "Text" as const,
                  text: t("settings.githubOAuthCode"),
                },
                {
                  id: "github-oauth-code-value",
                  kind: "Text" as const,
                  text: auth.status?.userCode ?? "",
                },
              ],
            },
            c.action("github-oauth-copy", t("workspaceEditor.context.copy"), auth.copy, !auth.busy),
            c.action("github-oauth-browser", t("settings.githubOAuthOpen"), auth.open, !auth.busy),
          ]
        : []),
      ...(pending || starting
        ? [c.action("github-oauth-cancel", t("settings.cancel"), auth.cancel, !auth.busy)]
        : []),
      c.action(
        "github-oauth-refresh",
        t("projectTools.gitReview.refresh"),
        auth.refresh,
        !auth.busy,
      ),
      ...((!auth.status && !auth.error) || starting || pending || auth.busy
        ? [
            {
              id: "github-oauth-progress",
              kind: "Progress" as const,
              label: t("settings.githubOAuthConnect"),
            },
          ]
        : []),
      ...(auth.error
        ? [
            {
              id: "github-oauth-error",
              kind: "Banner" as const,
              status: "error" as const,
              label: githubAuthorizationError(auth.error, t),
            },
          ]
        : []),
    ]),
  ];
}
