import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Dialog, DialogHeader, type DialogPurpose } from "@astryxdesign/core/Dialog";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Layout, LayoutContent, LayoutFooter, VStack } from "@astryxdesign/core/Layout";
import type { ReactNode } from "react";

const TOUCH_ORIENTED_LG_QUERY = "(max-width: 1024px) and (pointer: coarse) and (hover: none)";

export type AdaptiveDialogPresentation = "dialog" | "fullscreen" | "bottom-sheet";

export type AdaptiveDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  purpose?: DialogPurpose;
  width?: number | string;
  maxHeight?: number | string;
  touchPresentation?: AdaptiveDialogPresentation;
  presentation?: AdaptiveDialogPresentation;
  bottomSheetHeight?: "hug" | "capped" | "tall" | number | string;
};

/** Official Astryx adaptive dialog recipe, shared by desktop and touch surfaces. */
export function AdaptiveDialog({
  isOpen,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  purpose = "info",
  width = "min(30rem, calc(100dvw - var(--spacing-8)))",
  maxHeight = "80dvh",
  touchPresentation = "dialog",
  presentation,
  bottomSheetHeight = "capped",
}: AdaptiveDialogProps) {
  const isTouchOrientedLargeOrBelow = useMediaQuery(TOUCH_ORIENTED_LG_QUERY);
  const resolvedPresentation =
    presentation ?? (isTouchOrientedLargeOrBelow ? touchPresentation : "dialog");

  if (resolvedPresentation === "bottom-sheet") {
    return (
      <BottomSheet
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        label={title}
        purpose={purpose}
        height={bottomSheetHeight}
      >
        <VStack gap={4} padding={4}>
          <DialogHeader title={title} subtitle={subtitle} onOpenChange={onOpenChange} />
          {children}
          {footer}
        </VStack>
      </BottomSheet>
    );
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      purpose={purpose}
      width={width}
      maxHeight={maxHeight}
      variant={resolvedPresentation === "fullscreen" ? "fullscreen" : "standard"}
      padding={0}
    >
      <Layout
        header={<DialogHeader title={title} subtitle={subtitle} onOpenChange={onOpenChange} />}
        content={<LayoutContent padding={4}>{children}</LayoutContent>}
        footer={footer ? <LayoutFooter padding={4}>{footer}</LayoutFooter> : undefined}
      />
    </Dialog>
  );
}
