import type { WorkspaceProject } from "../lib/settings";
import { workspaceProjectPathKey } from "../lib/settings";
import type { SidebarStore } from "../lib/sidebar/store";
import type { SidebarConversation, SidebarMutationKind } from "../lib/sidebar/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

/** Use the same authoritative store and running restrictions as ChatSidebarContainer. */
export async function mutateNativeConversation(
  store: SidebarStore,
  id: string,
  kind: SidebarMutationKind,
  run: () => Promise<boolean>,
  t: (key: string) => string,
) {
  const state = store.getSnapshot();
  const item = store.peek(id);
  if (!item || item.isPending || state.mutations.has(id))
    throw new Error(t(`chat.history.${kind}Failed`));
  if (kind !== "pin" && state.runningConversationIds.has(id))
    throw new Error(t(`chat.history.${kind}BlockedRunning`));
  store.clearMutationError(id);
  if (!(await run())) {
    const error = store.getSnapshot().mutationErrors.get(id) ?? `${kind}Failed`;
    throw new Error(t(`chat.history.${error}`));
  }
}

export function createNativeConversationActions(
  props: {
    item: SidebarConversation;
    store: SidebarStore;
    projects: WorkspaceProject[];
    currentId: string;
    onRename: (item: SidebarConversation) => void;
    onDelete: (id: string) => void;
    onMoved: (id: string, cwd: string) => void;
    onOpenInSplit?: (id: string) => void;
  },
  t: (key: string) => string,
) {
  const c = presentationControls();
  const { item, store } = props;
  const state = store.getSnapshot();
  const busy = state.mutations?.has(item.id) ?? false;
  const running = state.runningConversationIds?.has(item.id) ?? false;
  const enabled = !item.isPending && !busy;
  const prefix = `conversation-actions:${item.id}`;
  const children: PresentationNode[] = [
    {
      ...c.action(
        `${prefix}:pin`,
        t(item.isPinned ? "chat.conversationUnpin" : "chat.conversationPin"),
        () =>
          mutateNativeConversation(
            store,
            item.id,
            "pin",
            () => {
              const current = store.peek(item.id);
              return store.setPinned(item.id, !current?.isPinned);
            },
            t,
          ),
        enabled,
      ),
      icon: item.isPinned ? "pin.slash" : "pin",
    },
    {
      ...c.action(
        `${prefix}:rename`,
        t("chat.conversationRename"),
        () => {
          const current = store.peek(item.id);
          if (current) props.onRename(current);
        },
        enabled && !running,
      ),
      icon: "pencil",
    },
    ...(props.onOpenInSplit && item.id !== props.currentId
      ? [
          {
            ...c.action(
              `${prefix}:split`,
              t("chat.conversationOpenInSplit"),
              () => props.onOpenInSplit?.(item.id),
              enabled,
            ),
            icon: "rectangle.split.2x1",
          },
        ]
      : []),
  ];
  const targets = props.projects.filter(
    (project) => workspaceProjectPathKey(project.path) !== workspaceProjectPathKey(item.cwd ?? ""),
  );
  if (targets.length)
    children.push({
      id: `${prefix}:move`,
      kind: "Menu",
      label: t("chat.conversationMove"),
      icon: "folder",
      disabled: !enabled || running,
      children: targets.map((project) => ({
        ...c.action(
          `${prefix}:move:${project.id}`,
          project.name,
          async () => {
            await mutateNativeConversation(
              store,
              item.id,
              "move",
              () => store.setCwd(item.id, project.path),
              t,
            );
            props.onMoved(item.id, project.path);
          },
          enabled && !running,
        ),
        icon: "folder",
      })),
    });
  children.push(
    { id: `${prefix}:divider`, kind: "Divider" },
    {
      ...c.action(
        `${prefix}:delete`,
        t("chat.conversationDelete"),
        () => props.onDelete(item.id),
        enabled && !running,
      ),
      destructive: true,
      icon: "trash",
    },
  );
  return {
    menu: {
      id: prefix,
      kind: "Menu",
      label: `${t("chat.conversationMore")}: ${item.title}`,
      icon: "ellipsis",
      variant: "compact",
      children,
    } satisfies PresentationNode,
    handlers: c.handlers,
    running,
  };
}
