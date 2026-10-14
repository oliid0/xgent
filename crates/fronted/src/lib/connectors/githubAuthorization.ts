export type GitHubOAuthAccount = {
  accountId: string;
  githubUserId: string;
  login: string;
  clientId: string;
  scopes: string[];
  authenticatedAt: number;
  expiresAt: number | null;
};
export type GitHubAuthorizationStatus = {
  phase: "idle" | "starting" | "pending" | "verifying" | "connected" | "expired" | "error";
  flowId: string | null;
  userCode: string | null;
  expiresAt: number | null;
  nextPollAt: number | null;
  account: GitHubOAuthAccount | null;
  error: string | null;
};

export function parseGitHubAuthorizationStatus(value: unknown): GitHubAuthorizationStatus {
  if (!value || typeof value !== "object") throw new Error("github-oauth-response");
  const data = value as Record<string, unknown>;
  const text = (value: unknown, max: number) =>
    value === null || value === undefined
      ? null
      : typeof value === "string" && value.length <= max
        ? value
        : undefined;
  const number = (value: unknown) =>
    value === null || value === undefined
      ? null
      : typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
  const phase = data.phase;
  if (
    typeof phase !== "string" ||
    !["idle", "starting", "pending", "verifying", "connected", "expired", "error"].includes(phase)
  )
    throw new Error("github-oauth-response");
  const flowId = text(data.flowId, 64),
    userCode = text(data.userCode, 16),
    error = text(data.error, 128);
  const expiresAt = number(data.expiresAt),
    nextPollAt = number(data.nextPollAt);
  if (
    [flowId, userCode, error, expiresAt, nextPollAt].some((value) => value === undefined) ||
    (["starting", "verifying"].includes(phase) && !flowId) ||
    (phase === "pending" && (!flowId || !userCode || !expiresAt || !nextPollAt))
  )
    throw new Error("github-oauth-response");
  let account: GitHubOAuthAccount | null = null;
  if (data.account != null) {
    const raw = data.account as Record<string, unknown>;
    const accountId = text(raw.accountId, 64),
      githubUserId = text(raw.githubUserId, 32),
      login = text(raw.login, 39),
      clientId = text(raw.clientId, 256),
      authenticatedAt = number(raw.authenticatedAt),
      expiresAt = number(raw.expiresAt);
    if (
      !accountId ||
      !githubUserId ||
      !login ||
      !clientId ||
      !authenticatedAt ||
      expiresAt === undefined ||
      !Array.isArray(raw.scopes) ||
      raw.scopes.length > 64 ||
      raw.scopes.some(
        (scope) => typeof scope !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(scope),
      )
    )
      throw new Error("github-oauth-response");
    account = {
      accountId,
      githubUserId,
      login,
      clientId,
      authenticatedAt,
      expiresAt,
      scopes: [...raw.scopes],
    };
  }
  if (["connected", "expired"].includes(phase) && !account)
    throw new Error("github-oauth-response");
  return {
    phase: phase as GitHubAuthorizationStatus["phase"],
    flowId: flowId ?? null,
    userCode: userCode ?? null,
    expiresAt: expiresAt ?? null,
    nextPollAt: nextPollAt ?? null,
    account,
    error: error ?? null,
  };
}

export function githubAuthorizationError(cause: unknown, t: (key: string) => string) {
  const error = cause instanceof Error ? cause.message : String(cause);
  const keys: Record<string, string> = {
    "github-oauth-client-id": "settings.githubOAuthClientError",
    "github-oauth-disabled": "settings.githubOAuthDisabled",
    "github-oauth-expired": "settings.githubOAuthExpired",
    "github-oauth-denied": "settings.githubOAuthDenied",
    "github-oauth-network": "settings.githubOAuthNetwork",
    "github-oauth-retired": "settings.githubOAuthChanged",
    "github-oauth-credential-changed": "settings.githubOAuthChanged",
    "github-oauth-scope": "settings.githubOAuthScopeError",
    "github-oauth-scope-changed": "settings.githubOAuthScopeError",
    "github-oauth-refresh-unknown": "settings.githubOAuthRefreshUnknown",
    "github-oauth-open": "settings.githubOAuthOpenError",
  };
  return t(keys[error] ?? "settings.githubOAuthFailed");
}
