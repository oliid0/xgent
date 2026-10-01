/** Public metadata returned by the existing provider_oauth Tauri commands.
 * Access/refresh tokens stay in ProviderOAuthService's protected vault.
 */
export type CodexOAuthAccount = {
  id: string;
  email?: string;
  planType?: string;
  isDefault: boolean;
};

export type CodexOAuthStatus = {
  accounts: CodexOAuthAccount[];
  defaultAccountId?: string;
};

export type CodexOAuthDeviceCode = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** UNIX seconds, matching the Rust command response. */
  expiresAt: number;
  intervalSeconds: number;
};

export type CodexOAuthPollResult = {
  state: "pending" | "complete";
  account?: CodexOAuthAccount;
};

export function deviceLoginURL(flow: CodexOAuthDeviceCode): string {
  const url = new URL(flow.verificationUriComplete || flow.verificationUri);
  if (url.protocol !== "https:")
    throw new Error("OpenAI sign-in requires an HTTPS verification URL");
  return url.href;
}
