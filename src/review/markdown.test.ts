import { describe, it, expect } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("splits out bold and italic", () => {
    expect(parseInline("Press for **10 min**, add one *over* it.")).toEqual([
      { text: "Press for " },
      { text: "10 min", bold: true },
      { text: ", add one " },
      { text: "over", italic: true },
      { text: " it." },
    ]);
  });

  it("leaves a lone or spaced asterisk as text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
    expect(parseInline("plain")).toEqual([{ text: "plain" }]);
    expect(parseInline("")).toEqual([]);
  });
});

describe("parseMarkdown", () => {
  it("reads a paragraph then a bullet list", () => {
    const text =
      "Body can't control blood sugar. **Insulin** lowers it.\n" +
      "- **Type 1** — pancreas fails to make insulin.\n" +
      "- **Type 2** — cells resist insulin.";
    expect(parseMarkdown(text)).toEqual([
      {
        kind: "p",
        lines: [[{ text: "Body can't control blood sugar. " }, { text: "Insulin", bold: true }, { text: " lowers it." }]],
      },
      {
        kind: "ul",
        items: [
          [{ text: "Type 1", bold: true }, { text: " — pancreas fails to make insulin." }],
          [{ text: "Type 2", bold: true }, { text: " — cells resist insulin." }],
        ],
      },
    ]);
  });

  it("keeps a numbered list's first number", () => {
    expect(parseMarkdown("3. Pat dry.\n4. Dress it.")).toEqual([
      { kind: "ol", start: 3, items: [[{ text: "Pat dry." }], [{ text: "Dress it." }]] },
    ]);
  });

  it("starts a new paragraph after a list, and after a blank line", () => {
    const blocks = parseMarkdown("Also:\n- Head injury\nLooks like a fit.\n\nSee a doctor.");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "ul", "p", "p"]);
  });

  it("keeps consecutive plain lines in one paragraph", () => {
    expect(parseMarkdown("one\ntwo")).toEqual([{ kind: "p", lines: [[{ text: "one" }], [{ text: "two" }]] }]);
  });
});
