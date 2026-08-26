import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { invoke, openUrl } from "@xagent/runtime";
import { useCallback, useEffect, useRef, useState } from "react";

import { CheckCircle2, Plus, Trash2 } from "../../components/icons";
import { useLocale } from "../../i18n";

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
  const [status, setStatus] = useState<CodexOAuthStatus>({ accounts: [] });
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
      <Banner
        status="info"
        title={
          value
            ? `${t("settings.providerOAuthSelectedAccount")}: ${value}`
            : t("settings.providerOAuthManageInApp")
        }
        collapsible={false}
      />
    );
  }

  return (
    <VStack gap={3}>
      {loading ? (
        <Center style={{ minHeight: "var(--xagent-oauth-list-min-height)" }}>
          <Spinner label={t("settings.loading")} />
        </Center>
      ) : status.accounts.length > 0 ? (
        <List
          density="balanced"
          hasDividers
          aria-label={t("settings.providerOAuthSelectedAccount")}
        >
          {status.accounts.map((account) => {
            const selected = value === account.id;
            const label = account.email || t("settings.providerOAuthOpenAIAccount");
            return (
              <ListItem
                key={account.id}
                label={label}
                description={[account.planType, account.id].filter(Boolean).join(" · ")}
                startContent={
                  <StatusDot
                    variant={selected ? "success" : "neutral"}
                    label={selected ? t("settings.providerOAuthSelectedAccount") : label}
                    icon={
                      selected ? <Icon icon={CheckCircle2} size="xsm" color="inherit" /> : undefined
                    }
                  />
                }
                endContent={
                  <IconButton
                    label={t("settings.providerOAuthRemoveAccount")}
                    tooltip={t("settings.providerOAuthRemoveAccount")}
                    icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                    size="sm"
                    variant="ghost"
                    onClick={() => void removeAccount(account.id)}
                  />
                }
                isSelected={selected}
                onClick={() => onChange(account.id)}
              />
            );
          })}
        </List>
      ) : (
        <EmptyState title={t("settings.providerOAuthNoAccounts")} isCompact />
      )}

      {deviceCode ? (
        <Card variant="blue" padding={3}>
          <VStack gap={2}>
            <Text type="label" weight="medium">
              {t("settings.providerOAuthWaiting")}
            </Text>
            <Button
              label={deviceCode.userCode}
              tooltip={t("settings.providerOAuthCopyCode")}
              variant="secondary"
              size="lg"
              onClick={() => void navigator.clipboard?.writeText(deviceCode.userCode)}
            />
            <HStack gap={2} vAlign="center">
              <Spinner size="sm" aria-hidden="true" />
              <Text type="supporting" color="secondary">
                {t("settings.providerOAuthWaitingHint")}
              </Text>
            </HStack>
          </VStack>
        </Card>
      ) : null}

      <Button
        label={t("settings.providerOAuthAddAccount")}
        icon={<Icon icon={Plus} size="sm" color="inherit" />}
        variant="secondary"
        width="100%"
        isLoading={starting}
        isDisabled={Boolean(deviceCode)}
        onClick={() => void startLogin()}
      />
      {error ? <Banner status="error" title={error} collapsible={false} /> : null}
    </VStack>
  );
}
