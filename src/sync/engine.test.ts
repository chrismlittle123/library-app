import { blobSha, decodeBase64 } from "./blob";
import { conflictCopyPath, syncNotes } from "./engine";
import { GitHubError, type FileChange, type GitHubApi, type RemoteTree, isNotePath } from "./github";
import { saveEdit, type NoteRecord, type NoteStore } from "./store";

class MemoryStore implements NoteStore {
  notes = new Map<string, NoteRecord>();
  async all() {
    return [...this.notes.values()];
  }
  async get(path: string) {
    return this.notes.get(path);
  }
  async update(
    path: string,
    change: (current: NoteRecord | undefined) => NoteRecord | null | undefined,
  ) {
    const next = change(this.notes.get(path));
    if (next === null) this.notes.delete(path);
    else if (next) this.notes.set(path, next);
  }
  async erase() {
    this.notes.clear();
  }
}

class FakeGitHub implements GitHubApi {
  files = new Map<string, string>();
  commits: FileChange[][] = [];
  headId = 0;
  beforeCommit: (() => void) | null = null;
  afterPush: (() => void) | null = null;
  failDownload = false;

  async set(path: string, text: string) {
    this.files.set(path, text);
    this.headId += 1;
  }
  remove(path: string) {
    this.files.delete(path);
    this.headId += 1;
  }
  async getTree(): Promise<RemoteTree> {
    const files = new Map<string, string>();
    for (const [path, text] of this.files) files.set(path, await blobSha(text));
    return { commitSha: String(this.headId), treeSha: String(this.headId), files };
  }
  async getText(sha: string) {
    if (this.failDownload) throw new GitHubError("network", "offline");
    for (const text of this.files.values()) {
      if ((await blobSha(text)) === sha) return text;
    }
    throw new Error(`no blob ${sha}`);
  }
  async commit(base: RemoteTree, changes: FileChange[]) {
    this.beforeCommit?.();
    this.beforeCommit = null;
    if (base.commitSha !== String(this.headId)) throw new GitHubError("stale", "moved");
    for (const change of changes) this.files.set(change.path, change.text);
    this.headId += 1;
    this.commits.push(changes);
    this.afterPush?.();
    this.afterPush = null;
  }
}

const NOW = () => new Date(2026, 10, 3, 14, 5);

async function setup(files: Record<string, string> = {}) {
  const github = new FakeGitHub();
  const store = new MemoryStore();
  for (const [path, text] of Object.entries(files)) await github.set(path, text);
  await syncNotes(github, store, undefined, NOW);
  return { github, store };
}

describe("syncNotes", () => {
  it("downloads everything on first sync and reports progress", async () => {
    const github = new FakeGitHub();
    const store = new MemoryStore();
    await github.set("a.md", "one");
    await github.set("dir/b.md", "two");
    const progress: number[] = [];
    const result = await syncNotes(github, store, (done) => progress.push(done), NOW);
    expect(result.downloaded).toBe(2);
    expect(store.notes.get("dir/b.md")).toMatchObject({ text: "two", dirty: false });
    expect(progress).toEqual([0, 1, 2]);
  });

  it("does nothing when already in step", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result).toEqual({ downloaded: 0, pushed: 0, conflicts: [] });
    expect(github.commits).toHaveLength(0);
  });

  it("pushes a phone edit and marks it clean", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await saveEdit(store, "a.md", "one edited");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.pushed).toBe(1);
    expect(github.files.get("a.md")).toBe("one edited");
    expect(store.notes.get("a.md")).toMatchObject({
      dirty: false,
      baseSha: await blobSha("one edited"),
    });
  });

  it("pushes a new note made on the phone", async () => {
    const { github, store } = await setup();
    await saveEdit(store, "diary/today.md", "hello");
    await syncNotes(github, store, undefined, NOW);
    expect(github.files.get("diary/today.md")).toBe("hello");
  });

  it("downloads a change made on the Mac", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await github.set("a.md", "from mac");
    await syncNotes(github, store, undefined, NOW);
    expect(store.notes.get("a.md")).toMatchObject({ text: "from mac", dirty: false });
  });

  it("removes a clean note deleted on the Mac", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    github.remove("a.md");
    await syncNotes(github, store, undefined, NOW);
    expect(store.notes.has("a.md")).toBe(false);
  });

  it("puts back a note edited on the phone but deleted on the Mac", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    github.remove("a.md");
    await saveEdit(store, "a.md", "still writing");
    await syncNotes(github, store, undefined, NOW);
    expect(github.files.get("a.md")).toBe("still writing");
    expect(store.notes.get("a.md")?.dirty).toBe(false);
  });

  it("keeps both versions when both sides changed", async () => {
    const { github, store } = await setup({ "dir/a.md": "one" });
    await github.set("dir/a.md", "from mac");
    await saveEdit(store, "dir/a.md", "from phone");
    const result = await syncNotes(github, store, undefined, NOW);
    const copy = "dir/a (phone conflict 2026-11-03 1405).md";
    expect(result.conflicts).toEqual([{ path: "dir/a.md", copy }]);
    expect(github.files.get("dir/a.md")).toBe("from mac");
    expect(github.files.get(copy)).toBe("from phone");
    expect(store.notes.get("dir/a.md")).toMatchObject({ text: "from mac", dirty: false });
    expect(store.notes.get(copy)).toMatchObject({ text: "from phone", dirty: false });
  });

  it("keeps both when the same new note appears on both sides", async () => {
    const { github, store } = await setup();
    await github.set("today.md", "mac entry");
    await saveEdit(store, "today.md", "phone entry");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.conflicts).toHaveLength(1);
    expect(github.files.get("today.md")).toBe("mac entry");
    expect(github.files.get(result.conflicts[0].copy)).toBe("phone entry");
  });

  it("marks clean without a conflict when both sides made the same change", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await github.set("a.md", "same");
    await saveEdit(store, "a.md", "same");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result).toEqual({ downloaded: 0, pushed: 0, conflicts: [] });
    expect(store.notes.get("a.md")?.dirty).toBe(false);
  });

  it("restarts when the Mac pushes during the phone's push", async () => {
    const { github, store } = await setup({ "a.md": "one", "b.md": "two" });
    await saveEdit(store, "a.md", "phone");
    github.beforeCommit = () => {
      github.files.set("b.md", "mac");
      github.headId += 1;
    };
    await syncNotes(github, store, undefined, NOW);
    expect(github.files.get("a.md")).toBe("phone");
    expect(github.files.get("b.md")).toBe("mac");
    expect(store.notes.get("b.md")?.text).toBe("mac");
  });

  it("gives up with an error, keeping edits, if the branch never settles", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await saveEdit(store, "a.md", "phone");
    github.commit = async () => {
      throw new GitHubError("stale", "moved");
    };
    await expect(syncNotes(github, store, undefined, NOW)).rejects.toMatchObject({ kind: "stale" });
    expect(store.notes.get("a.md")).toMatchObject({ text: "phone", dirty: true });
  });

  it("keeps an edit typed while its push was in flight", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await saveEdit(store, "a.md", "first");
    github.afterPush = () => {
      const current = store.notes.get("a.md")!;
      store.notes.set("a.md", { ...current, text: "first and more", rev: current.rev + 1 });
    };
    await syncNotes(github, store, undefined, NOW);
    expect(github.files.get("a.md")).toBe("first");
    expect(store.notes.get("a.md")).toMatchObject({ text: "first and more", dirty: true });
    await syncNotes(github, store, undefined, NOW);
    expect(github.files.get("a.md")).toBe("first and more");
    expect(store.notes.get("a.md")?.dirty).toBe(false);
    expect(store.notes.has("a (phone conflict 2026-11-03 1405).md")).toBe(false);
  });

  it("doesn't overwrite an edit typed while its download was in flight", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await github.set("a.md", "from mac");
    const getText = github.getText.bind(github);
    github.getText = async (sha) => {
      const text = await getText(sha);
      github.getText = getText;
      await saveEdit(store, "a.md", "typed meanwhile");
      return text;
    };
    await syncNotes(github, store, undefined, NOW);
    const copy = "a (phone conflict 2026-11-03 1405).md";
    expect(github.files.get("a.md")).toBe("from mac");
    expect(github.files.get(copy)).toBe("typed meanwhile");
  });

  it("recovers when a push worked but the reply was lost", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await saveEdit(store, "a.md", "phone");
    await github.set("a.md", "phone");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.pushed).toBe(0);
    expect(github.commits).toHaveLength(0);
    expect(store.notes.get("a.md")?.dirty).toBe(false);
  });

  it("keeps edits and earlier downloads when the network drops", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await saveEdit(store, "a.md", "phone");
    await github.set("b.md", "new on mac");
    github.failDownload = true;
    await expect(syncNotes(github, store, undefined, NOW)).rejects.toMatchObject({ kind: "network" });
    expect(store.notes.get("a.md")).toMatchObject({ text: "phone", dirty: true });
    github.failDownload = false;
    await syncNotes(github, store, undefined, NOW);
    expect(github.files.get("a.md")).toBe("phone");
    expect(store.notes.get("b.md")?.text).toBe("new on mac");
  });

  it("makes one commit for several edits", async () => {
    const { github, store } = await setup({ "a.md": "one", "b.md": "two" });
    await saveEdit(store, "a.md", "x");
    await saveEdit(store, "b.md", "y");
    await syncNotes(github, store, undefined, NOW);
    expect(github.commits).toHaveLength(1);
    expect(github.commits[0]).toHaveLength(2);
  });
});

describe("conflictCopyPath", () => {
  it("picks a free name", () => {
    const taken = new Set(["a (phone conflict 2026-11-03 1405).md"]);
    expect(conflictCopyPath("a.md", NOW(), (path) => taken.has(path))).toBe(
      "a (phone conflict 2026-11-03 1405 2).md",
    );
  });
});

describe("blob helpers", () => {
  it("matches git's own hash", async () => {
    // printf 'hello\n' | git hash-object --stdin
    expect(await blobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("decodes UTF-8 and refuses other bytes", () => {
    expect(decodeBase64(btoa(String.fromCharCode(0xc3, 0xb1)))).toBe("ñ");
    expect(decodeBase64(btoa(String.fromCharCode(0xff, 0xfe)))).toBeNull();
  });
});

describe("isNotePath", () => {
  it("only accepts markdown outside hidden folders", () => {
    expect(isNotePath("diary/a.md")).toBe(true);
    expect(isNotePath(".obsidian/a.md")).toBe(false);
    expect(isNotePath("catalogues/.index/a.md")).toBe(false);
    expect(isNotePath("wines.json")).toBe(false);
  });
});
