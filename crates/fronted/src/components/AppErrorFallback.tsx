import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import { isNativeMobileRuntime } from "../lib/runtimePlatform";
import { writeClipboardText } from "../lib/system/clipboardText";
import { presentationControls } from "../presentation/controls";
import { NativeSurface } from "../presentation/NativeSurface";
import type { PresentationDocument, PresentationNode } from "../presentation/types";
import { isApplePresentationRuntime } from "../runtime/applePresentation";

export type AppErrorRecoveryOptions = {
  mode?: "root" | "sheet";
  appearance?: PresentationDocument["appearance"];
  nativeMobile?: boolean;
  onClose?: () => void;
};

export function AppErrorFallback(
  props: AppErrorRecoveryOptions & { error: Error; componentStack: string },
) {
  const { t } = useLocale();
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const alive = useRef(true),
    copyLock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const title = t("app.errorBoundaryTitle"),
    description = t("app.errorBoundaryDesc");
  const diagnostics = `${props.error.stack ?? props.error.message}\n${props.componentStack}`;
  const reload = () => {
    if (alive.current) window.location.reload();
  };
  const close = () => {
    if (alive.current) {
      alive.current = false;
      props.onClose?.();
    }
  };
  const copy = async () => {
    if (!alive.current || copyLock.current) return;
    copyLock.current = true;
    setCopyState("copying");
    try {
      const copied = await writeClipboardText(diagnostics);
      if (alive.current) setCopyState(copied ? "copied" : "failed");
    } catch {
      if (alive.current) setCopyState("failed");
    } finally {
      copyLock.current = false;
    }
  };
  const feedback =
    copyState === "copied"
      ? t("app.errorBoundaryCopied")
      : copyState === "failed"
        ? t("app.errorBoundaryCopyFailed")
        : "";
  const toggleDetails = () => {
    if (alive.current) setDetailsOpen((previous) => !previous);
  };
  const detailsLabel = t(detailsOpen ? "app.errorBoundaryHideDetails" : "app.errorBoundaryDetails");

  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    const buttons: PresentationNode[] = [
      { ...c.action("error:reload", t("app.errorBoundaryReload"), reload), prominent: true },
      c.action("error:copy", t("app.errorBoundaryCopy"), copy, copyState !== "copying"),
      c.action("error:details", detailsLabel, toggleDetails),
      ...(props.onClose ? [c.action("error:close", t("settings.close"), close)] : []),
    ];
    return (
      <NativeSurface
        document={{
          mode: props.mode ?? "root",
          title,
          appearance: props.appearance ?? "system",
          formFactor: (props.nativeMobile ?? isNativeMobileRuntime()) ? "mobile" : "desktop",
          dismissAction: props.onClose ? "error:close" : undefined,
          nodes: [
            {
              id: "error:screen",
              kind: "Banner",
              variant: "error-screen",
              label: title,
              text: description,
              status: "error",
              icon: "exclamationmark.triangle",
              children: [
                ...buttons,
                ...(feedback
                  ? [
                      {
                        id: "error:copy-feedback",
                        kind: "Text" as const,
                        text: feedback,
                        wrap: true,
                      },
                    ]
                  : []),
                {
                  id: "error:message",
                  kind: "Text",
                  text: props.error.message.slice(0, 8000),
                  wrap: true,
                },
                ...(detailsOpen
                  ? [
                      {
                        id: "error:diagnostics",
                        kind: "CodeBlock" as const,
                        label: t("app.errorBoundaryDetails"),
                        text: diagnostics.slice(0, 64000),
                        language: "text",
                        maxHeight: 240,
                      },
                    ]
                  : []),
              ],
            },
          ],
        }}
        handlers={c.handlers}
        onError={(error) => console.error("Native error recovery could not be displayed", error)}
      />
    );
  }

  return (
    <Center width="100%" height="100%" padding={8} className="overflow-auto">
      <VStack gap={4} width="100%" maxWidth="var(--xgent-content-width-md)">
        <Banner status="error" title={title} description={description}>
          <VStack gap={3} width="100%">
            <Button variant="primary" label={t("app.errorBoundaryReload")} onClick={reload} />
            <Button
              variant="ghost"
              label={t("app.errorBoundaryCopy")}
              isDisabled={copyState === "copying"}
              onClick={() => {
                void copy();
              }}
            />
            <Button variant="ghost" label={detailsLabel} onClick={toggleDetails} />
            {props.onClose ? (
              <Button variant="ghost" label={t("settings.close")} onClick={close} />
            ) : null}
            {feedback ? (
              <Text as="div" type="supporting" role="status">
                {feedback}
              </Text>
            ) : null}
            <Text
              as="div"
              type="supporting"
              color="secondary"
              className="break-words whitespace-pre-wrap"
            >
              {props.error.message.slice(0, 8000)}
            </Text>
            {detailsOpen ? (
              <Text
                as="div"
                type="supporting"
                color="secondary"
                className="max-h-60 overflow-auto whitespace-pre-wrap font-mono"
              >
                {diagnostics.slice(0, 64000)}
              </Text>
            ) : null}
          </VStack>
        </Banner>
      </VStack>
    </Center>
  );
}
