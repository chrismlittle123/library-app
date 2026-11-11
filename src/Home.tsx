import { useDeferredValue, useMemo, useRef, useState } from "react";
import { NoteSearch } from "./search";
import type { NoteRecord } from "./sync/store";
import type { SyncStatus } from "./useSync";
import { BackIcon, SettingsIcon } from "./icons";
import { SectionIcon, hasSectionIcon } from "./sectionIcons";
import { displayName, dueMonthlyReview, isConflictCopy, listFolder, newNotePath, nextDiaryEntry, noteName } from "./library";

const RECENT_SHOWN = 3;

interface Props {
  notes: NoteRecord[];
  status: SyncStatus;
  folder: string;
  onFolder: (folder: string) => void;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (path: string) => void;
  /** Opens a note, starting a new one with `draft` if it doesn't exist yet. */
  onWrite: (path: string, draft: string) => void;
  onCreate: (path: string) => void;
  onSync: () => void;
  onSettings: () => void;
  /** Paths of notes opened on this phone, most recent first. */
  recent: string[];
  /** Deletions made here that haven't reached GitHub yet. */
  pendingDeletes: number;
  onDeleteFolder: (paths: string[]) => void;
}

function statusLine(status: SyncStatus, unsynced: number): { text: string; state: string } {
  // Shown as "not synced" too: a deletion is a change GitHub doesn't have yet.
  const pending = unsynced > 0 ? ` · ${unsynced} not synced` : "";
  if (status.progress && status.progress.total > 0) {
    return {
      text: `Downloading ${status.progress.done} of ${status.progress.total}${pending}`,
      state: "busy",
    };
  }
  if (status.running) return { text: `Syncing…${pending}`, state: "busy" };
  if (status.error?.kind === "network") return { text: `Offline${pending}`, state: "pending" };
  if (status.error) return { text: `${status.error.message}${pending}`, state: "failed" };
  if (unsynced > 0) return { text: `${unsynced} not synced`, state: "pending" };
  return { text: "Synced", state: "ok" };
}

export function Home(props: Props) {
  const {
    notes,
    status,
    folder,
    onFolder,
    query,
    onQuery,
    onOpen,
    onWrite,
    onCreate,
    onSync,
    onSettings,
    recent,
    pendingDeletes,
    onDeleteFolder,
  } = props;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const deferredQuery = useDeferredValue(query);
  const search = useRef<NoteSearch | null>(null);

  const hits = useMemo(() => {
    if (!deferredQuery.trim()) return null;
    // Built on the first search, so it costs nothing until it's needed.
    search.current ??= new NoteSearch();
    search.current.sync(notes);
    return search.current.search(deferredQuery);
  }, [deferredQuery, notes]);

  const view = useMemo(() => {
    const listed = listFolder(notes, folder);
    // The shortcuts write entries themselves, so the templates folder is just clutter.
    if (!folder) listed.folders = listed.folders.filter((item) => item.name !== "templates");
    return listed;
  }, [notes, folder]);
  const paths = useMemo(() => notes.map((note) => note.path), [notes]);
  const diary = nextDiaryEntry(notes, new Date());
  const review = dueMonthlyReview(paths, new Date());
  const textOf = useMemo(() => new Map(notes.map((note) => [note.path, note.text])), [notes]);
  const unsynced = useMemo(() => notes.filter((note) => note.dirty), [notes]);
  const conflicts = useMemo(() => notes.filter((note) => isConflictCopy(note.path)), [notes]);
  const recentNotes = useMemo(() => {
    const byPath = new Map(notes.map((note) => [note.path, note]));
    return recent.flatMap((path) => byPath.get(path) ?? []).slice(0, RECENT_SHOWN);
  }, [notes, recent]);
  const showRecent = !folder && recentNotes.length > 0;
  const line = statusLine(status, unsynced.length + pendingDeletes);
  const inFolder = useMemo(
    () => (folder ? notes.filter((note) => note.path.startsWith(`${folder}/`)) : []),
    [notes, folder],
  );
  const unsyncedInFolder = inFolder.filter((note) => note.dirty).length;
  const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";

  const create = () => {
    const path = newNotePath(folder || "inbox", name);
    if (!path) return;
    setNaming(false);
    setName("");
    onCreate(path);
  };

  return (
    <>
      <header className="bar">
        {folder ? (
          <button type="button" className="tool" aria-label="Up a folder" onClick={() => onFolder(parent)}>
            <BackIcon />
          </button>
        ) : (
          <button type="button" className="tool" aria-label="Settings" onClick={onSettings}>
            <SettingsIcon />
          </button>
        )}
        <h1 className="bar-title">{folder ? displayName(folder) : "Library"}</h1>
        <button type="button" className="sync-button" data-status={line.state} onClick={onSync}>
          {line.text}
        </button>
      </header>
      <main className="list">
        <div className="search">
          <input
            type="search"
            aria-label="Search notes"
            placeholder="Search"
            value={query}
            autoCorrect="off"
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>

        {hits ? (
          <ul className="rows">
            {hits.length === 0 && <li className="empty">No notes match that.</li>}
            {hits.map((hit) => (
              <li key={hit.path}>
                <button type="button" className="row" onClick={() => onOpen(hit.path)}>
                  <span className="row-title">{noteName(hit.path, textOf.get(hit.path))}</span>
                  <span className="row-detail">{hit.snippet}</span>
                  <span className="row-path">{hit.path}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {!folder && (
              <div className="actions">
                <button type="button" className="primary shortcut" onClick={() => onWrite(diary.path, diary.draft)}>
                  {diary.span === "Today" && notes.some((note) => note.path === diary.path)
                    ? "Continue today's entry"
                    : "New diary entry"}
                  <span className="shortcut-detail">{diary.span}</span>
                </button>
                {review && (
                  <button type="button" className="secondary" onClick={() => onWrite(review.path, "")}>
                    Write {review.month}'s review
                  </button>
                )}
              </div>
            )}

            {!folder && unsynced.length > 0 && (
              <section aria-label="Not synced">
                <h2>Not synced yet</h2>
                <ul className="rows">
                  {unsynced.map((note) => (
                    <NoteRow key={note.path} note={note} onOpen={onOpen} showPath />
                  ))}
                </ul>
              </section>
            )}

            {!folder && conflicts.length > 0 && (
              <section aria-label="Conflict copies">
                <h2>Changed on both sides</h2>
                <p className="hint">
                  These hold your phone's version. Combine them with the original, then delete them on
                  your laptop.
                </p>
                <ul className="rows">
                  {conflicts.map((note) => (
                    <NoteRow key={note.path} note={note} onOpen={onOpen} showPath />
                  ))}
                </ul>
              </section>
            )}

            {showRecent && (
              <section aria-label="Recent">
                <h2>Recent</h2>
                <ul className="rows">
                  {recentNotes.map((note) => (
                    <NoteRow key={note.path} note={note} onOpen={onOpen} showFolder />
                  ))}
                </ul>
              </section>
            )}

            {showRecent && <h2 className="list-heading">Shelves</h2>}
            <ul className="rows">
              {view.folders.map((item) => (
                <li key={item.path}>
                  <button type="button" className="row folder" onClick={() => onFolder(item.path)}>
                    {!folder && hasSectionIcon(item.name) && <SectionIcon name={item.name} />}
                    <span className="row-title">{displayName(item.path)}</span>
                    <span className="row-count">{item.count}</span>
                  </button>
                </li>
              ))}
              {view.notes.map((note) => (
                <NoteRow key={note.path} note={note} onOpen={onOpen} />
              ))}
              {notes.length === 0 && !status.running && !status.error && (
                <li className="empty">No notes found in this folder of the repo.</li>
              )}
            </ul>

            <div className="actions">
              {naming ? (
                <form
                  className="new-note"
                  onSubmit={(event) => {
                    event.preventDefault();
                    create();
                  }}
                >
                  <input
                    aria-label="Note name"
                    placeholder="Note name"
                    value={name}
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button type="submit" className="secondary">
                    Create
                  </button>
                </form>
              ) : (
                <button type="button" className="secondary" onClick={() => setNaming(true)}>
                  New note in {folder ? displayName(folder) : "Inbox"}
                </button>
              )}
            </div>

            {folder && inFolder.length > 0 && (
              <div className="actions">
                {confirmingDelete ? (
                  <div className="confirm" role="alertdialog" aria-label="Delete this folder?">
                    <p>
                      Delete all {inFolder.length} {inFolder.length === 1 ? "note" : "notes"} in{" "}
                      {displayName(folder)}, including any folders inside it? They go from GitHub on the next sync,
                      as one commit, so they can be restored from git history. Files that aren't notes, like JSON,
                      stay.
                    </p>
                    {unsyncedInFolder > 0 && (
                      <p className="error">
                        {unsyncedInFolder} of them {unsyncedInFolder === 1 ? "has" : "have"} changes that haven't
                        reached GitHub, and those changes can't be restored.
                      </p>
                    )}
                    <div className="confirm-actions">
                      <button type="button" className="secondary" onClick={() => setConfirmingDelete(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setConfirmingDelete(false);
                          onDeleteFolder(inFolder.map((note) => note.path));
                          onFolder(parent);
                        }}
                      >
                        Delete {inFolder.length} {inFolder.length === 1 ? "note" : "notes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="quiet-danger" onClick={() => setConfirmingDelete(true)}>
                    Delete folder
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function NoteRow({
  note,
  onOpen,
  showPath = false,
  showFolder = false,
}: {
  note: NoteRecord;
  onOpen: (path: string) => void;
  showPath?: boolean;
  /** Where the note lives, for a list that mixes folders. */
  showFolder?: boolean;
}) {
  const parent = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : "";
  const section = note.path.split("/")[0];
  const icon = showFolder && hasSectionIcon(section);
  return (
    <li>
      <button type="button" className={icon ? "row with-icon" : "row"} onClick={() => onOpen(note.path)}>
        {icon && <SectionIcon name={section} size={30} />}
        <span className="row-text">
          <span className="row-title">
            {noteName(note.path, note.text)}
            {note.dirty && <span className="dot" aria-label="Not synced" />}
          </span>
          {showPath && <span className="row-path">{note.path}</span>}
          {showFolder && parent && (
            <span className="row-path">
              {displayName(parent.split("/")[0])}
              {/* A diary entry's name has no year, so say which. */}
              {note.path.startsWith("diary/") && /\/(\d{4})\//.test(note.path) && ` · ${/\/(\d{4})\//.exec(note.path)![1]}`}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
