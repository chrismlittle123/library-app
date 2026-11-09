import MiniSearch from "minisearch";
import type { NoteRecord } from "./sync/store";
import { noteTitle } from "./library";

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

const SNIPPET_RADIUS = 60;
const MAX_RESULTS = 50;

/** Lower case and without accents, so "senorio" finds "Señorío". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function snippetFor(text: string, terms: string[]): string {
  // Accents can change a string's length, so match on a character-by-character fold.
  const chars = Array.from(text);
  const folded = chars.map((c) => fold(c)[0] ?? " ").join("");
  let at = -1;
  for (const term of terms) {
    const found = folded.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return chars.slice(0, SNIPPET_RADIUS * 2).join("").replace(/\s+/g, " ").trim();
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(chars.length, at + SNIPPET_RADIUS);
  const body = chars.slice(start, end).join("").replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < chars.length ? "…" : ""}`;
}

export class NoteSearch {
  private index = new MiniSearch<{ id: string; title: string; text: string }>({
    fields: ["title", "text"],
    processTerm: (term) => fold(term),
  });
  private notes = new Map<string, NoteRecord>();

  /** Add, change or remove notes so the index matches this list. */
  sync(notes: NoteRecord[]) {
    const next = new Map(notes.map((note) => [note.path, note]));
    for (const [path, old] of this.notes) {
      const note = next.get(path);
      if (note?.text === old.text) continue;
      this.index.discard(path);
      this.notes.delete(path);
    }
    const added = notes.filter((note) => !this.notes.has(note.path));
    this.index.addAll(
      added.map((note) => ({ id: note.path, title: noteTitle(note.path), text: note.text })),
    );
    this.notes = next;
  }

  search(query: string): SearchHit[] {
    if (!query.trim()) return [];
    const options = {
      prefix: true,
      fuzzy: (term: string) => (term.length > 3 ? 0.2 : false),
      combineWith: "AND" as const,
      boost: { title: 3 },
    };
    return this.index
      .search(query, options)
      .slice(0, MAX_RESULTS)
      .map((hit) => {
        const note = this.notes.get(hit.id as string)!;
        return {
          path: note.path,
          title: noteTitle(note.path),
          snippet: snippetFor(note.text, hit.terms),
        };
      });
  }
}
