import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { insertLink, toggleLinePrefix, toggleWrap } from "./commands";

function state(doc: string, from: number, to = from) {
  return EditorState.create({ doc, selection: EditorSelection.single(from, to) });
}

function apply(start: EditorState, spec: TransactionSpec) {
  const next = start.update(spec).state;
  return { doc: next.doc.toString(), from: next.selection.main.from, to: next.selection.main.to };
}

describe("toggleWrap", () => {
  it("wraps a selection and keeps it selected", () => {
    const s = state("a word here", 2, 6);
    expect(apply(s, toggleWrap(s, "**"))).toEqual({ doc: "a **word** here", from: 4, to: 8 });
  });

  it("unwraps an already wrapped selection", () => {
    const s = state("a **word** here", 4, 8);
    expect(apply(s, toggleWrap(s, "**"))).toEqual({ doc: "a word here", from: 2, to: 6 });
  });

  it("puts the cursor between the marks with no selection", () => {
    const s = state("ab", 1);
    expect(apply(s, toggleWrap(s, "*"))).toEqual({ doc: "a**b", from: 2, to: 2 });
  });
});

describe("toggleLinePrefix", () => {
  it("adds a prefix and moves the cursor with the text", () => {
    const s = state("first\nsecond", 8);
    expect(apply(s, toggleLinePrefix(s, "- "))).toEqual({ doc: "first\n- second", from: 10, to: 10 });
  });

  it("removes a matching prefix", () => {
    const s = state("- item", 4);
    expect(apply(s, toggleLinePrefix(s, "- "))).toEqual({ doc: "item", from: 2, to: 2 });
  });

  it("replaces a different prefix", () => {
    const s = state("- item", 4);
    expect(apply(s, toggleLinePrefix(s, "## ")).doc).toBe("## item");
  });

  it("doesn't move the cursor before the line when it sat inside the prefix", () => {
    const s = state("x\n## item", 3);
    expect(apply(s, toggleLinePrefix(s, "## "))).toEqual({ doc: "x\nitem", from: 2, to: 2 });
  });
});

describe("insertLink", () => {
  it("puts the cursor inside the brackets", () => {
    const s = state("see ", 4);
    expect(apply(s, insertLink(s))).toEqual({ doc: "see [[]]", from: 6, to: 6 });
  });
});
