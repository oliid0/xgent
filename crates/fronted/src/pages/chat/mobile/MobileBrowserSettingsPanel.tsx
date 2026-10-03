import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { StackItem, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { type FormEvent, useEffect, useRef, useState } from "react";
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
  const homePageRef = useRef(homePage);
  const openRef = useRef(props.open);
  openRef.current = props.open;
  const lifetime = useRef(0);
  const mounted = useRef(false);
  const activeOperation = useRef<symbol | null>(null);

  useEffect(() => {
    if (props.open) {
      homePageRef.current = props.settings.customSettings.browser.homePage;
      setHomePage(homePageRef.current);
    }
  }, [props.open, props.settings.customSettings.browser.homePage]);
  useEffect(() => {
    mounted.current = true;
    lifetime.current += 1;
    activeOperation.current = null;
    setClearing(false);
    setError("");
    return () => {
      mounted.current = false;
      lifetime.current += 1;
      activeOperation.current = null;
    };
  }, [props.open]);

  const editHomePage = (value: string) => {
    if (!mounted.current || !openRef.current) return;
    homePageRef.current = value;
    setHomePage(value);
  };
  const clearSessions = async () => {
    if (!mounted.current || !openRef.current || activeOperation.current) return;
    const token = Symbol("clear-browser-sessions");
    activeOperation.current = token;
    const epoch = lifetime.current;
    const current = () =>
      openRef.current && epoch === lifetime.current && activeOperation.current === token;
    setClearing(true);
    setError("");
    try {
      await browserSessionController.closeAllSessions();
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current()) {
        activeOperation.current = null;
        setClearing(false);
      }
    }
  };

  if (!props.open) return null;

  const saveHomePage = (event?: FormEvent) => {
    event?.preventDefault();
    if (!mounted.current || !openRef.current) return;
    const normalized = normalizeBrowserAddress(homePageRef.current);
    editHomePage(normalized);
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
      run: () => {
        if (mounted.current && openRef.current && !activeOperation.current) props.onClose();
      },
    });
    c.handlers.set("browser-home-save", {
      enabled: !clearing,
      accepts: (value) => value === null || typeof value === "string",
      run: (value) => {
        if (typeof value === "string") editHomePage(value);
        saveHomePage();
      },
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
              {
                id: "browser-home-row",
                kind: "VStack",
                variant: "browser-home-row",
                children: [
                  c.input(
                    "browser-home-page",
                    t("browser.homePage"),
                    homePage,
                    editHomePage,
                    false,
                    !clearing,
                  ),
                  {
                    id: "browser-home-save",
                    kind: "Button",
                    label: t("settings.save"),
                    disabled: clearing,
                    action: "browser-home-save",
                  },
                ],
              },
            ]),
            c.group("browser-automation", t("browser.automation"), [
              {
                ...c.toggle(
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
                text: t("settings.accessBlockBrowserAutomationHint"),
              },
            ]),
            c.group("browser-privacy", t("browser.privacy"), [
              {
                ...c.action(
                  "browser-clear-sessions",
                  t("browser.clearSessions"),
                  clearSessions,
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
        onError={(cause) => {
          if (mounted.current && openRef.current)
            setError(cause instanceof Error ? cause.message : String(cause));
        }}
      />
    );
  }

  return (
    <MobileFullscreenPanel open label={t("chat.mobileMenu.browserSettings")} onBack={props.onClose}>
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
                  onChange={editHomePage}
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
                void clearSessions();
              }}
            />
            {error ? <Banner status="error" title={error} collapsible={false} /> : null}
          </VStack>
        </VStack>
      </StackItem>
    </MobileFullscreenPanel>
  );
}
