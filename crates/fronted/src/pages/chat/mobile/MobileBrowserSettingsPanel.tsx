import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { StackItem, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { type FormEvent, useEffect, useState } from "react";
import { Globe, Shield, Trash2 } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  browserSessionController,
  normalizeBrowserAddress,
} from "../../../lib/browser/browserSessionController";
import {
  type AppSettings,
  updateAccessSettings,
  updateCustomSettings,
} from "../../../lib/settings";
import { MobileFullscreenPanel, MobilePanelHeader } from "./MobilePanelScaffold";

type MobileBrowserSettingsPanelProps = {
  open: boolean;
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onClose: () => void;
};

export function MobileBrowserSettingsPanel(props: MobileBrowserSettingsPanelProps) {
  const { t } = useLocale();
  const [homePage, setHomePage] = useState(props.settings.customSettings.browser.homePage);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (props.open) setHomePage(props.settings.customSettings.browser.homePage);
  }, [props.open, props.settings.customSettings.browser.homePage]);

  if (!props.open) return null;

  const saveHomePage = (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = normalizeBrowserAddress(homePage);
    setHomePage(normalized);
    browserSessionController.configure({ homePage: normalized });
    props.setSettings((prev) =>
      updateCustomSettings(prev, {
        browser: { ...prev.customSettings.browser, homePage: normalized },
      }),
    );
  };

  return (
    <MobileFullscreenPanel open label={t("chat.mobileMenu.browserSettings")}>
      <MobilePanelHeader
        title={t("chat.mobileMenu.browserSettings")}
        backLabel={t("settings.close")}
        onBack={props.onClose}
      />

      <StackItem size="fill" isScrollable>
        <VStack gap={6} padding={4}>
          <VStack gap={2}>
            <Heading level={3}>{t("browser.homePage")}</Heading>
            <form onSubmit={saveHomePage}>
              <FormLayout>
                <TextInput
                  label={t("browser.homePage")}
                  startIcon={Globe}
                  hasClear
                  size="lg"
                  width="100%"
                  value={homePage}
                  onChange={setHomePage}
                  onBlur={() => saveHomePage()}
                  placeholder="https://www.google.com/"
                />
              </FormLayout>
            </form>
          </VStack>

          <VStack gap={2}>
            <Heading level={3}>{t("browser.automation")}</Heading>
            <Switch
              label={t("settings.accessAllowBrowserAutomation")}
              description={t("settings.accessAllowBrowserAutomationHint")}
              labelIcon={Shield}
              labelPosition="start"
              labelSpacing="spread"
              width="100%"
              value={props.settings.access.allowBrowserAutomation}
              onChange={(allowBrowserAutomation) =>
                props.setSettings((prev) => updateAccessSettings(prev, { allowBrowserAutomation }))
              }
            />
          </VStack>

          <VStack gap={2}>
            <Heading level={3}>{t("browser.privacy")}</Heading>
            <Button
              label={t("browser.clearSessions")}
              icon={<Trash2 />}
              variant="destructive"
              size="lg"
              width="100%"
              isLoading={clearing}
              isDisabled={clearing}
              onClick={() => {
                setClearing(true);
                void browserSessionController.closeAllSessions().finally(() => setClearing(false));
              }}
            />
          </VStack>
        </VStack>
      </StackItem>
    </MobileFullscreenPanel>
  );
}
