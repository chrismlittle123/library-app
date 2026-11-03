import { redo, undo } from "@codemirror/commands";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { insertLink, toggleLinePrefix, toggleWrap } from "./commands";
import { createEditorState, setMode, type Mode } from "./editor";
import { SAMPLES } from "./samples";
import {
  clearNote,
  loadLastNote,
  loadMode,
  loadNote,
  saveLastNote,
  saveMode,
  saveNote,
} from "./storage";

const SAVE_DELAY_MS = 400;

type Status = "saved" | "saving" | "failed";
const STATUS_LABEL: Record<Status, string> = {
  saved: "Saved",
  saving: "Saving…",
  failed: "Couldn't save",
};

function sampleText(id: string): string {
  return SAMPLES.find((sample) => sample.id === id)?.text ?? "";
}

function firstNoteId(): string {
  const last = loadLastNote();
  return SAMPLES.some((sample) => sample.id === last) && last ? last : SAMPLES[0].id;
}

/** Fit the app to the space above the keyboard, which iOS doesn't do for us. */
function useVisualViewport(onChange: () => void) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty("--app-height", `${viewport.height}px`);
      root.style.setProperty("--app-top", `${viewport.offsetTop}px`);
      root.classList.toggle("keyboard-open", window.innerHeight - viewport.height > 120);
      onChange();
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, [onChange]);
}

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saveTimer = useRef<number>();
  const pending = useRef<(() => void) | null>(null);
  const [noteId, setNoteId] = useState(firstNoteId);
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [status, setStatus] = useState<Status>("saved");
  const modeRef = useRef(mode);

  // Saves whatever is waiting, for when the note changes or the app is hidden.
  const flush = useRef(() => {
    window.clearTimeout(saveTimer.current);
    pending.current?.();
    pending.current = null;
  });

  const keepCursorVisible = useRef(() => {
    const editor = view.current;
    if (editor?.hasFocus) {
      editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.selection.main.head) });
    }
  });
  useVisualViewport(keepCursorVisible.current);

  useEffect(() => {
    const editor = new EditorView({ parent: host.current! });
    view.current = editor;
    const save = flush.current;
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      save();
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    flush.current();
    saveLastNote(noteId);
    const onChange = (text: string) => {
      setStatus("saving");
      pending.current = () => setStatus(saveNote(noteId, text) ? "saved" : "failed");
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush.current, SAVE_DELAY_MS);
    };
    const text = loadNote(noteId) ?? sampleText(noteId);
    view.current?.setState(createEditorState(text, modeRef.current, onChange));
    view.current?.scrollDOM.scrollTo(0, 0);
    setStatus("saved");
  }, [noteId]);

  const run = (spec: (state: EditorState) => TransactionSpec) => () => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(editor.state.update(spec(editor.state), { scrollIntoView: true }));
    editor.focus();
  };

  const toggleMode = () => {
    const next: Mode = mode === "styled" ? "hidden" : "styled";
    modeRef.current = next;
    setModeState(next);
    saveMode(next);
    if (view.current) setMode(view.current, next);
  };

  const resetNote = () => {
    window.clearTimeout(saveTimer.current);
    pending.current = null;
    clearNote(noteId);
    view.current?.dispatch({
      changes: {
        from: 0,
        to: view.current.state.doc.length,
        insert: sampleText(noteId),
      },
    });
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

  return (
    <div className="app">
      <header className="bar">
        <select
          aria-label="Note"
          value={noteId}
          onChange={(event) => setNoteId(event.target.value)}
        >
          {SAMPLES.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.title}
            </option>
          ))}
        </select>
        <span className="status" role="status" data-status={status}>
          {STATUS_LABEL[status]}
        </span>
        <button type="button" className="tool" aria-pressed={mode === "hidden"} onClick={toggleMode}>
          <span aria-hidden="true">Aa</span>
          <span className="sr-only">Hide markdown symbols</span>
        </button>
      </header>
      <main className="editor" ref={host} />
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
        <button type="button" className="tool reset" onClick={resetNote}>
          Reset
        </button>
        <span className="build">{__BUILD__}</span>
      </nav>
    </div>
  );
}
