import { redo, undo } from "@codemirror/commands";
import { type EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { SaveQueue } from "./saveQueue";
import { insertLink, toggleLinePrefix, toggleWrap } from "./commands";
import { loadMode, saveMode } from "./config";
import { createEditorState, setMode, type Mode } from "./editorState";
import type { NoteRecord } from "./sync/store";
import { BackIcon } from "./icons";
import { displayName, isGenerated } from "./library";

const SAVE_DELAY_MS = 250;

interface Props {
  path: string;
  text: string;
  /** This note as sync last left it, or undefined if it isn't stored yet. */
  record: NoteRecord | undefined;
  /** Reads the stored note, because `record` can lag behind what's on disk. */
  readStored: () => Promise<NoteRecord | undefined>;
  onSave: (text: string, editedFrom: string) => Promise<void>;
  onBack: () => void;
  autoFocus: boolean;
}

export function Editor({ path, text, record, readStored, onSave, onBack, autoFocus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [readOnly] = useState(() => isGenerated(text));

  const timer = useRef<number>();
  const applyingRemote = useRef(false);
  // What this editor believes is stored, so a save can tell if it changed underneath.
  const storedText = useRef(text);
  const latestSave = useRef(onSave);
  latestSave.current = onSave;

  const [queue] = useState(
    () =>
      new SaveQueue(
        async (next) => {
          const editedFrom = storedText.current;
          storedText.current = next;
          try {
            await latestSave.current(next, editedFrom);
          } catch (error) {
            storedText.current = editedFrom;
            throw error;
          }
        },
        (failed) => {
          setSaveFailed(failed);
          if (!queue.busy) setSaving(false);
        },
      ),
  );

  const flush = useRef(() => {
    window.clearTimeout(timer.current);
    return queue.flush();
  });

  useEffect(() => {
    const onChange = (next: string) => {
      if (applyingRemote.current) return;
      queue.change(next);
      setSaving(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush.current, SAVE_DELAY_MS);
    };
    const editor = new EditorView({
      parent: host.current!,
      state: createEditorState(text, loadMode(), readOnly, onChange),
    });
    view.current = editor;
    if (autoFocus && !readOnly) {
      // A new note opens with its template, and writing carries on below that.
      editor.dispatch({ selection: { anchor: editor.state.doc.length } });
      editor.focus();
    }

    const save = () => void flush.current();
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    const keepCursorVisible = () => {
      if (editor.hasFocus) {
        editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.selection.main.head) });
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    window.visualViewport?.addEventListener("resize", keepCursorVisible);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      window.visualViewport?.removeEventListener("resize", keepCursorVisible);
      save();
      editor.destroy();
      view.current = null;
    };
    // The editor is created once per note: App remounts this component by path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up a change that arrived from GitHub, but only if nothing here is waiting
  // to be saved, checked against the stored note and not a possibly stale copy.
  const remoteText = record && !record.dirty ? record.text : null;
  useEffect(() => {
    if (remoteText === null) return;
    let live = true;
    void readStored().then((stored) => {
      const editor = view.current;
      if (!live || !editor || !stored || stored.dirty) return;
      if (queue.busy) return;
      storedText.current = stored.text;
      if (stored.text === editor.state.doc.toString()) return;
      applyingRemote.current = true;
      const head = Math.min(editor.state.selection.main.head, stored.text.length);
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: stored.text },
        selection: { anchor: head },
        // Otherwise undo would take back the change, and push that over GitHub.
        annotations: Transaction.addToHistory.of(false),
      });
      applyingRemote.current = false;
    });
    return () => {
      live = false;
    };
  }, [remoteText, readStored, queue]);

  const run = (spec: (state: EditorState) => TransactionSpec) => () => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(editor.state.update(spec(editor.state), { scrollIntoView: true }));
    editor.focus();
  };

  const toggleMode = () => {
    const next: Mode = mode === "styled" ? "hidden" : "styled";
    setModeState(next);
    saveMode(next);
    if (view.current) setMode(view.current, next);
  };

  const tools: { label: string; name: string; action: () => void }[] = [
    { label: "H", name: "Heading", action: run((s) => toggleLinePrefix(s, "## ")) },
    { label: "B", name: "Bold", action: run((s) => toggleWrap(s, "**")) },
    { label: "I", name: "Italic", action: run((s) => toggleWrap(s, "*")) },
    { label: "•", name: "List", action: run((s) => toggleLinePrefix(s, "- ")) },
    { label: "☐", name: "Checkbox", action: run((s) => toggleLinePrefix(s, "- [ ] ")) },
    { label: "[[", name: "Link", action: run(insertLink) },
    { label: "↶", name: "Undo", action: () => view.current && undo(view.current) },
    { label: "↷", name: "Redo", action: () => view.current && redo(view.current) },
    { label: "⌄", name: "Hide keyboard", action: () => view.current?.contentDOM.blur() },
  ];

  let label = "Synced";
  let state = "ok";
  if (readOnly) label = "Read only";
  else if (saveFailed) {
    label = "Couldn't save";
    state = "failed";
  } else if (saving) label = "Saving…";
  else if (!record) label = "New";
  else if (record.dirty) {
    label = "Not synced";
    state = "pending";
  }

  return (
    <>
      <header className="bar">
        <button
          type="button"
          className="tool"
          aria-label="Back"
          onClick={() => {
            void flush.current().then(() => {
              // If it couldn't be saved, leaving now would lose the text.
              if (!queue.hasUnsaved) onBack();
            });
          }}
        >
          <BackIcon />
        </button>
        <h1 className="bar-title">{displayName(path)}</h1>
        <span className="status" role="status" data-status={state}>
          {label}
        </span>
        <button type="button" className="tool" aria-pressed={mode === "hidden"} onClick={toggleMode}>
          <span aria-hidden="true">Aa</span>
          <span className="sr-only">Hide markdown symbols</span>
        </button>
      </header>
      <main className="editor" ref={host} />
      {!readOnly && (
        <nav className="toolbar" aria-label="Formatting">
          {tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              className="tool"
              aria-label={tool.name}
              // Stops the tap taking focus from the editor and closing the keyboard.
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={tool.action}
            >
              {tool.label}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
