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
  WidgetType,
  keymap,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type Mode = "styled" | "hidden";

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "500", lineHeight: "1.25" },
  { tag: tags.heading2, fontSize: "1.2em", fontWeight: "600", color: "var(--accent)" },
  { tag: tags.heading3, fontSize: "1.05em", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.9em" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--muted)" },
  { tag: tags.quote, color: "var(--muted)" },
  { tag: tags.processingInstruction, color: "var(--muted)" },
  { tag: tags.contentSeparator, color: "var(--muted)" },
]);

const MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "QuoteMark",
  "ListMark",
  "TaskMarker",
]);
const hide = Decoration.replace({});

class BulletWidget extends WidgetType {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
  }
  eq() {
    return true;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });

class BoxWidget extends WidgetType {
  constructor(readonly done: boolean) {
    super();
  }
  toDOM() {
    const box = document.createElement("span");
    box.className = this.done ? "cm-box cm-box-done" : "cm-box";
    return box;
  }
  eq(other: BoxWidget) {
    return other.done === this.done;
  }
}
const boxes = {
  open: Decoration.replace({ widget: new BoxWidget(false) }),
  done: Decoration.replace({ widget: new BoxWidget(true) }),
};
const quoteLine = Decoration.line({ class: "cm-quote" });

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
        const mark = view.state.doc.sliceString(node.from, node.to);
        if (node.name === "TaskMarker") {
          marks.push((/x/i.test(mark) ? boxes.done : boxes.open).range(node.from, node.to));
          return;
        }
        if (node.name === "ListMark") {
          // Numbers stay. A dash becomes a bullet, or goes if a checkbox follows it.
          if (!/^[-*+]$/.test(mark)) return;
          const task = /^\s?\[[ xX]\]/.test(view.state.doc.sliceString(node.to, line.to));
          if (task) marks.push(hide.range(node.from, Math.min(node.to + 1, line.to)));
          else marks.push(bullet.range(node.from, node.to));
          return;
        }
        // A heading's # and a quote's > are followed by a space, which goes with them.
        const spaced = node.name === "HeaderMark" || node.name === "QuoteMark";
        const end = spaced ? Math.min(node.to + 1, line.to) : node.to;
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

/** Quotes are set off with a rule in both modes, so they read as quotes while being typed. */
function quoteLines(view: EditorView): DecorationSet {
  const lines: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Blockquote") return;
        for (let pos = node.from; pos <= node.to; ) {
          const line = view.state.doc.lineAt(pos);
          lines.push(quoteLine.range(line.from));
          pos = line.to + 1;
        }
        return false;
      },
    });
  }
  return Decoration.set(lines, true);
}

const quotes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = quoteLines(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = quoteLines(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const modeCompartment = new Compartment();
const modeExtension = (mode: Mode) => (mode === "hidden" ? hideMarks : []);

export function setMode(view: EditorView, mode: Mode) {
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtension(mode)) });
}

export function createEditorState(
  text: string,
  mode: Mode,
  readOnly: boolean,
  onChange: (text: string) => void,
) {
  return EditorState.create({
    doc: text,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      // Includes Enter continuing lists and checkboxes.
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      quotes,
      modeCompartment.of(modeExtension(mode)),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
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
