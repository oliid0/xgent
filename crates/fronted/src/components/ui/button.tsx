import {
  Button as AstryxButton,
  type ButtonProps as AstryxButtonProps,
} from "@astryxdesign/core/Button";
import {
  type ButtonHTMLAttributes,
  Children,
  forwardRef,
  isValidElement,
  type ReactNode,
} from "react";

type LegacyButtonVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
type LegacyButtonSize = "default" | "sm" | "lg" | "icon";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> & {
  label?: string;
  variant?: LegacyButtonVariant;
  size?: LegacyButtonSize;
  isLoading?: boolean;
};

const VARIANT_MAP: Record<LegacyButtonVariant, AstryxButtonProps["variant"]> = {
  default: "primary",
  secondary: "secondary",
  destructive: "destructive",
  outline: "secondary",
  ghost: "ghost",
  link: "ghost",
};

const SIZE_MAP: Record<Exclude<LegacyButtonSize, "icon">, AstryxButtonProps["size"]> = {
  default: "md",
  sm: "sm",
  lg: "lg",
};

function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(" ").trim();
  if (isValidElement<{ children?: ReactNode }>(node)) return getNodeText(node.props.children);
  return "";
}

/**
 * Compatibility boundary while call sites move to Astryx's explicit Button API.
 * The rendered control is always the native Astryx Button; legacy variant names
 * only map product intent to Astryx variants.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    label: explicitLabel,
    "aria-label": ariaLabel,
    title,
    className,
    variant = "default",
    size = "default",
    children,
    disabled,
    autoFocus: _autoFocus,
    isLoading = false,
    ...props
  },
  ref,
) {
  const visibleText = getNodeText(Children.toArray(children));
  const label = (explicitLabel ?? ariaLabel ?? title ?? visibleText) || "Action";
  const isIconOnly =
    size === "icon" || (visibleText.length === 0 && Boolean(explicitLabel ?? ariaLabel ?? title));

  return (
    <AstryxButton
      {...props}
      ref={ref}
      label={label}
      aria-label={ariaLabel}
      tooltip={title}
      className={className}
      variant={VARIANT_MAP[variant]}
      size={size === "icon" ? "md" : SIZE_MAP[size]}
      isDisabled={disabled}
      isLoading={isLoading}
      isIconOnly={isIconOnly}
      icon={isIconOnly ? children : undefined}
    >
      {isIconOnly ? undefined : children}
    </AstryxButton>
  );
});
