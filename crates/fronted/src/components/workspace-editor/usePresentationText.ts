import { useEffect, useState } from "react";
import { type PresentationTextEntry, readPresentationText } from "./workspacePresentationText";

export function usePresentationText(bytes: Uint8Array | null) {
  const [state, setState] = useState<{
    bytes: Uint8Array | null;
    entries: PresentationTextEntry[];
    loading: boolean;
    error: string | null;
  }>({ bytes: null, entries: [], loading: false, error: null });
  useEffect(() => {
    let current = true;
    if (!bytes) {
      setState({ bytes: null, entries: [], loading: false, error: null });
      return;
    }
    setState({ bytes, entries: [], loading: true, error: null });
    void readPresentationText(bytes).then(
      (entries) => {
        if (current) setState({ bytes, entries, loading: false, error: null });
      },
      (error) => {
        if (current)
          setState({
            bytes,
            entries: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      current = false;
    };
  }, [bytes]);
  return state.bytes === bytes ? state : { bytes, entries: [], loading: !!bytes, error: null };
}
