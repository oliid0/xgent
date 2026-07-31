import { invoke, openUrl } from "@xagent/runtime";
import { useCallback, useEffect, useRef, useState } from "react";

import { CheckCircle2, Loader2, Plus, Trash2 } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import { cn } from "../../lib/shared/utils";

type CodexOAuthAccount = {
  id: string;
  email?: string;
  planType?: string;
  isDefault: boolean;
};

type CodexOAuthStatus = {
  accounts: CodexOAuthAccount[];
  defaultAccountId?: string;
};

type CodexOAuthDeviceCode = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalSeconds: number;
};

type CodexOAuthPollResult = {
  state: "pending" | "complete";
  account?: CodexOAuthAccount;
};

type Props = {
  value: string;
  onChange: (accountId: string) => void;
  browserRuntime: boolean;
};

export function CodexOAuthAccounts({ value, onChange, browserRuntime }: Props) {
  const { t } = useLocale();
  const [status, setStatus] = useState<CodexOAuthStatus>({
    accounts: [],
  });
  const [deviceCode, setDeviceCode] = useState<CodexOAuthDeviceCode | null>(null);
  const [loading, setLoading] = useState(!browserRuntime);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = useCallback(async () => {
    if (browserRuntime) return;
    const next = await invoke<CodexOAuthStatus>("provider_oauth_status_codex");
    setStatus(next);
    if (!value && next.defaultAccountId) onChange(next.defaultAccountId);
  }, [browserRuntime, onChange, value]);

  useEffect(() => {
    if (browserRuntime) return;
    setLoading(true);
    void loadStatus()
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [browserRuntime, loadStatus]);

  useEffect(() => {
    if (!deviceCode || browserRuntime) return;
    let disposed = false;

    const poll = async () => {
      try {
        const result = await invoke<CodexOAuthPollResult>("provider_oauth_poll_codex", {
          flowId: deviceCode.flowId,
        });
        if (disposed) return;
        if (result.state === "complete") {
          setDeviceCode(null);
          await loadStatus();
          if (result.account?.id) onChange(result.account.id);
          return;
        }
        pollTimerRef.current = setTimeout(
          () => void poll(),
          Math.max(3, deviceCode.intervalSeconds) * 1000,
        );
      } catch (reason) {
        if (disposed) return;
        setDeviceCode(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    pollTimerRef.current = setTimeout(
      () => void poll(),
      Math.max(3, deviceCode.intervalSeconds) * 1000,
    );
    return () => {
      disposed = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [browserRuntime, deviceCode, loadStatus, onChange]);

  async function startLogin() {
    setStarting(true);
    setError(null);
    try {
      const flow = await invoke<CodexOAuthDeviceCode>("provider_oauth_start_codex");
      setDeviceCode(flow);
      await openUrl(flow.verificationUriComplete || flow.verificationUri);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }

  async function removeAccount(accountId: string) {
    setError(null);
    try {
      const next = await invoke<CodexOAuthStatus>("provider_oauth_remove_codex_account", {
        accountId,
      });
      setStatus(next);
      if (value === accountId) onChange(next.defaultAccountId ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (browserRuntime) {
    return (
      <div className="rounded-xl border bg-muted/25 px-3 py-3 text-xs leading-5 text-muted-foreground">
        {value
          ? `${t("settings.providerOAuthSelectedAccount")}: ${value}`
          : t("settings.providerOAuthManageInApp")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.loading")}
          </div>
        ) : status.accounts.length > 0 ? (
          <div className="divide-y">
            {status.accounts.map((account) => {
              const selected = value === account.id;
              return (
                <div
                  key={account.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 transition-colors",
                    selected ? "bg-primary/8" : "hover:bg-accent/35",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => onChange(account.id)}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        selected && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {account.email || t("settings.providerOAuthOpenAIAccount")}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[account.planType, account.id].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void removeAccount(account.id)}
                    title={t("settings.providerOAuthRemoveAccount")}
                    aria-label={t("settings.providerOAuthRemoveAccount")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-5 text-center text-xs text-muted-foreground">
            {t("settings.providerOAuthNoAccounts")}
          </div>
        )}
      </div>

      {deviceCode ? (
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-3">
          <div className="text-xs font-medium">{t("settings.providerOAuthWaiting")}</div>
          <button
            type="button"
            className="mt-2 rounded-lg border bg-background px-3 py-1.5 font-mono text-base font-semibold tracking-[0.18em]"
            onClick={() => void navigator.clipboard?.writeText(deviceCode.userCode)}
            title={t("settings.providerOAuthCopyCode")}
          >
            {deviceCode.userCode}
          </button>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("settings.providerOAuthWaitingHint")}
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        disabled={starting || Boolean(deviceCode)}
        onClick={() => void startLogin()}
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {t("settings.providerOAuthAddAccount")}
      </Button>
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
