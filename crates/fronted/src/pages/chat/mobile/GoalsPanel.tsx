import { Dialog } from "@astryxdesign/core/Dialog";
import { VStack } from "@astryxdesign/core/Layout";
import { useLocale } from "../../../i18n";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { GoalsSection } from "../../settings/GoalsSection";
import type { SettingsSectionProps } from "../../settings/types";
import { MobileFullscreenPanel } from "./MobilePanelScaffold";

export function GoalsPanel(
  props: SettingsSectionProps & { open: boolean; mobile: boolean; onClose: () => void },
) {
  const { t } = useLocale();
  if (!props.open) return null;
  const content = (
    <GoalsSection
      settings={props.settings}
      setSettings={props.setSettings}
      onBack={props.onClose}
      nativePresentationMode={props.mobile ? "root" : "sheet"}
    />
  );
  if (isApplePresentationRuntime()) return content;
  if (props.mobile)
    return (
      <MobileFullscreenPanel open label={t("goals.title")} onBack={props.onClose}>
        <VStack width="100%" minHeight={0} className="goals-panel-content">
          {content}
        </VStack>
      </MobileFullscreenPanel>
    );
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      width="min(640px, calc(100vw - 32px))"
      aria-label={t("goals.title")}
    >
      <VStack width="100%" className="goals-panel-content">
        {content}
      </VStack>
    </Dialog>
  );
}
