import { Switch as AstryxSwitch } from "@astryxdesign/core/Switch";
import type { ButtonHTMLAttributes } from "react";

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
  required?: boolean;
};

/** Astryx-native compatibility boundary for the previous checked/onCheckedChange API. */
export function Switch({
  checked,
  onCheckedChange,
  label: explicitLabel,
  className,
  style,
  disabled,
  title,
  "aria-label": ariaLabel,
  name,
  required,
  onFocus,
  onBlur,
  color: _color,
  children: _children,
  ...props
}: SwitchProps) {
  const label = explicitLabel ?? ariaLabel ?? title ?? name ?? "Toggle";
  return (
    <AstryxSwitch
      {...props}
      label={label}
      isLabelHidden
      value={checked}
      onChange={onCheckedChange}
      isDisabled={disabled}
      htmlName={name}
      isRequired={required}
      onFocus={onFocus as never}
      onBlur={onBlur as never}
      className={className}
      style={style}
    />
  );
}
