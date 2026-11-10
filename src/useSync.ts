import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { syncNotes, type SyncResult } from "./sync/engine";
import { GitHubError, createGitHub, type RepoConfig } from "./sync/github";
import { markDeleted, saveEdit, type NoteRecord, type NoteStore } from "./sync/store";

// Long enough that pauses while writing don't each become a commit.
const PUSH_AFTER_EDIT_MS = 10_000;
const PULL_EVERY_MS = 60_000;

export interface SyncStatus {
  running: boolean;
  progress: { done: number; total: number } | null;
  error: GitHubError | null;
}

export function useSync(config: RepoConfig, store: NoteStore) {
  // Includes notes deleted here but not yet on GitHub, which the app never shows.
  const [stored, setNotes] = useState<NoteRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SyncStatus>({
    running: false,
    progress: null,
    error: null,
  });
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const pushTimer = useRef<number>();

  const run = useCallback(async () => {
    window.clearTimeout(pushTimer.current);
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setStatus((s) => ({ ...s, running: true, progress: null }));
    do {
      again.current = false;
      try {
        const result = await syncNotes(createGitHub(config), store, (done, total) => {
          setStatus((s) => ({ ...s, progress: { done, total } }));
        });
        if (result.conflicts.length > 0 || result.keptDeletes.length > 0) setLastResult(result);
        setStatus((s) => ({ ...s, error: null }));
      } catch (error) {
        const failure =
          error instanceof GitHubError ? error : new GitHubError("other", "Sync failed.");
        setStatus((s) => ({ ...s, error: failure }));
      }
      try {
        setNotes(await store.all());
      } catch {
        // The next run tries again. Throwing here would leave sync stuck as running.
      }
    } while (again.current);
    running.current = false;
    setStatus((s) => ({ ...s, running: false, progress: null }));
  }, [config, store]);

  useEffect(() => {
    let live = true;
    // If storage fails here, the first sync's run tries it again.
    void store.all().catch((): NoteRecord[] => []).then((all) => {
      if (!live) return;
      setNotes(all);
      setLoaded(true);
      void run();
    });
    // Asks iOS to keep the phone copy. It may say no, so unsynced text stays visible.
    void navigator.storage?.persist?.();
    const onVisible = () => {
      // Hidden too: it's the last chance to push before iOS suspends the app.
      void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, PULL_EVERY_MS);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.clearInterval(timer);
      window.clearTimeout(pushTimer.current);
    };
  }, [run, store]);

  const edit = useCallback(
    async (path: string, text: string, editedFrom: string) => {
      await saveEdit(store, path, text, editedFrom);
      const saved = await store.get(path);
      if (saved) {
        setNotes((all) => [...all.filter((note) => note.path !== path), saved]);
      }
      window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(() => void run(), PUSH_AFTER_EDIT_MS);
    },
    [run, store],
  );

  /** Deletes notes here at once, and from GitHub on the next sync, as one commit. */
  const remove = useCallback(
    async (paths: string[]) => {
      for (const path of paths) await markDeleted(store, path);
      setNotes(await store.all());
      // Unlike typing, there's nothing more coming, so no reason to wait.
      void run();
    },
    [run, store],
  );

  const notes = useMemo(() => stored.filter((note) => !note.deleted), [stored]);
  const pendingDeletes = stored.length - notes.length;

  return {
    notes,
    pendingDeletes,
    remove,
    loaded,
    status,
    edit,
    syncNow: run,
    conflicts: lastResult?.conflicts ?? [],
    keptDeletes: lastResult?.keptDeletes ?? [],
    clearConflicts: () => setLastResult(null),
  };
}
