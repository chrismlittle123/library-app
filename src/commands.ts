import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";

/** Wrap each selection in `mark`, or unwrap it if it is already wrapped. */
export function toggleWrap(state: EditorState, mark: string): TransactionSpec {
  const size = mark.length;
  return state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - size, range.from);
    const after = state.sliceDoc(range.to, range.to + size);
    if (before === mark && after === mark) {
      return {
        changes: [
          { from: range.from - size, to: range.from },
          { from: range.to, to: range.to + size },
        ],
        range: EditorSelection.range(range.from - size, range.to - size),
      };
    }
    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark },
      ],
      range: EditorSelection.range(range.from + size, range.to + size),
    };
  });
}

const LINE_PREFIX = /^(#{1,6} |- \[[ x]\] |- )/;

/** Set the line's prefix, replacing any existing one, or remove it if it matches. */
export function toggleLinePrefix(state: EditorState, prefix: string): TransactionSpec {
  return state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const existing = LINE_PREFIX.exec(line.text)?.[0] ?? "";
    const insert = existing === prefix ? "" : prefix;
    const shift = insert.length - existing.length;
    return {
      changes: { from: line.from, to: line.from + existing.length, insert },
      range: EditorSelection.cursor(Math.max(line.from, range.head + shift)),
    };
  });
}

/** Insert an empty [[wikilink]] with the cursor inside it. */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: "[[]]" },
    range: EditorSelection.cursor(range.from + 2),
  }));
}
