import { Switch } from "@astryxdesign/core/Switch";
import { Sparkle } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { ChatRuntimeControls } from "../../../lib/settings";

export function IntelligentSchedulingControl(props: {
  controls: ChatRuntimeControls;
  disabled: boolean;
  agentMode: boolean;
  onChange: (patch: Partial<ChatRuntimeControls>) => void;
}) {
  const { t } = useLocale();
  return (
    <Switch
      label={t("chat.runtime.intelligentScheduling")}
      description={t("chat.runtime.intelligentSchedulingHint")}
      value={props.controls.intelligentSchedulingEnabled === true}
      onChange={(value) => {
        if (!props.disabled && props.agentMode)
          props.onChange({ intelligentSchedulingEnabled: value });
      }}
      labelIcon={Sparkle}
      labelPosition="start"
      labelSpacing="spread"
      size="sm"
      width="100%"
      isDisabled={props.disabled || !props.agentMode}
      disabledMessage={
        !props.agentMode ? t("chat.runtime.intelligentSchedulingAgentOnly") : undefined
      }
    />
  );
}
