import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Token } from "@astryxdesign/core/Token";
import { CheckCircle2, Circle } from "../../../../components/icons";
import { useLocale } from "../../../../i18n";
import type { TodoItem } from "../../../../lib/tools/builtinTypes";

/**
 * Defensive shape filter for rendering todos straight from streaming tool-call
 * arguments: partially parsed items (missing fields, wrong types) are dropped
 * instead of crashing the checklist.
 */
export function sanitizeTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TodoItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.content === "string" &&
      (candidate.status === "pending" ||
        candidate.status === "in_progress" ||
        candidate.status === "completed") &&
      typeof candidate.activeForm === "string"
    );
  });
}

function TodoRow(props: { todo: TodoItem }) {
  const { todo } = props;
  const { t } = useLocale();
  const label = todo.status === "in_progress" ? todo.activeForm : todo.content;
  const statusLabel =
    todo.status === "completed"
      ? t("chat.tool.todoCompleted")
      : todo.status === "in_progress"
        ? t("chat.tool.todoInProgress")
        : t("chat.tool.todoPending");

  return (
    <ListItem
      label={label}
      startContent={
        todo.status === "completed" ? (
          <CheckCircle2 />
        ) : todo.status === "in_progress" ? (
          <Spinner size="sm" label={statusLabel} />
        ) : (
          <Circle />
        )
      }
      endContent={
        <Token
          label={statusLabel}
          size="sm"
          color={
            todo.status === "completed"
              ? "green"
              : todo.status === "in_progress"
                ? "purple"
                : "gray"
          }
        />
      }
    />
  );
}

export function TodoListView(props: { todos: TodoItem[] }) {
  const { todos } = props;
  const { t } = useLocale();

  if (!Array.isArray(todos) || todos.length === 0) {
    return <EmptyState isCompact title={t("chat.tool.todoEmpty")} />;
  }

  return (
    <List density="compact" hasDividers={false}>
      {todos.map((todo, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: todos are a full-replace snapshot with no stable id
        <TodoRow key={index} todo={todo} />
      ))}
    </List>
  );
}
