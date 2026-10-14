import type { SubagentTeamEditor } from "../pages/settings/useSubagentTeamEditor";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function subagentTeamNodes(editor: SubagentTeamEditor, t: (key: string) => string) {
  const c = presentationControls(editor.scope);
  const children: PresentationNode[] = [];
  const draft = editor.draft?.template;
  if (draft) {
    children.push(
      c.input("team-name", t("subagentTeam.name"), draft.name, (name) => editor.patch({ name })),
      c.input("team-description", t("subagentTeam.description"), draft.description, (description) =>
        editor.patch({ description }),
      ),
      {
        ...c.input("team-prompt", t("subagentTeam.prompt"), draft.prompt, (prompt) =>
          editor.patch({ prompt }),
        ),
        kind: "TextArea",
      },
      c.select(
        "team-model",
        t("subagentTeam.model"),
        draft.modelValue ?? "",
        [{ value: "", label: t("subagentTeam.auto") }, ...editor.options],
        (modelValue) => editor.patch({ modelValue }),
      ),
      c.input("team-skills", t("subagentTeam.skills"), editor.draft!.skills, (skills) =>
        editor.patch({ skills }),
      ),
      c.toggle("team-enabled", t("subagentTeam.enabled"), draft.enabled, (enabled) =>
        editor.patch({ enabled }),
      ),
    );
    if (draft.modelValue)
      children.push({ id: "team-selected-model", kind: "Text", text: draft.modelValue });
    if (editor.error)
      children.push({ id: "team-error", kind: "Banner", label: t(editor.error), status: "error" });
    children.push(
      c.action("team-save", t("settings.save"), editor.save, !editor.error),
      c.action("team-cancel", t("settings.cancel"), editor.cancel),
    );
    if (editor.draft!.original)
      children.push({
        ...c.action("team-delete", t("settings.delete"), editor.remove),
        destructive: true,
      });
  } else {
    if (!editor.team.length)
      children.push({ id: "team-empty", kind: "Text", text: t("subagentTeam.empty") });
    for (const template of editor.team)
      children.push(
        c.group(`team-${template.id}`, template.name, [
          {
            id: `team-detail-${template.id}`,
            kind: "Text",
            text: [
              template.description,
              t(template.enabled ? "subagentTeam.enabled" : "subagentTeam.disabled"),
              template.modelValue ?? t("subagentTeam.auto"),
            ]
              .filter(Boolean)
              .join(" · "),
          },
          c.action(`team-edit-${template.id}`, t("settings.edit"), () => editor.open(template)),
        ]),
      );
    children.push(c.action("team-add", t("subagentTeam.add"), () => editor.open()));
  }
  return {
    nodes: [c.group("subagent-team", t("subagentTeam.title"), children)],
    handlers: c.handlers,
  };
}
