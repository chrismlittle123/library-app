export interface NoteRecord {
  path: string;
  text: string;
  /** The blob SHA this note was last in step with. Null if it has never been pushed. */
  baseSha: string | null;
  /** True if the note has changes that haven't reached GitHub. */
  dirty: boolean;
  /** Goes up on every edit, so sync can tell if a note changed under it. */
  rev: number;
  updatedAt: number;
}

export interface NoteStore {
  all(): Promise<NoteRecord[]>;
  get(path: string): Promise<NoteRecord | undefined>;
  /** Atomically replace a note. Returning null deletes it, undefined leaves it. */
  update(
    path: string,
    change: (current: NoteRecord | undefined) => NoteRecord | null | undefined,
  ): Promise<void>;
  /** Delete the whole phone copy. */
  erase(): Promise<void>;
}

const STORE = "notes";

/** One database per repo, so a test repo's notes can never be pushed to a real one. */
export function openStore(owner: string, repo: string): NoteStore {
  const name = `vault:${owner}/${repo}`;
  let opening: Promise<IDBDatabase> | null = null;
  let erased = false;

  function open(): Promise<IDBDatabase> {
    // A sync still running mustn't bring back a database that was just erased.
    if (erased) return Promise.reject(new Error("This phone's copy was erased."));
    opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "path" });
      };
      request.onsuccess = () => {
        const db = request.result;
        // iOS can close the connection in the background, so reopen next time.
        db.onclose = () => {
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        opening = null;
        reject(request.error ?? new Error("Couldn't open the phone's storage."));
      };
    });
    return opening;
  }

  async function withTransaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    let tx: IDBTransaction;
    try {
      tx = (await open()).transaction(STORE, mode);
    } catch {
      // iOS can drop the connection without firing onclose, so reopen once.
      opening = null;
      tx = (await open()).transaction(STORE, mode);
    }
    try {
      return await work(tx);
    } catch (error) {
      opening = null;
      throw error;
    }
  }

  function read<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return withTransaction("readonly", (tx) => new Promise((resolve, reject) => {
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Couldn't read the note."));
    }));
  }

  return {
    all: () => read((store) => store.getAll() as IDBRequest<NoteRecord[]>),
    get: (path) => read((store) => store.get(path) as IDBRequest<NoteRecord | undefined>),

    update(path, change) {
      return withTransaction("readwrite", (tx) => new Promise<void>((resolve, reject) => {
        const store = tx.objectStore(STORE);
        const get = store.get(path);
        get.onsuccess = () => {
          const next = change(get.result as NoteRecord | undefined);
          if (next === null) store.delete(path);
          else if (next) store.put(next);
        };
        // Resolves only once the write is really on disk.
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Couldn't save the note."));
        tx.onabort = () => reject(tx.error ?? new Error("Couldn't save the note."));
      }));
    },

    async erase() {
      const db = await open();
      db.close();
      opening = null;
      erased = true;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("Couldn't erase the notes."));
      });
    },
  };
}

/**
 * Record a user's edit. It stays dirty until sync confirms it reached GitHub.
 * `editedFrom` is the text the edit was made from. If the stored note has changed
 * since, the edit didn't see that change, so it loses its base and the next sync
 * keeps both versions rather than pushing over the change.
 */
export function saveEdit(store: NoteStore, path: string, text: string, editedFrom: string): Promise<void> {
  return store.update(path, (current) => ({
    path,
    text,
    baseSha: current && current.text === editedFrom ? current.baseSha : null,
    dirty: true,
    rev: (current?.rev ?? 0) + 1,
    updatedAt: Date.now(),
  }));
}
