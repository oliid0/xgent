import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useLocale } from "../../i18n";
import { githubAuthorizationError } from "../../lib/connectors/githubAuthorization";
import { useGitHubAuthorization } from "../../lib/connectors/useGitHubAuthorization";
import { SettingsRow, SettingsRowGroup } from "./shared";

export function GitHubAuthorizationSection({
  enabled,
  onConnected,
}: {
  enabled: boolean;
  onConnected?: () => Promise<void>;
}) {
  const { t } = useLocale();
  const auth = useGitHubAuthorization(enabled, onConnected);
  const pending = auth.status?.phase === "pending",
    starting = auth.status?.phase === "starting" || auth.status?.phase === "verifying";
  if (!enabled) return null;
  return (
    <VStack gap={3} width="100%">
      <SettingsRowGroup title="GitHub">
        {auth.status?.account ? (
          <>
            <ListItem label={auth.status.account.login} />
            <SettingsRow label={t("settings.githubOAuthPermissions")}>
              <Text wordBreak="break-word">{auth.status.account.scopes.join(" · ")}</Text>
            </SettingsRow>
          </>
        ) : null}
        <ListItem
          label={
            <TextInput
              label={t("settings.githubOAuthClientId")}
              value={auth.clientId}
              onChange={auth.setClientId}
              width="100%"
              size="lg"
              isDisabled={!!auth.busy || pending || starting}
            />
          }
        />
        {pending ? (
          <SettingsRow label={t("settings.githubOAuthCode")}>
            <Text>{auth.status?.userCode}</Text>
          </SettingsRow>
        ) : null}
      </SettingsRowGroup>
      <HStack gap={2} wrap="wrap" width="100%">
        <Button
          label={t("settings.githubOAuthConnect")}
          variant="primary"
          size="lg"
          isDisabled={!auth.canStart}
          isLoading={auth.busy === "start" || starting}
          onClick={() => void auth.start()}
        />
        {pending ? (
          <>
            <Button
              label={t("workspaceEditor.context.copy")}
              size="lg"
              isDisabled={!!auth.busy}
              onClick={() => void auth.copy()}
            />
            <Button
              label={t("settings.githubOAuthOpen")}
              size="lg"
              isDisabled={!!auth.busy}
              onClick={() => void auth.open()}
            />
          </>
        ) : null}
        {pending || starting ? (
          <Button
            label={t("settings.cancel")}
            size="lg"
            isDisabled={!!auth.busy}
            onClick={() => void auth.cancel()}
          />
        ) : null}
        <Button
          label={t("projectTools.gitReview.refresh")}
          size="lg"
          isDisabled={!!auth.busy}
          isLoading={auth.busy === "refresh"}
          onClick={() => void auth.refresh()}
        />
      </HStack>
      {auth.error ? (
        <Banner
          status="error"
          title={githubAuthorizationError(auth.error, t)}
          collapsible={false}
        />
      ) : null}
    </VStack>
  );
}
