import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useLocale } from "../../i18n";
import { budgetLifetimeOptions } from "../../lib/subagents/schedulingBudget";
import type { SchedulingBudgetEditor } from "./useSchedulingBudgetEditor";

export function SchedulingBudgetContent({ editor }: { editor: SchedulingBudgetEditor }) {
  const { t } = useLocale();
  return (
    <VStack width="100%" gap={3}>
      {editor.draft ? (
        <>
          <Text type="label">{t("schedulingBudget.title")}</Text>
          <TextInput
            label={t("schedulingBudget.requests")}
            value={editor.draft.requests}
            onChange={(value) => editor.patch("requests", value)}
            width="100%"
            size="lg"
          />
          <TextInput
            label={t("schedulingBudget.tools")}
            value={editor.draft.tools}
            onChange={(value) => editor.patch("tools", value)}
            width="100%"
            size="lg"
          />
          <Selector
            label={t("schedulingBudget.lifetime")}
            value={editor.draft.minutes}
            onChange={(value) => editor.patch("minutes", value)}
            options={budgetLifetimeOptions(t, editor.draft.minutes)}
            width="100%"
            size="lg"
          />
          {editor.error ? (
            <div role="alert">
              <Text type="supporting">{t(editor.error)}</Text>
            </div>
          ) : null}
          <Button
            label={t("settings.save")}
            onClick={editor.save}
            isDisabled={!!editor.error}
            size="lg"
          />
          <Button
            label={t("settings.cancel")}
            onClick={editor.cancel}
            variant="secondary"
            size="lg"
          />
        </>
      ) : (
        <List density="balanced" hasDividers={false}>
          <ListItem
            label={t("schedulingBudget.title")}
            description={`${editor.config.maxModelRequests} / ${editor.config.maxToolCalls} · ${editor.config.lifetimeMinutes === 0 ? t("schedulingBudget.unlimited") : `${editor.config.lifetimeMinutes} ${t("schedulingBudget.minutes")}`}`}
            onClick={editor.open}
          />
        </List>
      )}
    </VStack>
  );
}
