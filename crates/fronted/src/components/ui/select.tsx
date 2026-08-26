import { Selector } from "@astryxdesign/core/Selector";
import {
  Children,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

type SelectProps = {
  children?: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
};

type SelectTriggerProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  id?: string;
};

type SelectValueProps = {
  placeholder?: ReactNode;
  children?: ReactNode | ((value: unknown) => ReactNode);
  className?: string;
};

type SelectContentProps = {
  children?: ReactNode;
  className?: string;
  position?: "popper" | "item-aligned";
};

type SelectItemProps = {
  value: string;
  children?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
};

type ParsedSelect = {
  trigger?: SelectTriggerProps;
  valueDisplay?: SelectValueProps;
  options: Array<{
    value: string;
    label: string;
    description?: ReactNode;
    disabled?: boolean;
  }>;
};

function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(" ").trim();
  if (isValidElement<{ children?: ReactNode }>(node)) return getNodeText(node.props.children);
  return "";
}

function parseSelect(children: ReactNode): ParsedSelect {
  const parsed: ParsedSelect = { options: [] };

  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === SelectTrigger) {
        parsed.trigger = child.props as SelectTriggerProps;
      }
      if (child.type === SelectValue) {
        parsed.valueDisplay = child.props as SelectValueProps;
      }
      if (child.type === SelectItem) {
        const item = child.props as SelectItemProps;
        parsed.options.push({
          value: item.value,
          label: getNodeText(item.children) || item.value,
          description: item.description,
          disabled: item.disabled,
        });
      }
      const childProps = child.props as { children?: ReactNode };
      if (childProps.children != null) visit(childProps.children);
    });
  }

  visit(children);
  return parsed;
}

/**
 * Converts the former compound select tree into Astryx Selector's data model.
 * Trigger and option elements are metadata only; the only rendered control is
 * the native Astryx Selector.
 */
export function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  disabled,
  name,
}: SelectProps) {
  const parsed = parseSelect(children);
  const placeholder = getNodeText(parsed.valueDisplay?.placeholder);
  const label =
    parsed.trigger?.["aria-label"] ?? parsed.trigger?.title ?? placeholder ?? "Select an option";
  const valueDisplay = parsed.valueDisplay?.children;
  const className = parsed.trigger?.className;
  const isGhost = className?.includes("border-0") || className?.includes("bg-transparent");

  return (
    <Selector
      label={label}
      isLabelHidden
      options={parsed.options}
      value={value ?? defaultValue}
      onChange={onValueChange}
      isDisabled={disabled || parsed.trigger?.disabled}
      placeholder={placeholder || undefined}
      htmlName={name}
      variant={isGhost ? "ghost" : "input"}
      className={className}
      style={parsed.trigger?.style}
      renderValue={
        valueDisplay == null
          ? undefined
          : (option) =>
              typeof valueDisplay === "function" ? valueDisplay(option.value) : valueDisplay
      }
    />
  );
}

export function SelectTrigger(_props: SelectTriggerProps): ReactElement | null {
  return null;
}

export function SelectValue(_props: SelectValueProps): ReactElement | null {
  return null;
}

export function SelectContent(_props: SelectContentProps): ReactElement | null {
  return null;
}

export function SelectItem(_props: SelectItemProps): ReactElement | null {
  return null;
}
