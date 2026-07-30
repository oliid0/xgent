import { invoke } from "@xagent/runtime";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_SOUL_METADATA,
  parseSoulDocument,
  type SoulDocument,
  type SoulDraft,
  serializeSoulDocument,
  validateSoulDraft,
} from "./model";

type SoulDocumentResponse = {
  id: string;
  content: string;
  path: string;
};

type SoulLibraryResponse = {
  activeId: string;
  presets: SoulDocumentResponse[];
};

type SoulContextValue = {
  document: SoulDocument | null;
  presets: SoulDocument[];
  activeId: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  reload: () => Promise<SoulDocument>;
  save: (draft: SoulDraft) => Promise<SoulDocument>;
  create: (draft: SoulDraft) => Promise<SoulDocument>;
  select: (presetId: string) => Promise<SoulDocument>;
  remove: (presetId: string) => Promise<SoulDocument>;
};

const SoulContext = createContext<SoulContextValue | null>(null);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown SOUL.md error");
}

function parseLibrary(response: SoulLibraryResponse) {
  const presets = response.presets.map((preset) =>
    parseSoulDocument(preset.content, preset.path, preset.id),
  );
  const document = presets.find((preset) => preset.id === response.activeId) ?? presets[0] ?? null;
  return {
    presets,
    document,
    activeId: document?.id ?? response.activeId,
  };
}

export function SoulProvider(props: { children: ReactNode }) {
  const [document, setDocument] = useState<SoulDocument | null>(null);
  const [presets, setPresets] = useState<SoulDocument[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyLibrary = useCallback((response: SoulLibraryResponse) => {
    const next = parseLibrary(response);
    if (mountedRef.current) {
      setPresets(next.presets);
      setDocument(next.document);
      setActiveId(next.activeId);
      setError(null);
    }
    if (!next.document) throw new Error("Soul library contains no presets");
    return next.document;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await invoke<SoulLibraryResponse>("system_list_souls");
      return applyLibrary(response);
    } catch (cause) {
      const message = errorMessage(cause);
      if (mountedRef.current) setError(message);
      throw cause;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyLibrary]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  const runMutation = useCallback(
    async <T,>(operation: () => Promise<T>, apply: (response: T) => SoulDocument) => {
      setSaving(true);
      try {
        const response = await operation();
        return apply(response);
      } catch (cause) {
        const message = errorMessage(cause);
        if (mountedRef.current) setError(message);
        throw cause;
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    },
    [],
  );

  const save = useCallback(
    async (draft: SoulDraft) => {
      const validation = validateSoulDraft(draft);
      if (!validation.valid) throw new Error(validation.message);
      const content = serializeSoulDocument(draft);
      return runMutation(
        () =>
          invoke<SoulDocumentResponse>("system_save_soul", {
            content,
            preset_id: activeId || undefined,
          }),
        (response) => {
          const next = parseSoulDocument(response.content, response.path, response.id);
          if (mountedRef.current) {
            setDocument(next);
            setActiveId(next.id);
            setPresets((current) => {
              const found = current.some((preset) => preset.id === next.id);
              return found
                ? current.map((preset) => (preset.id === next.id ? next : preset))
                : [...current, next];
            });
            setError(null);
          }
          return next;
        },
      );
    },
    [activeId, runMutation],
  );

  const create = useCallback(
    async (draft: SoulDraft) => {
      const validation = validateSoulDraft(draft);
      if (!validation.valid) throw new Error(validation.message);
      const content = serializeSoulDocument(draft);
      return runMutation(
        () => invoke<SoulLibraryResponse>("system_create_soul", { content }),
        applyLibrary,
      );
    },
    [applyLibrary, runMutation],
  );

  const select = useCallback(
    async (presetId: string) =>
      runMutation(
        () =>
          invoke<SoulDocumentResponse>("system_select_soul", {
            presetId,
          }),
        (response) => {
          const next = parseSoulDocument(response.content, response.path, response.id);
          if (mountedRef.current) {
            setDocument(next);
            setActiveId(next.id);
            setError(null);
          }
          return next;
        },
      ),
    [runMutation],
  );

  const remove = useCallback(
    async (presetId: string) =>
      runMutation(
        () =>
          invoke<SoulLibraryResponse>("system_delete_soul", {
            presetId,
          }),
        applyLibrary,
      ),
    [applyLibrary, runMutation],
  );

  const value = useMemo<SoulContextValue>(
    () => ({
      document,
      presets,
      activeId,
      loading,
      saving,
      error,
      reload,
      save,
      create,
      select,
      remove,
    }),
    [activeId, create, document, error, loading, presets, reload, remove, save, saving, select],
  );
  return <SoulContext.Provider value={value}>{props.children}</SoulContext.Provider>;
}

export function useSoul() {
  const value = useContext(SoulContext);
  if (value) return value;
  const fallback: SoulDocument = {
    id: "",
    metadata: DEFAULT_SOUL_METADATA,
    body: "",
    content: "",
    path: "",
  };
  return {
    document: fallback,
    presets: [fallback],
    activeId: "",
    loading: false,
    saving: false,
    error: null,
    reload: async () => {
      throw new Error("SoulProvider is unavailable");
    },
    save: async () => {
      throw new Error("SoulProvider is unavailable");
    },
    create: async () => {
      throw new Error("SoulProvider is unavailable");
    },
    select: async () => {
      throw new Error("SoulProvider is unavailable");
    },
    remove: async () => {
      throw new Error("SoulProvider is unavailable");
    },
  } satisfies SoulContextValue;
}
