import {
  DropdownMenu as AstryxDropdownMenu,
  DropdownMenuCheckboxItem as AstryxDropdownMenuCheckboxItem,
  DropdownMenuDivider as AstryxDropdownMenuDivider,
  DropdownMenuItem as AstryxDropdownMenuItem,
  DropdownMenuSubMenu as AstryxDropdownMenuSubMenu,
  type DropdownMenuButtonProps,
} from "@astryxdesign/core/DropdownMenu";
import { Text } from "@astryxdesign/core/Text";
import {
  Children,
  isValidElement,
  type CSSProperties,
  type ElementType,
  type ReactElement,
  type ReactNode,
  type MouseEventHandler,
} from "react";

type LegacyRootProps = {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
};

type LegacyTriggerProps = {
  children?: ReactNode;
  render?: ReactElement;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  type?: "button" | "submit" | "reset";
};

type LegacyContentProps = {
  children?: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  collisionPadding?: number;
};

type LegacyItemProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  onSelect?: () => void;
  onClick?: () => void;
  onContextMenu?: MouseEventHandler<HTMLElement>;
  title?: string;
  "aria-label"?: string;
  closeOnClick?: boolean;
};

type LegacyCheckboxItemProps = LegacyItemProps & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

type LegacySubProps = {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
};

type LegacySubTriggerProps = LegacyItemProps & {
  clickToggle?: boolean;
};

function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(" ").trim();
  if (isValidElement<{ children?: ReactNode }>(node)) return getNodeText(node.props.children);
  return "";
}

function findElement(node: ReactNode, type: ElementType): ReactElement | undefined {
  let match: ReactElement | undefined;
  Children.forEach(node, (child) => {
    if (match || !isValidElement(child)) return;
    if (child.type === type) {
      match = child;
      return;
    }
    match = findElement((child.props as { children?: ReactNode }).children, type);
  });
  return match;
}

const BUTTON_VARIANTS: Record<string, DropdownMenuButtonProps["variant"]> = {
  default: "primary",
  secondary: "secondary",
  destructive: "destructive",
  outline: "secondary",
  ghost: "ghost",
  link: "ghost",
};

function parseButton(trigger?: ReactElement): {
  button: DropdownMenuButtonProps;
  onClick?: () => void;
  hasChevron: boolean;
} {
  const triggerProps = (trigger?.props ?? {}) as LegacyTriggerProps;
  const renderedProps = (triggerProps.render?.props ?? {}) as Record<string, unknown>;
  const content = triggerProps.children ?? (renderedProps.children as ReactNode);
  const title = (renderedProps.title as string | undefined) ?? triggerProps.title;
  const ariaLabel =
    (renderedProps["aria-label"] as string | undefined) ?? triggerProps["aria-label"];
  const text = getNodeText(content);
  const label = (ariaLabel ?? title ?? text) || "Menu";
  const legacySize = renderedProps.size as string | undefined;
  const isIconOnly = legacySize === "icon" || text.length === 0;
  const legacyVariant = (renderedProps.variant as string | undefined) ?? "ghost";
  const size = legacySize === "sm" || legacySize === "lg" ? legacySize : "md";

  return {
    button: {
      label,
      tooltip: title,
      variant: BUTTON_VARIANTS[legacyVariant] ?? "ghost",
      size,
      isDisabled: Boolean(renderedProps.disabled) || Boolean(triggerProps.disabled),
      isIconOnly,
      icon: isIconOnly ? content : undefined,
      children: isIconOnly ? undefined : content,
      className: (renderedProps.className as string | undefined) ?? triggerProps.className,
      style: (renderedProps.style as CSSProperties | undefined) ?? triggerProps.style,
    },
    onClick: renderedProps.onClick as (() => void) | undefined,
    hasChevron: !isIconOnly,
  };
}

function parseMenuWidth(className?: string): number | string | undefined {
  if (!className) return undefined;
  const widths: Array<[string, number]> = [
    ["min-w-96", 384],
    ["min-w-80", 320],
    ["min-w-72", 288],
    ["min-w-64", 256],
    ["min-w-52", 208],
    ["min-w-48", 192],
    ["min-w-44", 176],
    ["min-w-40", 160],
  ];
  return widths.find(([name]) => className.includes(name))?.[1];
}

function convertSubMenu(element: ReactElement, key: string | number): ReactNode {
  const props = element.props as LegacySubProps;
  const trigger = findElement(props.children, DropdownMenuSubTrigger);
  const content = findElement(props.children, DropdownMenuSubContent);
  const triggerProps = (trigger?.props ?? {}) as LegacySubTriggerProps;
  const contentProps = (content?.props ?? {}) as LegacyContentProps;
  const label = getNodeText(triggerProps.children) || "More";

  return (
    <AstryxDropdownMenuSubMenu
      key={key}
      label={label}
      isDisabled={triggerProps.disabled}
      menuWidth={parseMenuWidth(contentProps.className)}
      onOpenChange={props.onOpenChange}
      className={triggerProps.className}
      style={triggerProps.style}
    >
      {convertMenuNodes(contentProps.children)}
    </AstryxDropdownMenuSubMenu>
  );
}

function convertMenuNodes(node: ReactNode): ReactNode[] {
  const result: ReactNode[] = [];
  Children.forEach(node, (child, index) => {
    if (!isValidElement(child)) return;
    const key = child.key ?? index;
    if (child.type === DropdownMenuItem) {
      const props = child.props as LegacyItemProps;
      result.push(
        <AstryxDropdownMenuItem
          key={key}
          label={props.children}
          onClick={() => {
            props.onSelect?.();
            props.onClick?.();
          }}
          isDisabled={props.disabled}
          variant={props.className?.includes("destructive") ? "destructive" : "default"}
          className={props.className}
          style={props.style}
        />,
      );
      return;
    }
    if (child.type === DropdownMenuCheckboxItem) {
      const props = child.props as LegacyCheckboxItemProps;
      result.push(
        <AstryxDropdownMenuCheckboxItem
          key={key}
          label={props.children}
          value={Boolean(props.checked)}
          onChange={props.onCheckedChange}
          isDisabled={props.disabled}
          className={props.className}
          style={props.style}
        />,
      );
      return;
    }
    if (child.type === DropdownMenuSeparator) {
      result.push(<AstryxDropdownMenuDivider key={key} />);
      return;
    }
    if (child.type === DropdownMenuLabel) {
      const props = child.props as LegacyItemProps;
      result.push(
        <Text
          key={key}
          as="div"
          type="supporting"
          color="secondary"
          weight="semibold"
          className={props.className}
          style={props.style}
        >
          {props.children}
        </Text>,
      );
      return;
    }
    if (child.type === DropdownMenuSub) {
      result.push(convertSubMenu(child, key));
      return;
    }
    if (child.type === DropdownMenuTrigger || child.type === DropdownMenuContent) {
      result.push(...convertMenuNodes((child.props as { children?: ReactNode }).children));
      return;
    }
    result.push(...convertMenuNodes((child.props as { children?: ReactNode }).children));
  });
  return result;
}

/** Converts the former compound tree into native Astryx menu primitives. */
export function DropdownMenu({ children, open, onOpenChange }: LegacyRootProps) {
  const trigger = findElement(children, DropdownMenuTrigger);
  const content = findElement(children, DropdownMenuContent);
  const contentProps = (content?.props ?? {}) as LegacyContentProps;
  const parsedButton = parseButton(trigger);
  const side = contentProps.side ?? "bottom";

  return (
    <AstryxDropdownMenu
      button={parsedButton.button}
      isMenuOpen={open}
      onOpenChange={onOpenChange}
      onClick={parsedButton.onClick}
      hasChevron={parsedButton.hasChevron}
      menuWidth={parseMenuWidth(contentProps.className)}
      placement={
        side === "top" ? "above" : side === "left" ? "start" : side === "right" ? "end" : "below"
      }
      alignment={contentProps.align ?? "start"}
    >
      {convertMenuNodes(contentProps.children)}
    </AstryxDropdownMenu>
  );
}

export function DropdownMenuTrigger(_props: LegacyTriggerProps): ReactElement | null {
  return null;
}

export function DropdownMenuContent(_props: LegacyContentProps): ReactElement | null {
  return null;
}

export function DropdownMenuItem(_props: LegacyItemProps): ReactElement | null {
  return null;
}

export function DropdownMenuCheckboxItem(_props: LegacyCheckboxItemProps): ReactElement | null {
  return null;
}

export function DropdownMenuLabel(_props: LegacyItemProps): ReactElement | null {
  return null;
}

export function DropdownMenuSeparator(_props: LegacyItemProps): ReactElement | null {
  return null;
}

export function DropdownMenuSub(_props: LegacySubProps): ReactElement | null {
  return null;
}

export function DropdownMenuSubTrigger(_props: LegacySubTriggerProps): ReactElement | null {
  return null;
}

export function DropdownMenuSubContent(_props: LegacyContentProps): ReactElement | null {
  return null;
}
