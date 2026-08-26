import { TextArea } from "@astryxdesign/core/TextArea";
import { forwardRef, type TextareaHTMLAttributes } from "react";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
};

function getAccessibleLabel(props: TextareaProps): string {
  const ariaLabel = props["aria-label"];
  if (typeof ariaLabel === "string" && ariaLabel) return ariaLabel;
  if (props.label) return props.label;
  if (props.placeholder) return props.placeholder;
  if (props.name) return props.name;
  if (props.id) return props.id;
  return "Text area";
}

/** Astryx-native compatibility boundary for legacy textarea call sites. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(props, ref) {
    const {
      label: explicitLabel,
      value,
      onChange,
      disabled,
      readOnly,
      required,
      autoFocus,
      name,
      className,
      style,
      placeholder,
      rows,
      maxLength,
      spellCheck,
      onPaste,
      onFocus,
      onBlur,
      color: _color,
      ...rest
    } = props;

    return (
      <TextArea
        {...rest}
        ref={ref}
        label={getAccessibleLabel({ ...props, label: explicitLabel })}
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
        rows={rows}
        maxLength={maxLength}
        hasSpellCheck={
          spellCheck == null ? undefined : spellCheck === true || spellCheck === "true"
        }
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
        width="100%"
      />
    );
  },
);
