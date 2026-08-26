import { Button } from "@astryxdesign/core/Button";
import { Popover as AstryxPopover } from "@astryxdesign/core/Popover";
import {
  Children,
  type CSSProperties,
  cloneElement,
  type ElementType,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
} from "react";

type RootProps = {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
};

type TriggerProps = {
  children?: ReactNode;
  render?: ReactElement;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  "aria-label"?: string;
};

type PositionerProps = {
  children?: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  collisionPadding?: number;
  className?: string;
  style?: CSSProperties;
};

type PopupProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  initialFocus?: RefObject<HTMLElement | null>;
  "aria-label"?: string;
};

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

function Root({ children, open, onOpenChange }: RootProps) {
  const trigger = findElement(children, Trigger);
  const positioner = findElement(children, Positioner);
  const popup = findElement(children, Popup);
  const triggerProps = (trigger?.props ?? {}) as TriggerProps;
  const positionerProps = (positioner?.props ?? {}) as PositionerProps;
  const popupProps = (popup?.props ?? {}) as PopupProps;
  const side = positionerProps.side ?? "bottom";

  useEffect(() => {
    if (!open || !popupProps.initialFocus) return;
    const frame = requestAnimationFrame(() => popupProps.initialFocus?.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, popupProps.initialFocus]);

  const triggerNode = triggerProps.render ? (
    cloneElement(triggerProps.render as ReactElement<{ children?: ReactNode }>, {
      children:
        triggerProps.children ?? (triggerProps.render.props as { children?: ReactNode }).children,
    })
  ) : (
    <Button
      label={triggerProps["aria-label"] ?? "Open"}
      variant="ghost"
      isIconOnly
      icon={triggerProps.children}
      isDisabled={triggerProps.disabled}
      className={triggerProps.className}
      style={triggerProps.style}
    />
  );

  return (
    <AstryxPopover
      isOpen={open}
      onOpenChange={onOpenChange}
      placement={
        side === "top" ? "above" : side === "left" ? "start" : side === "right" ? "end" : "below"
      }
      alignment={positionerProps.align ?? "start"}
      width="min(20rem, calc(100dvw - var(--spacing-6)))"
      label={popupProps["aria-label"]}
      className={popupProps.className}
      style={popupProps.style}
      content={popupProps.children}
    >
      {triggerNode}
    </AstryxPopover>
  );
}

function Trigger(_props: TriggerProps): ReactElement | null {
  return null;
}

function Portal(props: { children?: ReactNode }): ReactElement {
  return <>{props.children}</>;
}

function Positioner(_props: PositionerProps): ReactElement | null {
  return null;
}

function Popup(_props: PopupProps): ReactElement | null {
  return null;
}

export const Popover = { Root, Trigger, Portal, Positioner, Popup };
