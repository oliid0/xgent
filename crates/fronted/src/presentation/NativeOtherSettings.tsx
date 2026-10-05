import { useState, useSyncExternalStore } from "react";
import { useLocale } from "../i18n";
import type { SettingsSaveState } from "../lib/settings/storage";
import { CronSection } from "../pages/settings/CronSection";
import { HooksSection } from "../pages/settings/HooksSection";
import { SshSettingsSection } from "../pages/settings/SshSettingsSection";
import type { SettingsSectionProps } from "../pages/settings/types";
import { NativeSurface } from "./NativeSurface";
import { createNativeOtherContentStore } from "./nativeOtherContent";
import { createNativePresentationTheme } from "./nativeTheme";

export function NativeOtherSettings(
  props: SettingsSectionProps & {
    mobile: boolean;
    onBack: () => void;
    onClose: () => void;
    saveState?: SettingsSaveState;
  },
) {
  const { t } = useLocale();
  const [store] = useState(createNativeOtherContentStore);
  // A cached snapshot avoids re-rendering when only a controller's closures change.
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [error, setError] = useState("");
  const content = store.compose({
    title: t("settings.navOther"),
    appearance: props.settings.theme,
    theme: createNativePresentationTheme(props.settings, props.mobile, "workspaceTools"),
    mobile: props.mobile,
    backLabel: t("settings.mobile.backToSettings"),
    detailBackLabel: t("settings.native.back"),
    onBack: props.onBack,
    onClose: props.onClose,
    labels: {
      hooks: { title: t("settings.navHooks"), description: t("settings.mobile.hooksDescription") },
      cron: { title: t("settings.navCron"), description: t("settings.mobile.cronDescription") },
      ssh: { title: t("settings.navSsh"), description: t("settings.mobile.sshDescription") },
    },
  });
  if (error)
    content.document.nodes.push({
      id: "other-content-error",
      kind: "Banner",
      status: "error",
      label: error,
    });
  if (props.mobile && props.saveState?.status === "error")
    content.document.nodes.push({
      id: "save-status",
      kind: "Text",
      secondary: false,
      text: props.saveState.message,
    });
  return (
    <>
      <HooksSection {...props} nativeOtherSink={store.sinks.hooks} />
      <CronSection {...props} nativeOtherSink={store.sinks.cron} />
      <SshSettingsSection {...props} nativeOtherSink={store.sinks.ssh} />
      <NativeSurface
        sessionSurface={props.nativeSettingsSurfaceId}
        document={content.document}
        handlers={content.handlers}
        onError={(error) => setError(String(error))}
      />
    </>
  );
}
