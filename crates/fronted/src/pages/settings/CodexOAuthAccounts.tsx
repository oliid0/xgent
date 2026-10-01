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

import { CheckCircle2, Trash2 } from "../../components/icons";
import { useLocale } from "../../i18n";
import { useCodexOAuthAccounts } from "./useCodexOAuthAccounts";

type Props = {
  value: string;
  onChange: (accountId: string) => void;
  browserRuntime: boolean;
};

export function CodexOAuthAccounts({ value, onChange, browserRuntime }: Props) {
  const { t } = useLocale();
  const data = useCodexOAuthAccounts({ value, onChange, browserRuntime }, t);
  const { status, deviceCode, loading, starting, error, startLogin, removeAccount, selectAccount } =
    data;

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
        <Center style={{ minHeight: "var(--xgent-oauth-list-min-height)" }}>
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
                    isDisabled={data.locked || Boolean(deviceCode)}
                    onClick={() => void removeAccount(account.id)}
                  />
                }
                isSelected={selected}
                onClick={() => selectAccount(account.id)}
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
              isDisabled={data.locked}
              onClick={() => void data.copyCode()}
            />
            <HStack gap={2} vAlign="center">
              <Spinner size="sm" aria-hidden="true" />
              <Text type="supporting" color="secondary">
                {t("settings.providerOAuthWaitingHint")}
              </Text>
            </HStack>
            <HStack gap={2}>
              <Button
                label={t("settings.providerOAuthOpenBrowser")}
                variant="secondary"
                isDisabled={data.locked}
                onClick={() => void data.reopenLogin()}
              />
              <Button
                label={t("settings.cancel")}
                variant="ghost"
                onClick={() => void data.cancelLogin()}
              />
            </HStack>
          </VStack>
        </Card>
      ) : null}

      <Button
        label={t("settings.providerOAuthAddAccount")}
        variant="secondary"
        width="100%"
        isLoading={starting}
        isDisabled={data.locked || Boolean(deviceCode)}
        onClick={() => void startLogin()}
      />
      {!data.loaded && !loading ? (
        <Button
          label={t("presentation.retry")}
          variant="secondary"
          isDisabled={data.locked}
          onClick={() => void data.reload()}
        />
      ) : null}
      {error ? <Banner status="error" title={error} collapsible={false} /> : null}
    </VStack>
  );
}
