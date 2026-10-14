import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useLocale } from "../../i18n";
import { tailscaleStatusText } from "../../lib/localAccess";
import { tailscaleErrorMessage } from "../../lib/tailscaleSetup";
import { useTailscaleSetup } from "../../lib/useTailscaleSetup";
import { SecretTextInput } from "./SecretTextInput";

export function TailscaleSetupSection({
  enabled,
  mobile,
  compact = false,
}: {
  enabled: boolean;
  mobile: boolean;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const setup = useTailscaleSetup(enabled, mobile);
  const disabled = !enabled || !!setup.busy;
  return (
    <VStack width="100%" gap={3}>
      <Text type="body" wordBreak="break-word">
        {tailscaleStatusText(setup.status, t)}
      </Text>
      <Selector
        size={compact ? "lg" : "md"}
        label={t("settings.tailscaleAuthMethod")}
        value={setup.mode}
        width="100%"
        isDisabled={disabled}
        options={[
          { value: "auth-key", label: t("settings.tailscaleAuthKey") },
          { value: "oauth", label: t("settings.tailscaleOAuth") },
        ]}
        onChange={(value) => setup.setMode(value === "oauth" ? "oauth" : "auth-key")}
      />
      <SecretTextInput
        label={t(setup.mode === "oauth" ? "settings.tailscaleOAuth" : "settings.tailscaleAuthKey")}
        value={setup.credential}
        onChange={setup.setCredential}
        isDisabled={disabled}
        compact={compact}
        onEnter={() => {
          void setup.connect();
        }}
      />
      {setup.mode === "oauth" ? (
        <TextInput
          size={compact ? "lg" : "md"}
          label={t("settings.tailscaleTags")}
          value={setup.tags}
          onChange={setup.setTags}
          isDisabled={disabled}
          width="100%"
        />
      ) : null}
      <HStack gap={2} wrap="wrap" width="100%">
        <Button
          label={t("settings.tailscaleConnect")}
          variant="primary"
          size={compact ? "lg" : "md"}
          isDisabled={disabled || !setup.canConnect || !setup.credential.trim()}
          isLoading={setup.busy === "connect"}
          onClick={() => {
            void setup.connect();
          }}
        />
        <Button
          label={t("settings.tailscaleLogout")}
          variant="destructive"
          size={compact ? "lg" : "md"}
          isDisabled={disabled || !setup.canLogout}
          isLoading={setup.busy === "logout"}
          onClick={() => {
            void setup.logout();
          }}
        />
        <Button
          label={t("projectTools.gitReview.refresh")}
          variant="secondary"
          size={compact ? "lg" : "md"}
          isDisabled={disabled}
          isLoading={setup.busy === "refresh"}
          onClick={() => {
            void setup.refresh();
          }}
        />
      </HStack>
      {setup.error ? (
        <Banner status="error" title={tailscaleErrorMessage(setup.error, t)} collapsible={false} />
      ) : null}
    </VStack>
  );
}
