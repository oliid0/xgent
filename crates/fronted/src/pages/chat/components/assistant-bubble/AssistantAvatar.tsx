import { Center } from "@astryxdesign/core/Center";
import iconSimpleUrl from "../../../../../src-tauri/icons/icon-simple.png";
import { cn } from "../../../../lib/shared/utils";

export function AssistantAvatar(props: { className?: string }) {
  const { className } = props;
  return (
    <Center
      isInline
      width="var(--xagent-assistant-avatar-size)"
      height="var(--xagent-assistant-avatar-size)"
      className={cn(
        "mt-0.5 shrink-0 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]/80",
        className,
      )}
    >
      <img
        src={iconSimpleUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="size-[var(--spacing-6)] select-none object-contain"
      />
    </Center>
  );
}
