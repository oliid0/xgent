import type { AppSettings } from "../../lib/settings";
import { PERSONAL_POLICY_PREFIX } from "../../lib/tools/mobileAssistantPolicy";
import type { SectionId } from "./types";

/** Summaries come from saved configuration, never guessed permission or runtime state. */
export function mobileSettingsStatus(
  id: SectionId,
  settings: AppSettings,
  t: (key: string) => string,
): string | undefined {
  switch (id) {
    case "system":
      return t(
        settings.locale === "system"
          ? "settings.native.system"
          : settings.locale === "zh-CN"
            ? "settings.chinese"
            : "settings.english",
      );
    case "providers":
      return t("settings.mobile.providerCount").replace(
        "{count}",
        String(settings.customProviders.length),
      );
    case "toolPermissions": {
      const count = Object.keys(settings.system.toolPolicies ?? {}).filter(
        (key) => !key.startsWith(PERSONAL_POLICY_PREFIX),
      ).length;
      return count
        ? t("settings.mobile.policyCount").replace("{count}", String(count))
        : t("settings.mobile.defaultPolicy");
    }
    case "voice":
      return t(settings.stt.enabled ? "settings.mobile.enabled" : "settings.mobile.disabled");
    case "access":
      return t(
        settings.access.cloudExecutionEnabled
          ? "settings.mobile.localAndCloud"
          : "settings.mobile.local",
      );
    default:
      return undefined;
  }
}
