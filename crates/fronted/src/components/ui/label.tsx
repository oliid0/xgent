import { Text } from "@astryxdesign/core/Text";
import { forwardRef, type LabelHTMLAttributes } from "react";

/** Astryx typography-backed form label used during field-by-field migration. */
export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, style, children, color: _color, ...props }, ref) {
    return (
      <Text
        {...props}
        ref={ref}
        as="label"
        type="label"
        weight="medium"
        className={className}
        style={style}
      >
        {children}
      </Text>
    );
  },
);
