import { useCallback, useEffect, useRef, useState } from "react";

type FileTreeAction = { revision: number };

/** Keeps async file actions and their UI results with the workspace that started them. */
export function useFileTreeActionScope(projectPathKey: string, cwd: string, active: boolean) {
  const key = JSON.stringify([projectPathKey, cwd, active]);
  const context = useRef({
    key,
    revision: 0,
    active: true,
    owner: null as FileTreeAction | null,
  }).current;
  if (context.key !== key) {
    context.key = key;
    context.revision += 1;
    context.owner = null;
  }
  const revision = context.revision;
  const [renderedOwner, setRenderedOwner] = useState<FileTreeAction | null>(null);

  useEffect(() => {
    context.active = true;
    return () => {
      context.active = false;
    };
  }, [context]);

  const isActive = useCallback(
    () => context.active && active && context.revision === revision,
    [active, context, revision],
  );
  const begin = useCallback(() => {
    if (!isActive() || context.owner) return null;
    const owner = { revision };
    context.owner = owner;
    setRenderedOwner(owner);
    return owner;
  }, [context, isActive, revision]);
  const isCurrent = useCallback(
    (owner: FileTreeAction) =>
      context.active && context.owner === owner && context.revision === owner.revision,
    [context],
  );
  const finish = useCallback(
    (owner: FileTreeAction) => {
      if (!isCurrent(owner)) return;
      context.owner = null;
      setRenderedOwner(null);
    },
    [context, isCurrent],
  );
  return {
    busy: active && renderedOwner !== null && context.owner === renderedOwner,
    revision,
    isActive,
    begin,
    isCurrent,
    finish,
  };
}
