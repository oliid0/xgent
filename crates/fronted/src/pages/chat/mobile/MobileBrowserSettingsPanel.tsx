import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { StackItem, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { type FormEvent, useEffect, useState } from "react";
import { Globe, Shield } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  browserSessionController,
  normalizeBrowserAddress,
} from "../../../lib/browser/browserSessionController";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";
import {
  type AppSettings,
  updateAccessSettings,
  updateCustomSettings,
} from "../../../lib/settings";
import { presentationControls } from "../../../presentation/controls";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
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
  const [error, setError] = useState("");

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

  if (isApplePresentationRuntime()) {
    const compact = isNativeMobileRuntime();
    const c = presentationControls();
    c.handlers.set("close", {
      enabled: !clearing,
      accepts: (value) => value === null,
      run: props.onClose,
    });
    const blocked = props.settings.access.blockedLocalCapabilities.includes("browser_automation");
    return (
      <NativeSurface
        document={{
          mode: "sheet",
          title: t("chat.mobileMenu.browserSettings"),
          appearance: props.settings.theme,
          formFactor: compact ? "mobile" : "desktop",
          theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
          dismissAction: clearing ? undefined : "close",
          nodes: [
            c.group("browser-home", t("browser.homePage"), [
              c.input("browser-home-page", t("browser.homePage"), homePage, setHomePage),
              c.action("browser-home-save", t("settings.save"), saveHomePage, !clearing),
            ]),
            c.group("browser-automation", t("browser.automation"), [
              c.toggle(
                "browser-automation-blocked",
                t("settings.accessBlockBrowserAutomation"),
                blocked,
                (nextBlocked) =>
                  props.setSettings((previous) => {
                    const capabilities = new Set(previous.access.blockedLocalCapabilities);
                    if (nextBlocked) capabilities.add("browser_automation");
                    else capabilities.delete("browser_automation");
                    return updateAccessSettings(previous, {
                      blockedLocalCapabilities: Array.from(capabilities),
                    });
                  }),
              ),
            ]),
            c.group("browser-privacy", t("browser.privacy"), [
              {
                ...c.action(
                  "browser-clear-sessions",
                  t("browser.clearSessions"),
                  async () => {
                    setClearing(true);
                    setError("");
                    try {
                      await browserSessionController.closeAllSessions();
                    } finally {
                      setClearing(false);
                    }
                  },
                  !clearing,
                ),
                destructive: true,
              },
            ]),
            ...(clearing
              ? [{ id: "browser-clearing", kind: "Progress" as const, label: t("app.loading") }]
              : []),
            ...(error
              ? [
                  {
                    id: "browser-settings-error",
                    kind: "Banner" as const,
                    label: error,
                    status: "error" as const,
                  },
                ]
              : []),
          ],
        }}
        handlers={c.handlers}
        onError={(cause) => setError(cause instanceof Error ? cause.message : String(cause))}
      />
    );
  }

  return (
    <MobileFullscreenPanel open label={t("chat.mobileMenu.browserSettings")}>
      <MobilePanelHeader
        title={t("chat.mobileMenu.browserSettings")}
        backLabel={t("settings.close")}
        onBack={props.onClose}
      />

      <StackItem size="fill" isScrollable>
        <VStack
          gap={6}
          padding={4}
          style={{
            paddingBlockEnd: "max(var(--spacing-4), env(safe-area-inset-bottom, 0px))",
            paddingInlineStart: "max(var(--spacing-4), env(safe-area-inset-left, 0px))",
            paddingInlineEnd: "max(var(--spacing-4), env(safe-area-inset-right, 0px))",
          }}
        >
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
                  placeholder="about:blank"
                />
              </FormLayout>
            </form>
          </VStack>

          <VStack gap={2}>
            <Heading level={3}>{t("browser.automation")}</Heading>
            <Switch
              label={t("settings.accessBlockBrowserAutomation")}
              description={t("settings.accessBlockBrowserAutomationHint")}
              labelIcon={Shield}
              labelPosition="start"
              labelSpacing="spread"
              width="100%"
              value={props.settings.access.blockedLocalCapabilities.includes("browser_automation")}
              onChange={(blocked) =>
                props.setSettings((prev) => {
                  const capabilities = new Set(prev.access.blockedLocalCapabilities);
                  if (blocked) capabilities.add("browser_automation");
                  else capabilities.delete("browser_automation");
                  return updateAccessSettings(prev, {
                    blockedLocalCapabilities: Array.from(capabilities),
                  });
                })
              }
            />
          </VStack>

          <VStack gap={2}>
            <Heading level={3}>{t("browser.privacy")}</Heading>
            <Button
              label={t("browser.clearSessions")}
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
