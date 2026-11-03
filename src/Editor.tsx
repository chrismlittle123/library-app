import { redo, undo } from "@codemirror/commands";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { insertLink, toggleLinePrefix, toggleWrap } from "./commands";
import { loadMode, saveMode } from "./config";
import { createEditorState, setMode, type Mode } from "./editorState";
import type { NoteRecord } from "./sync/store";
import { isGenerated, noteTitle } from "./vault";

const SAVE_DELAY_MS = 250;

interface Props {
  path: string;
  text: string;
  /** This note as sync last left it, or undefined if it isn't stored yet. */
  record: NoteRecord | undefined;
  /** Reads the stored note, because `record` can lag behind what's on disk. */
  readStored: () => Promise<NoteRecord | undefined>;
  onSave: (text: string) => Promise<void>;
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
  const unsaved = useRef<string | null>(null);
  const inFlight = useRef(0);
  const applyingRemote = useRef(false);
  const latestSave = useRef(onSave);
  latestSave.current = onSave;

  const flush = useRef(() => {
    window.clearTimeout(timer.current);
    const pending = unsaved.current;
    if (pending === null) return;
    unsaved.current = null;
    inFlight.current += 1;
    latestSave
      .current(pending)
      .then(() => setSaveFailed(false))
      .catch(() => {
        // Try again on the next flush rather than dropping the text.
        unsaved.current ??= pending;
        setSaveFailed(true);
      })
      .finally(() => {
        inFlight.current -= 1;
        if (inFlight.current === 0 && unsaved.current === null) setSaving(false);
      });
  });

  useEffect(() => {
    const onChange = (next: string) => {
      if (applyingRemote.current) return;
      unsaved.current = next;
      setSaving(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush.current, SAVE_DELAY_MS);
    };
    const editor = new EditorView({
      parent: host.current!,
      state: createEditorState(text, loadMode(), readOnly, onChange),
    });
    view.current = editor;
    if (autoFocus && !readOnly) editor.focus();

    const save = flush.current;
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
      if (unsaved.current !== null || inFlight.current > 0) return;
      if (stored.text === editor.state.doc.toString()) return;
      applyingRemote.current = true;
      const head = Math.min(editor.state.selection.main.head, stored.text.length);
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: stored.text },
        selection: { anchor: head },
      });
      applyingRemote.current = false;
    });
    return () => {
      live = false;
    };
  }, [remoteText, readStored]);

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
            flush.current();
            onBack();
          }}
        >
          ‹
        </button>
        <h1 className="bar-title">{noteTitle(path)}</h1>
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
