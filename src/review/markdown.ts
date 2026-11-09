// The Markdown the cards are written in (in Obsidian): **bold**, *italic*,
// "- " bullets and "1. " numbered lists, between plain lines. Parsed into
// blocks the answer renders as elements, never as HTML, so a card's text can't
// inject markup.

interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Line = Span[];

export type Block =
  | { kind: "p"; lines: Line[] }
  | { kind: "ul"; items: Line[] }
  | { kind: "ol"; start: number; items: Line[] };

const INLINE = /\*\*(.+?)\*\*|\*(?=\S)(.+?)(?<=\S)\*/g;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

/** One line's **bold** and *italic*, the rest as plain text. */
export function parseInline(text: string): Line {
  const spans: Line = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) spans.push({ text: text.slice(at, m.index) });
    spans.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], italic: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) spans.push({ text: text.slice(at) });
  return spans;
}

/** A card's text as paragraphs and lists; a blank line ends a paragraph. */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1] as Block | undefined;
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet) {
      if (last?.kind === "ul") last.items.push(parseInline(bullet[1]));
      else blocks.push({ kind: "ul", items: [parseInline(bullet[1])] });
    } else if (numbered) {
      if (last?.kind === "ol") last.items.push(parseInline(numbered[2]));
      else blocks.push({ kind: "ol", start: Number(numbered[1]), items: [parseInline(numbered[2])] });
    } else if (line === "") {
      if (last?.kind === "p") blocks.push({ kind: "p", lines: [] });
    } else if (last?.kind === "p") {
      last.lines.push(parseInline(line));
    } else {
      blocks.push({ kind: "p", lines: [parseInline(line)] });
    }
  }
  return blocks.filter((b) => b.kind !== "p" || b.lines.length > 0);
}
