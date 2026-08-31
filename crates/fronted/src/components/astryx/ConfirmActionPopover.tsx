import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Item } from "@astryxdesign/core/Item";
import { Popover } from "@astryxdesign/core/Popover";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { type ReactNode, useState } from "react";
import { useLocale } from "../../i18n";
import { AlertTriangle } from "../icons";

export function ConfirmActionPopover(props: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  align?: "start" | "end";
  side?: "top" | "bottom";
  tone?: "destructive" | "default";
  children: (open: () => void) => ReactNode;
}) {
  const {
    title,
    description,
    confirmLabel,
    onConfirm,
    align = "end",
    side = "bottom",
    tone = "destructive",
    children,
  } = props;
  const { t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      placement={side === "top" ? "above" : "below"}
      alignment={align}
      width="min(var(--xgent-confirm-popover-width), calc(100dvw - (var(--spacing-3) * 2)))"
      label={title}
      content={
        <VStack gap={3}>
          <Item
            label={title}
            description={
              <Text type="supporting" color="secondary" as="div">
                {description}
              </Text>
            }
            startContent={
              <Icon
                icon={AlertTriangle}
                size="md"
                color={tone === "destructive" ? "error" : "warning"}
              />
            }
          />
          <HStack gap={2} hAlign="end">
            <Button
              label={t("settings.cancel")}
              variant="secondary"
              size="sm"
              onClick={() => setIsOpen(false)}
            />
            <Button
              label={confirmLabel}
              variant={tone === "destructive" ? "destructive" : "primary"}
              size="sm"
              onClick={() => {
                onConfirm();
                setIsOpen(false);
              }}
            />
          </HStack>
        </VStack>
      }
    >
      {children(() => setIsOpen(true))}
    </Popover>
  );
}

export function ConfirmDeletePopover(props: {
  name: string;
  onConfirm: () => void;
  children: (open: () => void) => ReactNode;
}) {
  const { t } = useLocale();

  return (
    <ConfirmActionPopover
      title={t("settings.deleteConfirm")}
      description={
        <>
          {t("settings.deleteConfirmYes")} {props.name} {t("settings.deleteConfirmDesc")}
        </>
      }
      confirmLabel={t("settings.delete")}
      onConfirm={props.onConfirm}
    >
      {props.children}
    </ConfirmActionPopover>
  );
}
