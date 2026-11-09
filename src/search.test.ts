import { NoteSearch } from "./search";
import type { NoteRecord } from "./sync/store";

const note = (path: string, text: string): NoteRecord => ({
  path,
  text,
  baseSha: null,
  dirty: false,
  rev: 0,
  updatedAt: 0,
});

const paths = (search: NoteSearch, query: string) => search.search(query).map((hit) => hit.path);

describe("NoteSearch", () => {
  const search = () => {
    const index = new NoteSearch();
    index.sync([note("a.md", "A grey heron by the river"), note("wine/rioja.md", "Señorío de Sarría")]);
    return index;
  };

  it("finds words, prefixes and titles", () => {
    expect(paths(search(), "heron")).toEqual(["a.md"]);
    expect(paths(search(), "riv")).toEqual(["a.md"]);
    expect(paths(search(), "rioja")).toEqual(["wine/rioja.md"]);
  });

  it("ignores accents in both directions", () => {
    expect(paths(search(), "senorio")).toEqual(["wine/rioja.md"]);
    expect(paths(search(), "héron")).toEqual(["a.md"]);
  });

  it("tolerates a typo", () => {
    expect(paths(search(), "heronn")).toEqual(["a.md"]);
  });

  it("needs every word to match", () => {
    expect(paths(search(), "heron river")).toEqual(["a.md"]);
    expect(paths(search(), "heron sarria")).toEqual([]);
  });

  it("shows the matching part of the note, even after accented text", () => {
    const index = new NoteSearch();
    index.sync([note("a.md", `${"é".repeat(200)} heron ${"é".repeat(200)}`)]);
    expect(index.search("heron")[0].snippet).toContain("heron");
  });

  it("follows edits and deletions", () => {
    const index = search();
    index.sync([note("a.md", "A grey crane"), note("wine/rioja.md", "Señorío de Sarría")]);
    expect(paths(index, "heron")).toEqual([]);
    expect(paths(index, "crane")).toEqual(["a.md"]);
    index.sync([note("a.md", "A grey crane")]);
    expect(paths(index, "senorio")).toEqual([]);
  });

  it("returns nothing for an empty search", () => {
    expect(search().search("   ")).toEqual([]);
  });
});
