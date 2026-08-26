import { NumberInput } from "@astryxdesign/core/NumberInput";
import { TextInput } from "@astryxdesign/core/TextInput";
import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

function getAccessibleLabel(props: InputProps): string {
  const ariaLabel = props["aria-label"];
  if (typeof ariaLabel === "string" && ariaLabel) return ariaLabel;
  if (props.label) return props.label;
  if (props.placeholder) return props.placeholder;
  if (props.name) return props.name;
  if (props.id) return props.id;
  return "Input";
}

function createNumberChangeEvent(value: number | null): ChangeEvent<HTMLInputElement> {
  const input = { value: value == null ? "" : String(value) } as HTMLInputElement;
  return {
    target: input,
    currentTarget: input,
    bubbles: true,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 3,
    isTrusted: true,
    nativeEvent: new Event("change"),
    preventDefault() {},
    isDefaultPrevented: () => false,
    stopPropagation() {},
    isPropagationStopped: () => false,
    persist() {},
    timeStamp: Date.now(),
    type: "change",
  } as ChangeEvent<HTMLInputElement>;
}

/** Astryx-native compatibility boundary for legacy input call sites. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  const {
    label: explicitLabel,
    type = "text",
    value,
    onChange,
    disabled,
    readOnly,
    required,
    autoFocus,
    name,
    className,
    style,
    size: _htmlSize,
    color: _color,
    placeholder,
    min,
    max,
    step,
    autoComplete,
    onFocus,
    onBlur,
    onKeyDown,
    ...rest
  } = props;
  const label = getAccessibleLabel({ ...props, label: explicitLabel });

  if (type === "number") {
    const numericValue = value === "" || value == null ? null : Number(value);
    return (
      <NumberInput
        {...rest}
        ref={ref}
        label={label}
        isLabelHidden
        value={numericValue != null && Number.isFinite(numericValue) ? numericValue : null}
        onChange={(nextValue) => onChange?.(createNumberChangeEvent(nextValue))}
        isDisabled={disabled}
        isReadOnly={readOnly}
        isRequired={required}
        hasAutoFocus={autoFocus}
        htmlName={name}
        className={className}
        style={style}
        placeholder={placeholder}
        min={min == null ? null : Number(min)}
        max={max == null ? null : Number(max)}
        step={step == null || step === "any" ? null : Number(step)}
        autoComplete={autoComplete}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        isWheelEnabled={false}
      />
    );
  }

  let supportedType: "email" | "password" | "text" = "text";
  if (type === "password") supportedType = "password";
  if (type === "email") supportedType = "email";
  return (
    <TextInput
      {...rest}
      ref={ref}
      type={supportedType}
      label={label}
      isLabelHidden
      value={value == null ? "" : String(value)}
      onChange={(_nextValue, event) => onChange?.(event)}
      isDisabled={disabled}
      isReadOnly={readOnly}
      isRequired={required}
      hasAutoFocus={autoFocus}
      htmlName={name}
      className={className}
      style={style}
      placeholder={placeholder}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
});
