import { syncNotes, type SyncResult } from "./engine";
import { GitHubError, isNotePath, type GitHubApi } from "./github";
import type { NoteStore } from "./store";

/** Run while ordinary sync and editor input are paused. Never queue a deletion. */
export async function moveNote(
  api: GitHubApi,
  store: NoteStore,
  path: string,
  destination: string,
  expectedText: string,
  onSynced: (result: SyncResult) => void = () => {},
): Promise<void> {
  if (path === destination || !isNotePath(destination) ||
      destination.split("/").some((part) => !part || part === ".." || part.includes("\\"))) {
    throw new Error("Choose a different folder.");
  }
  if (await store.get(destination)) throw new Error("A note with this filename already exists in that folder.");

  // A clean source is important: if the app closes after the commit, the next
  // normal pull removes the old path instead of resurrecting a dirty note there.
  onSynced(await syncNotes(api, store));
  const note = await store.get(path);
  if (!note || note.deleted || note.dirty || note.text !== expectedText) {
    throw new Error("This note changed while syncing. Check it before moving it again.");
  }
  const remote = await api.getTree();
  if (remote.files.get(path) !== note.baseSha) {
    throw new Error("This note changed elsewhere. Sync and check it before moving it again.");
  }
  if (remote.files.has(destination) || await store.get(destination)) {
    throw new Error("A note with this filename already exists in that folder.");
  }
  // The ref update is never forced. A concurrent edit or destination creation
  // makes it fail, so both paths always change together against the checked tree.
  try {
    await api.commit(remote, [{ path, text: null }, { path: destination, text: note.text }],
      `phone: move ${path} to ${destination}\n\nUndo with git revert on this commit.`);
  } catch (error) {
    if (!(error instanceof GitHubError && error.kind === "network")) throw error;
    // The ref update may have succeeded even though its reply never arrived.
    // Only call it successful if both paths prove the exact move was committed.
    const latest = await api.getTree().catch(() => null);
    if (!latest || latest.files.has(path) || latest.files.get(destination) !== note.baseSha) {
      throw new GitHubError("network", "Couldn't confirm the move. Sync before editing or trying again.");
    }
  }

  // GitHub has committed the move. Cache failure mustn't report a failed move;
  // a normal sync (or a relaunch) can reconstruct both clean paths from GitHub.
  try {
    await store.update(destination, (current) => current ?? { ...note, path: destination });
    await store.update(path, (current) => current?.rev === note.rev && !current.dirty ? null : undefined);
  } catch { /* Recovered by the next sync. */ }
}
