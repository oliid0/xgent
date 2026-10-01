import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { StackItem, VStack } from "@astryxdesign/core/Stack";
import { type ReactNode, useEffect, useRef } from "react";
import { t as translate } from "../i18n";
import type { AppSettings } from "../lib/settings";
import { presentationControls } from "../presentation/controls";
import { NativeSurface } from "../presentation/NativeSurface";
import { createNativePresentationTheme } from "../presentation/nativeTheme";
import { isApplePresentationRuntime } from "../runtime/applePresentation";

type StartupPresentationProps = { settings: AppSettings; nativeMobile: boolean };

function useReload() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return () => {
    if (active.current) window.location.reload();
  };
}

export function AppStartupSurface(
  props: StartupPresentationProps & {
    failures: string[];
    settingsFailure?: string;
    startupFailure?: string;
  },
) {
  const reload = useReload(),
    { settings, nativeMobile } = props;
  const failure = props.settingsFailure || props.startupFailure || props.failures.length > 0;
  const title = props.settingsFailure ?? translate("app.mobileStartupDegraded", settings.locale);
  const description = props.startupFailure ?? props.failures.join(" · ");
  const reloadLabel = translate("app.errorBoundaryReload", settings.locale);
  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    return (
      <NativeSurface
        document={{
          mode: "root",
          title: "",
          appearance: settings.theme,
          formFactor: nativeMobile ? "mobile" : "desktop",
          theme: createNativePresentationTheme(settings, nativeMobile),
          nodes: failure
            ? [
                {
                  id: "startup:screen",
                  kind: "Banner",
                  variant: "error-screen",
                  label: title,
                  text: description,
                  status: "error",
                  icon: "exclamationmark.triangle",
                  children: [c.action("startup:reload", reloadLabel, reload)],
                },
              ]
            : [],
        }}
        handlers={c.handlers}
        onError={(error) => console.error("Native startup presentation failed", error)}
      />
    );
  }
  if (props.settingsFailure || props.startupFailure)
    return (
      <Banner
        status="error"
        container="section"
        title={title}
        description={props.startupFailure}
        collapsible={false}
        endContent={<Button size="sm" variant="secondary" label={reloadLabel} onClick={reload} />}
      />
    );
  if (props.failures.length === 0) return null;
  return <MobileStartupWarning {...props} />;
}

export function MobileStartupWarning(props: StartupPresentationProps & { failures: string[] }) {
  const reload = useReload(),
    { settings, nativeMobile } = props;
  if (props.failures.length === 0) return null;
  const title = translate("app.mobileStartupDegraded", settings.locale),
    description = props.failures.join(" · ");
  const reloadLabel = translate("app.errorBoundaryReload", settings.locale);
  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    return (
      <NativeSurface
        document={{
          mode: "status",
          title: "",
          appearance: settings.theme,
          formFactor: nativeMobile ? "mobile" : "desktop",
          theme: createNativePresentationTheme(settings, nativeMobile),
          nodes: [
            {
              id: "startup:status",
              kind: "Banner",
              variant: "service-status",
              label: title,
              text: description,
              status: "pending",
              icon: "exclamationmark.triangle",
              children: [c.action("startup:reload", reloadLabel, reload)],
            },
          ],
        }}
        handlers={c.handlers}
        onError={(error) => console.error("Native startup warning failed", error)}
      />
    );
  }
  return (
    <Banner
      status="warning"
      container="section"
      title={title}
      description={description}
      collapsible={false}
      endContent={<Button size="sm" variant="secondary" label={reloadLabel} onClick={reload} />}
    />
  );
}

/** Native documents own their layout; Astryx owns the other platform shell. */
export function AppConversationSurface(
  props: StartupPresentationProps & { failures: string[]; children: ReactNode },
) {
  const warning =
    props.nativeMobile && props.failures.length > 0 ? <MobileStartupWarning {...props} /> : null;
  if (isApplePresentationRuntime())
    return (
      <>
        {warning}
        {props.children}
      </>
    );
  return (
    <VStack width="100%" height="100%" gap={0}>
      {warning}
      <StackItem size="fill">{props.children}</StackItem>
    </VStack>
  );
}
