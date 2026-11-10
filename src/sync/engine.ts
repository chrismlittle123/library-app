import { blobSha } from "./blob";
import { BATCH_SIZE, GitHubError, type FileChange, type GitHubApi, type RemoteTree } from "./github";
import type { NoteRecord, NoteStore } from "./store";

const MAX_ATTEMPTS = 4;
const DOWNLOAD_CONCURRENCY = 6;

export interface SyncResult {
  downloaded: number;
  pushed: number;
  deleted: number;
  /** Deleted on the phone but changed elsewhere first, so brought back instead. */
  keptDeletes: string[];
  /** Paths where both sides changed, with where the phone's version was saved. */
  conflicts: { path: string; copy: string }[];
}

export type SyncProgress = (done: number, total: number) => void;

export function conflictCopyPath(path: string, now: Date, taken: (path: string) => boolean): string {
  const stem = path.replace(/\.md$/, "");
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
  let candidate = `${stem} (phone conflict ${stamp}).md`;
  for (let n = 2; taken(candidate); n += 1) {
    candidate = `${stem} (phone conflict ${stamp} ${n}).md`;
  }
  return candidate;
}

/**
 * Bring the phone and GitHub into step. The rule throughout is that a phone edit
 * is only ever marked clean once GitHub holds exactly that text, and nothing
 * dirty is overwritten or deleted: if both sides changed, the phone's version is
 * kept as a separate file.
 */
export async function syncNotes(
  api: GitHubApi,
  store: NoteStore,
  onProgress: SyncProgress = () => {},
  now: () => Date = () => new Date(),
): Promise<SyncResult> {
  const result: SyncResult = { downloaded: 0, pushed: 0, deleted: 0, keptDeletes: [], conflicts: [] };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const remote = await api.getTree();
    await pull(api, store, remote, result, onProgress, now);
    try {
      const settled = await push(api, store, remote, result);
      if (settled) return result;
    } catch (error) {
      // Something else pushed first. Everything is still dirty, so go round again.
      if (!(error instanceof GitHubError && error.kind === "stale")) throw error;
    }
  }
  throw new GitHubError("stale", "The branch kept changing. Try again in a moment.");
}

async function pull(
  api: GitHubApi,
  store: NoteStore,
  remote: RemoteTree,
  result: SyncResult,
  onProgress: SyncProgress,
  now: () => Date,
) {
  const locals = new Map((await store.all()).map((note) => [note.path, note]));
  const downloads: { path: string; sha: string; seenRev: number }[] = [];
  const conflicts: { note: NoteRecord; sha: string }[] = [];
  const restores: { note: NoteRecord; sha: string }[] = [];

  for (const [path, sha] of remote.files) {
    const local = locals.get(path);
    if (local?.deleted) {
      // Unchanged since it was deleted, so push leaves it to push. Otherwise the
      // deletion was of a version that's gone, so the newer one comes back.
      if (local.baseSha !== sha) restores.push({ note: local, sha });
    } else if (!local) {
      downloads.push({ path, sha, seenRev: 0 });
    } else if (!local.dirty) {
      if (local.baseSha !== sha) downloads.push({ path, sha, seenRev: local.rev });
    } else if ((await blobSha(local.text)) === sha) {
      // GitHub already has this exact text, perhaps from a push whose reply was lost.
      await markClean(store, local, sha);
    } else if (local.baseSha !== sha) {
      conflicts.push({ note: local, sha });
    }
  }

  for (const local of locals.values()) {
    // Gone from GitHub too, whether deleted there or never pushed: nothing left to do.
    if ((!local.dirty || local.deleted) && !remote.files.has(local.path)) {
      await store.update(local.path, (current) =>
        current && (!current.dirty || current.deleted) && current.rev === local.rev ? null : undefined,
      );
    }
  }

  let done = 0;
  const total = downloads.length;
  if (total > 0) onProgress(0, total);
  // Stored one at a time, so an interrupted first download picks up where it stopped.
  const save = async ({ path, sha, seenRev }: (typeof downloads)[number], text: string | null) => {
    if (text !== null) {
      await store.update(path, (current) => {
        if ((current?.rev ?? 0) !== seenRev || current?.dirty) return undefined;
        result.downloaded += 1;
        return { path, text, baseSha: sha, dirty: false, rev: seenRev, updatedAt: current?.updatedAt ?? 0 };
      });
    }
    done += 1;
    onProgress(done, total);
  };
  for (let start = 0; start < downloads.length; start += BATCH_SIZE) {
    const batch = downloads.slice(start, start + BATCH_SIZE);
    const texts = await api.getTexts(batch.map((item) => item.sha));
    for (const item of batch) {
      const text = texts.get(item.sha);
      if (text !== undefined) await save(item, text);
    }
    // Whatever the batch didn't bring back comes one at a time.
    const queue = batch.filter((item) => !texts.has(item.sha));
    await Promise.all(
      Array.from({ length: DOWNLOAD_CONCURRENCY }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) await save(next, await api.getText(next.sha));
      }),
    );
  }

  for (const { note, sha } of restores) {
    const text = await api.getText(sha);
    if (text === null) continue;
    await store.update(note.path, (current) =>
      current?.rev === note.rev
        ? { path: note.path, text, baseSha: sha, dirty: false, rev: note.rev, updatedAt: note.updatedAt }
        : undefined,
    );
    result.keptDeletes.push(note.path);
  }

  for (const { note, sha } of conflicts) {
    const text = await api.getText(sha);
    if (text === null) continue;
    const paths = new Set((await store.all()).map((item) => item.path));
    const copy = conflictCopyPath(note.path, now(), (path) => paths.has(path) || remote.files.has(path));
    // The copy is written first, so the phone's text exists somewhere at every moment.
    await store.update(copy, () => ({
      path: copy,
      text: note.text,
      baseSha: null,
      dirty: true,
      rev: 1,
      updatedAt: note.updatedAt,
    }));
    await store.update(note.path, (current) =>
      current?.rev === note.rev
        ? { ...current, text, baseSha: sha, dirty: false, updatedAt: note.updatedAt }
        : undefined,
    );
    result.conflicts.push({ path: note.path, copy });
  }
}

async function markClean(store: NoteStore, note: NoteRecord, sha: string) {
  await store.update(note.path, (current) => {
    if (!current) return undefined;
    // If it was edited again in the meantime, it stays dirty against the new base.
    return { ...current, baseSha: sha, dirty: current.rev !== note.rev };
  });
}

/** Push what can be pushed. Returns false if another round is needed. */
async function push(
  api: GitHubApi,
  store: NoteStore,
  remote: RemoteTree,
  result: SyncResult,
): Promise<boolean> {
  const dirty = (await store.all()).filter((note) => note.dirty);

  // Deletions go in a commit of their own, so one revert undoes exactly them.
  const deletions = dirty.filter((note) => note.deleted && note.baseSha !== null && remote.files.get(note.path) === note.baseSha);
  if (deletions.length > 0) {
    await api.commit(
      remote,
      deletions.map(({ path }) => ({ path, text: null })),
      deletionMessage(deletions.map(({ path }) => path)),
    );
    for (const note of deletions) {
      await store.update(note.path, (current) => (current?.rev === note.rev ? null : undefined));
    }
    result.deleted += deletions.length;
    // Edits wait for the next round, against the tree this commit made.
    return deletions.length === dirty.length;
  }

  const toPush = dirty.filter((note) => {
    if (note.deleted) return false;
    const sha = remote.files.get(note.path);
    // Edited after this round looked at it, so the next round works out what to do.
    return sha === undefined || sha === note.baseSha;
  });
  const settled = toPush.length === dirty.length;
  if (toPush.length === 0) return settled;

  const changes: FileChange[] = toPush.map(({ path, text }) => ({ path, text }));
  // A deleted note still waiting is settled by the next pull, not here.
  const noun = changes.length === 1 ? "note" : "notes";
  await api.commit(remote, changes, `phone: update ${changes.length} ${noun}`);
  for (const note of toPush) {
    await markClean(store, note, await blobSha(note.text));
  }
  result.pushed += toPush.length;
  return settled;
}

/** Says what went and where, and lists every file, so the commit is easy to find and revert. */
export function deletionMessage(paths: string[]): string {
  const folders = paths.map((path) => path.split("/").slice(0, -1));
  const shared: string[] = [];
  for (let i = 0; folders.every((parts) => i < parts.length && parts[i] === folders[0][i]); i += 1) {
    shared.push(folders[0][i]);
  }
  const noun = paths.length === 1 ? "note" : "notes";
  const where = shared.length > 0 ? ` in ${shared.join("/")}` : "";
  const list = [...paths].sort().map((path) => `- ${path}`).join("\n");
  return `phone: delete ${paths.length} ${noun}${where}\n\n${list}\n\nUndo with git revert on this commit.`;
}
