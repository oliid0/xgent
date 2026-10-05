import type { useSoul } from "../lib/soul";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function createNativeSidebarSoulMenu(
  props: {
    mobile: boolean;
    readSoul: () => ReturnType<typeof useSoul>;
    request: { busy: boolean; mounted: boolean };
    onCreate?: () => void;
    tools?: { id: string; label: string; icon: string; run: () => void; enabled?: boolean }[];
  },
  t: (key: string) => string,
) {
  const soul = props.readSoul();
  const c = presentationControls();
  const enabled = !soul.loading && !soul.saving && !props.request.busy;
  const select = async (id: string) => {
    const current = props.readSoul();
    if (
      !props.request.mounted ||
      props.request.busy ||
      current.loading ||
      current.saving ||
      !current.presets.some((preset) => preset.id === id)
    )
      throw new Error(t("settings.saveError"));
    props.request.busy = true;
    try {
      await current.select(id);
    } finally {
      props.request.busy = false;
    }
  };
  const node: PresentationNode = {
    id: "sidebar-soul-menu",
    kind: "Menu",
    variant: "ghost",
    icon: "sparkles",
    label: props.mobile
      ? t("sidebar.soulPresets")
      : soul.presets.find((preset) => preset.id === soul.activeId)?.metadata.name || "XGent",
    children: [
      c.group(
        "sidebar-soul-presets",
        t("sidebar.soulPresets"),
        soul.presets.map((preset) => ({
          ...c.action(
            `sidebar-soul:${preset.id}`,
            preset.metadata.name || "XGent",
            () => select(preset.id),
            enabled,
          ),
          icon: "sparkles",
          selected: preset.id === soul.activeId,
        })),
      ),
      {
        ...c.action(
          "sidebar-soul-create",
          t("sidebar.addSoul"),
          () => props.onCreate?.(),
          enabled && !!props.onCreate,
        ),
        icon: "plus",
      },
      ...(!props.mobile && props.tools?.length
        ? [
            { id: "sidebar-soul-tools-divider", kind: "Divider" as const },
            ...props.tools.map((tool) => ({
              ...c.action(tool.id, tool.label, tool.run, tool.enabled !== false),
              icon: tool.icon,
            })),
          ]
        : []),
    ],
  };
  return { node, handlers: c.handlers };
}
