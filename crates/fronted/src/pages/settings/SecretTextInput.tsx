import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { InputGroup } from "@astryxdesign/core/InputGroup";
import { TextInput } from "@astryxdesign/core/TextInput";
import { type FocusEvent, useState } from "react";
import { Eye, EyeOff } from "../../components/icons";
import { useLocale } from "../../i18n";

type SecretTextInputProps = {
  label: string;
  value: string;
  description?: string;
  placeholder?: string;
  isDisabled?: boolean;
  disabledMessage?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onEnter?: () => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
};

/** Astryx InputGroup composition for secrets that need an accessible reveal action. */
export function SecretTextInput(props: SecretTextInputProps) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  const visibilityLabel = visible ? t("settings.sshHidePassword") : t("settings.sshShowPassword");

  return (
    <InputGroup
      label={props.label}
      description={props.description}
      isDisabled={props.isDisabled}
      style={{ width: "100%" }}
    >
      <TextInput
        label={props.label}
        isLabelHidden
        type={visible ? "text" : "password"}
        value={props.value}
        placeholder={props.placeholder}
        isDisabled={props.isDisabled}
        disabledMessage={props.disabledMessage}
        width="100%"
        onChange={props.onChange}
        onBlur={props.onBlur}
        onEnter={props.onEnter}
        onFocus={props.onFocus}
      />
      <IconButton
        label={visibilityLabel}
        tooltip={visibilityLabel}
        icon={<Icon icon={visible ? EyeOff : Eye} size="sm" color="inherit" />}
        variant="ghost"
        size="sm"
        isDisabled={props.isDisabled}
        onClick={() => setVisible((current) => !current)}
      />
    </InputGroup>
  );
}
