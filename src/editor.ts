import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { Compartment, EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  keymap,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type Mode = "styled" | "hidden";

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.45em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.25em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.1em", fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.9em" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--muted)" },
  { tag: tags.quote, color: "var(--muted)" },
  { tag: tags.processingInstruction, color: "var(--muted)" },
  { tag: tags.contentSeparator, color: "var(--muted)" },
]);

const MARKS = new Set(["HeaderMark", "EmphasisMark", "StrikethroughMark", "CodeMark"]);
const hide = Decoration.replace({});

/** Hide markdown symbols, except on the lines being edited. */
function hiddenMarks(view: EditorView): DecorationSet {
  const editing = view.hasFocus ? view.state.selection.ranges : [];
  const active = new Set(
    editing.flatMap((range) => {
      const first = view.state.doc.lineAt(range.from).number;
      const last = view.state.doc.lineAt(range.to).number;
      return Array.from({ length: last - first + 1 }, (_, i) => first + i);
    }),
  );
  const marks: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (!MARKS.has(node.name)) return;
        const line = view.state.doc.lineAt(node.from);
        if (active.has(line.number)) return;
        // A heading's # is followed by a space, which goes with it.
        const end = node.name === "HeaderMark" ? Math.min(node.to + 1, line.to) : node.to;
        if (end > node.from) marks.push(hide.range(node.from, end));
      },
    });
  }
  return Decoration.set(marks, true);
}

const hideMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = hiddenMarks(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
        this.decorations = hiddenMarks(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const modeCompartment = new Compartment();
const modeExtension = (mode: Mode) => (mode === "hidden" ? hideMarks : []);

export function setMode(view: EditorView, mode: Mode) {
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtension(mode)) });
}

export function createEditorState(text: string, mode: Mode, onChange: (text: string) => void) {
  return EditorState.create({
    doc: text,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      // Includes Enter continuing lists and checkboxes.
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      modeCompartment.of(modeExtension(mode)),
      EditorView.lineWrapping,
      // CodeMirror turns these off by default, but a diary wants them on.
      EditorView.contentAttributes.of({
        autocorrect: "on",
        autocapitalize: "sentences",
        spellcheck: "true",
      }),
      // Keeps the cursor clear of the toolbar when the view scrolls to it.
      EditorView.theme({ "&": { height: "100%" } }),
      EditorView.scrollMargins.of(() => ({ top: 24, bottom: 48 })),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
}
