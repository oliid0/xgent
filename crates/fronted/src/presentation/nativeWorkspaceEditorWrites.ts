import { invokeFs } from "../lib/tools/fsBackend";

export type NativeEditorDraft = {
  content: string | null;
  savedContent: string | null;
  mtimeMs: number;
  contentHash: string;
};
export type NativeEditorSource = NativeEditorDraft & {
  mode: "editor" | "preview";
  path: string;
  request: { workdir: string };
  sizeBytes: number;
  totalLines?: number;
};
export type NativeEditorWriteCache<
  File extends NativeEditorSource,
  Draft extends NativeEditorDraft,
> = {
  editors: Map<string, File>;
  drafts: Map<string, Draft>;
  pendingWrites: Map<string, Promise<void>>;
  publish?: () => void;
  writeFailures?: Map<string, unknown>;
};

/** Serializes real guarded source writes with both individual saves and bulk operations. */
export async function saveNativeWorkspaceEditorSource<
  File extends NativeEditorSource,
  Draft extends NativeEditorDraft,
>(
  cache: NativeEditorWriteCache<File, Draft>,
  key: string,
  dirty: (value: File | Draft | undefined) => boolean,
) {
  const pending = cache.pendingWrites.get(key);
  if (pending) {
    await pending;
    if (cache.writeFailures?.has(key)) throw cache.writeFailures.get(key);
    return !dirty(cache.drafts.get(key) ?? cache.editors.get(key));
  }
  const snapshot = cache.editors.get(key);
  if (snapshot?.mode !== "editor" || typeof snapshot.content !== "string") return false;
  if (!dirty(cache.drafts.get(key) ?? snapshot)) return true;
  let finish = () => {};
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  cache.pendingWrites.set(key, completion);
  cache.writeFailures?.delete(key);
  cache.publish?.();
  try {
    const response = await invokeFs<{
      mtimeMs: number;
      contentHash: string;
      bytesWritten: number;
      totalLines: number;
    }>("fs_write_text", {
      workdir: snapshot.request.workdir,
      path: snapshot.path,
      content: snapshot.content,
      mode: "rewrite",
      expected_mtime_ms: snapshot.mtimeMs,
      expected_content_hash: snapshot.contentHash,
    });
    const baseline = {
      savedContent: snapshot.content,
      mtimeMs: response.mtimeMs,
      contentHash: response.contentHash,
    };
    const latest = cache.editors.get(key);
    if (latest)
      cache.editors.set(
        key,
        Object.assign({}, latest, baseline, {
          sizeBytes: response.bytesWritten,
          totalLines: response.totalLines,
        }),
      );
    const draft = cache.drafts.get(key);
    if (draft) {
      const rebased = Object.assign({}, draft, baseline);
      if (dirty(rebased)) cache.drafts.set(key, rebased);
      else cache.drafts.delete(key);
    }
    return !dirty(cache.drafts.get(key) ?? cache.editors.get(key));
  } catch (error) {
    cache.writeFailures?.set(key, error);
    throw error;
  } finally {
    if (cache.pendingWrites.get(key) === completion) cache.pendingWrites.delete(key);
    finish();
    cache.publish?.();
  }
}
