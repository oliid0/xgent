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

function resolveVariant(
  variant: LegacyButtonVariant | undefined,
  className: string | undefined,
  isIconOnly: boolean,
): AstryxButtonProps["variant"] {
  if (variant) return VARIANT_MAP[variant];

  const classes = className?.split(/\s+/).filter(Boolean) ?? [];
  const hasClass = (name: string) => classes.includes(name);
  const hasClassPrefix = (prefix: string) => classes.some((name) => name.startsWith(prefix));
  if (hasClass("bg-destructive")) return "destructive";
  if (hasClass("bg-primary")) return "primary";

  // Legacy row and toolbar controls carried their interaction surface in the
  // parent row. Rendering them as filled Astryx buttons creates the pill soup
  // visible throughout sidebars, menus and dense lists.
  if (
    isIconOnly ||
    hasClass("w-full") ||
    hasClass("text-left") ||
    hasClass("justify-start") ||
    hasClass("bg-transparent") ||
    hasClass("border-0") ||
    hasClass("shadow-none") ||
    hasClassPrefix("bg-foreground") ||
    hasClassPrefix("bg-background") ||
    hasClassPrefix("bg-muted") ||
    hasClassPrefix("bg-primary/") ||
    hasClassPrefix("bg-destructive/") ||
    hasClassPrefix("text-foreground") ||
    hasClassPrefix("text-muted-foreground") ||
    hasClassPrefix("text-background") ||
    hasClassPrefix("text-primary") ||
    hasClassPrefix("text-destructive")
  ) {
    return "ghost";
  }

  // An unqualified legacy button represented the view's commit action.
  return "primary";
}

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

function hasExplicitHeight(className: string | undefined): boolean {
  return (
    className?.split(/\s+/).some((name) => {
      const utility = name.split(":").at(-1) ?? name;
      return utility.startsWith("h-") || utility.startsWith("size-");
    }) ?? false
  );
}

function usesRichLayout(className: string | undefined, children: ReactNode): boolean {
  if (Children.count(children) < 2) return false;
  return (
    className?.split(/\s+/).some((name) => {
      const utility = name.split(":").at(-1) ?? name;
      return [
        "grid",
        "inline-grid",
        "flex-col",
        "items-start",
        "justify-start",
        "text-left",
      ].includes(utility);
    }) ?? false
  );
}

function resolveContentSlots(children: ReactNode, isIconOnly: boolean) {
  const nodes = Children.toArray(children);
  if (isIconOnly || nodes.length < 2) {
    return { icon: isIconOnly ? children : undefined, content: children, endContent: undefined };
  }

  let start = 0;
  let end = nodes.length;
  let icon: ReactNode;
  let endContent: ReactNode;

  if (getNodeText(nodes[0]).length === 0) {
    icon = nodes[0];
    start += 1;
  }
  if (end - start > 1 && getNodeText(nodes[end - 1]).length === 0) {
    endContent = nodes[end - 1];
    end -= 1;
  }

  const contentNodes = nodes.slice(start, end);
  return {
    icon,
    content: contentNodes.length === 1 ? contentNodes[0] : contentNodes,
    endContent,
  };
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
    style,
    variant,
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
  const resolvedVariant = resolveVariant(variant, className, isIconOnly);
  const hasRichLayout = !isIconOnly && usesRichLayout(className, children);
  const slots = hasRichLayout
    ? { icon: undefined, content: children, endContent: undefined }
    : resolveContentSlots(children, isIconOnly);
  const usesIntrinsicHeight =
    !hasExplicitHeight(className) &&
    Boolean(
      className
        ?.split(/\s+/)
        .some((name) =>
          ["grid", "inline-grid", "flex-col", "items-start", "text-left"].includes(
            name.split(":").at(-1) ?? name,
          ),
        ),
    );

  return (
    <AstryxButton
      {...props}
      ref={ref}
      label={label}
      aria-label={ariaLabel}
      tooltip={title}
      className={className}
      data-xagent-rich-layout={hasRichLayout ? "true" : undefined}
      style={usesIntrinsicHeight ? { ...style, height: "auto", whiteSpace: "normal" } : style}
      variant={resolvedVariant}
      size={size === "icon" ? "md" : SIZE_MAP[size]}
      isDisabled={disabled}
      isLoading={isLoading}
      isIconOnly={isIconOnly}
      icon={slots.icon}
      endContent={slots.endContent}
    >
      {isIconOnly ? undefined : slots.content}
    </AstryxButton>
  );
});
