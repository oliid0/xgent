import { Heading as AstryxHeading, type HeadingLevel } from "@astryxdesign/core/Heading";
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { type ElementType, forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/shared/utils";

export type ViewProps = Omit<HTMLAttributes<HTMLElement>, "color"> & {
  as?: ElementType;
  layout?: "block" | "flex" | "inline-flex" | "grid" | "inline-grid";
  direction?: "horizontal" | "vertical";
};

/**
 * Neutral Astryx layout primitive for regions without a more specific product
 * component. Display is explicit so migration preserves block/flex/grid
 * geometry while Stack supplies the design-system layout boundary.
 */
export const View = forwardRef<HTMLElement, ViewProps>(function View(
  { as = "div", layout, direction, style, className, children, ...props },
  ref,
) {
  const classTokens = className?.split(/\s+/) ?? [];
  const resolvedLayout =
    layout ??
    (classTokens.includes("inline-grid")
      ? "inline-grid"
      : classTokens.includes("inline-flex")
        ? "inline-flex"
        : classTokens.includes("grid")
          ? "grid"
          : classTokens.includes("flex")
            ? "flex"
            : "block");
  const resolvedDirection =
    direction ?? (classTokens.includes("flex-col") ? "vertical" : "horizontal");
  return (
    <Stack
      {...props}
      ref={ref}
      as={as}
      direction={resolvedDirection}
      className={cn(resolvedLayout, className)}
      style={style}
    >
      {children}
    </Stack>
  );
});

/** Inline Astryx text primitive that preserves legacy span event/ARIA props. */
export const Inline = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Inline(
  { children, color: _color, ...props },
  ref,
) {
  return (
    <Text {...props} ref={ref} as="span" type="inherit">
      {children}
    </Text>
  );
});

/** Astryx body text with paragraph semantics and inherited legacy sizing. */
export const Paragraph = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function Paragraph({ children, color: _color, ...props }, ref) {
    return (
      <Text {...props} ref={ref} as="p" type="inherit" display="block">
        {children}
      </Text>
    );
  },
);

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  level: HeadingLevel;
};

/** Semantic Astryx heading that preserves product-specific layout classes. */
export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { level, children, color: _color, ...props },
  ref,
) {
  return (
    <AstryxHeading {...props} ref={ref} level={level}>
      {children}
    </AstryxHeading>
  );
});
