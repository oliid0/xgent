import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useLocale } from "../../i18n";
import { SchedulingBudgetContent } from "./SchedulingBudgetSettings";
import { useSchedulingBudgetEditor } from "./useSchedulingBudgetEditor";
import { type SubagentTeamEditor, useSubagentTeamEditor } from "./useSubagentTeamEditor";

export function SubagentTeamContent({ editor }: { editor: SubagentTeamEditor }) {
  const { t } = useLocale();
  const draft = editor.draft?.template;
  return (
    <VStack width="100%" gap={3} className="subagent-team-settings">
      <Text type="label">{t("subagentTeam.title")}</Text>
      {draft ? (
        <>
          <TextInput
            label={t("subagentTeam.name")}
            value={draft.name}
            onChange={(name) => editor.patch({ name })}
            width="100%"
          />
          <TextInput
            label={t("subagentTeam.description")}
            value={draft.description}
            onChange={(description) => editor.patch({ description })}
            width="100%"
          />
          <TextArea
            label={t("subagentTeam.prompt")}
            value={draft.prompt}
            onChange={(prompt) => editor.patch({ prompt })}
            width="100%"
            rows={5}
          />
          <Selector
            label={t("subagentTeam.model")}
            value={draft.modelValue ?? ""}
            options={[{ value: "", label: t("subagentTeam.auto") }, ...editor.options]}
            onChange={(modelValue) => editor.patch({ modelValue })}
            width="100%"
          />
          {draft.modelValue ? <Text type="supporting">{draft.modelValue}</Text> : null}
          <TextInput
            label={t("subagentTeam.skills")}
            value={editor.draft!.skills}
            onChange={(skills) => editor.patch({ skills })}
            width="100%"
          />
          <Switch
            label={t("subagentTeam.enabled")}
            value={draft.enabled}
            onChange={(enabled) => editor.patch({ enabled })}
          />
          {editor.error ? (
            <div role="alert">
              <Text type="supporting">{t(editor.error)}</Text>
            </div>
          ) : null}
          <Button
            label={t("settings.save")}
            variant="primary"
            isDisabled={!!editor.error}
            onClick={editor.save}
          >
            {t("settings.save")}
          </Button>
          <Button label={t("settings.cancel")} variant="secondary" onClick={editor.cancel}>
            {t("settings.cancel")}
          </Button>
          {editor.draft!.original ? (
            <Button label={t("settings.delete")} variant="secondary" onClick={editor.remove}>
              {t("settings.delete")}
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {!editor.team.length ? <Text type="supporting">{t("subagentTeam.empty")}</Text> : null}
          {editor.team.map((template) => (
            <VStack key={template.id} width="100%" gap={2}>
              <Text type="label">
                {template.name} ·{" "}
                {t(template.enabled ? "subagentTeam.enabled" : "subagentTeam.disabled")}
              </Text>
              {template.description ? <Text type="supporting">{template.description}</Text> : null}
              <Text type="supporting">
                {editor.options.find((o) => o.value === template.modelValue)?.label ??
                  template.modelValue ??
                  t("subagentTeam.auto")}
              </Text>
              <Button
                label={t("settings.edit")}
                variant="secondary"
                onClick={() => editor.open(template)}
              >
                {t("settings.edit")}
              </Button>
            </VStack>
          ))}
          <Button label={t("subagentTeam.add")} variant="secondary" onClick={() => editor.open()}>
            {t("subagentTeam.add")}
          </Button>
        </>
      )}
    </VStack>
  );
}

export function SubagentTeamSettings(props: Parameters<typeof useSubagentTeamEditor>[0]) {
  const team = useSubagentTeamEditor(props),
    budget = useSchedulingBudgetEditor(props);
  return (
    <VStack width="100%" gap={3}>
      <SubagentTeamContent editor={team} />
      <SchedulingBudgetContent editor={budget} />
    </VStack>
  );
}
