import { moveNote } from "./move";
import { blobSha, decodeBase64 } from "./blob";
import { conflictCopyPath, deletionMessage, syncNotes, timing } from "./engine";
import { GitHubError, type FileChange, type GitHubApi, type RemoteTree, createGitHub, isNotePath } from "./github";
import { markDeleted, saveEdit, type NoteRecord, type NoteStore } from "./store";

/** An edit made from whatever is stored right now, as the editor normally does. */
async function edit(store: NoteStore, path: string, text: string) {
  await saveEdit(store, path, text, (await store.get(path))?.text ?? "");
}

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
  messages: string[] = [];
  headId = 0;
  beforeCommit: (() => void) | null = null;
  afterPush: (() => void) | null = null;
  failDownload = false;
  /** Which notes a batch brings back: none (the default), all, or every other one. */
  batch: "none" | "all" | "half" = "none";
  batchCalls = 0;
  singleCalls = 0;
  /** Trees to hand out before the real one, as GitHub lagging behind would. */
  staleTrees: RemoteTree[] = [];
  treeReads = 0;

  async set(path: string, text: string) {
    this.files.set(path, text);
    this.headId += 1;
  }
  remove(path: string) {
    this.files.delete(path);
    this.headId += 1;
  }
  async getTree(): Promise<RemoteTree> {
    this.treeReads += 1;
    const stale = this.staleTrees.shift();
    if (stale) return stale;
    const files = new Map<string, string>();
    for (const [path, text] of this.files) files.set(path, await blobSha(text));
    return { commitSha: String(this.headId), treeSha: String(this.headId), files };
  }
  async getTexts(shas: string[]) {
    this.batchCalls += 1;
    const texts = new Map<string, string>();
    if (this.batch === "none") return texts;
    const byHash = new Map<string, string>();
    for (const text of this.files.values()) byHash.set(await blobSha(text), text);
    for (const [i, sha] of shas.entries()) {
      const text = byHash.get(sha);
      if (text !== undefined && !(this.batch === "half" && i % 2 === 1)) texts.set(sha, text);
    }
    return texts;
  }
  async getText(sha: string) {
    this.singleCalls += 1;
    if (this.failDownload) throw new GitHubError("network", "offline");
    for (const text of this.files.values()) {
      if ((await blobSha(text)) === sha) return text;
    }
    throw new Error(`no blob ${sha}`);
  }
  async readFile() {
    return null;
  }
  async commit(base: RemoteTree, changes: FileChange[], message: string) {
    this.beforeCommit?.();
    this.beforeCommit = null;
    if (base.commitSha !== String(this.headId)) throw new GitHubError("stale", "moved");
    for (const change of changes) {
      if (change.text === null) this.files.delete(change.path);
      else this.files.set(change.path, change.text);
    }
    this.headId += 1;
    this.commits.push(changes);
    this.messages.push(message);
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
    expect(result).toEqual({ downloaded: 0, pushed: 0, deleted: 0, keptDeletes: [], conflicts: [] });
    expect(github.commits).toHaveLength(0);
  });

  it("pushes a phone edit and marks it clean", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await edit(store, "a.md", "one edited");
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
    await edit(store, "diary/today.md", "hello");
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
    await edit(store, "a.md", "still writing");
    await syncNotes(github, store, undefined, NOW);
    expect(github.files.get("a.md")).toBe("still writing");
    expect(store.notes.get("a.md")?.dirty).toBe(false);
  });

  it("keeps both versions when both sides changed", async () => {
    const { github, store } = await setup({ "dir/a.md": "one" });
    await github.set("dir/a.md", "from mac");
    await edit(store, "dir/a.md", "from phone");
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
    await edit(store, "today.md", "phone entry");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.conflicts).toHaveLength(1);
    expect(github.files.get("today.md")).toBe("mac entry");
    expect(github.files.get(result.conflicts[0].copy)).toBe("phone entry");
  });

  it("marks clean without a conflict when both sides made the same change", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await github.set("a.md", "same");
    await edit(store, "a.md", "same");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result).toEqual({ downloaded: 0, pushed: 0, deleted: 0, keptDeletes: [], conflicts: [] });
    expect(store.notes.get("a.md")?.dirty).toBe(false);
  });

  it("restarts when the Mac pushes during the phone's push", async () => {
    const { github, store } = await setup({ "a.md": "one", "b.md": "two" });
    await edit(store, "a.md", "phone");
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
    await edit(store, "a.md", "phone");
    github.commit = async () => {
      throw new GitHubError("stale", "moved");
    };
    await expect(syncNotes(github, store, undefined, NOW)).rejects.toMatchObject({ kind: "stale" });
    expect(store.notes.get("a.md")).toMatchObject({ text: "phone", dirty: true });
  });

  it("keeps an edit typed while its push was in flight", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await edit(store, "a.md", "first");
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
      await edit(store, "a.md", "typed meanwhile");
      return text;
    };
    await syncNotes(github, store, undefined, NOW);
    const copy = "a (phone conflict 2026-11-03 1405).md";
    expect(github.files.get("a.md")).toBe("from mac");
    expect(github.files.get(copy)).toBe("typed meanwhile");
  });

  it("keeps both when an edit was made from text that has since been replaced", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await github.set("a.md", "from the Mac");
    await syncNotes(github, store, undefined, NOW);
    // The editor hadn't picked up the Mac's change when this was typed.
    await saveEdit(store, "a.md", "one and more", "one");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(github.files.get("a.md")).toBe("from the Mac");
    expect(result.conflicts).toHaveLength(1);
    expect(github.files.get(result.conflicts[0].copy)).toBe("one and more");
    expect(store.notes.get("a.md")).toMatchObject({ text: "from the Mac", dirty: false });
  });

  it("recovers when a push worked but the reply was lost", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await edit(store, "a.md", "phone");
    await github.set("a.md", "phone");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.pushed).toBe(0);
    expect(github.commits).toHaveLength(0);
    expect(store.notes.get("a.md")?.dirty).toBe(false);
  });

  it("keeps edits and earlier downloads when the network drops", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    await edit(store, "a.md", "phone");
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
    await edit(store, "a.md", "x");
    await edit(store, "b.md", "y");
    await syncNotes(github, store, undefined, NOW);
    expect(github.commits).toHaveLength(1);
    expect(github.commits[0]).toHaveLength(2);
  });
});

describe("a second look before keeping both", () => {
  timing.confirmConflictMs = 0;

  it("makes no conflict copy when GitHub briefly reports an older version", async () => {
    const { github, store } = await setup({ "post.md": "draft one" });
    const before = await github.getTree();
    await edit(store, "post.md", "draft two");
    await syncNotes(github, store, undefined, NOW);
    await edit(store, "post.md", "draft three");
    // The next read shows the tree from before "draft two" was pushed.
    github.staleTrees = [before];
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.conflicts).toEqual([]);
    expect([...github.files.keys()]).toEqual(["post.md"]);
    expect(github.files.get("post.md")).toBe("draft three");
  });

  it("still keeps both when the conflict is real", async () => {
    const { github, store } = await setup({ "post.md": "draft one" });
    await edit(store, "post.md", "phone");
    await github.set("post.md", "mac");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.conflicts).toHaveLength(1);
    // Looked twice before deciding.
    expect(github.treeReads).toBeGreaterThanOrEqual(3);
  });

  it("doesn't bring a deleted note back over a passing glitch", async () => {
    const { github, store } = await setup({ "a.md": "one" });
    const before = await github.getTree();
    await edit(store, "a.md", "two");
    await syncNotes(github, store, undefined, NOW);
    await markDeleted(store, "a.md");
    github.staleTrees = [before];
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.keptDeletes).toEqual([]);
    expect(github.files.has("a.md")).toBe(false);
  });
});

describe("deleting", () => {
  it("removes a deleted note from GitHub in a commit of its own", async () => {
    const { github, store } = await setup({ "recipes/a.md": "A", "recipes/b.md": "B", "inbox/c.md": "C" });
    await markDeleted(store, "recipes/a.md");
    await markDeleted(store, "recipes/b.md");
    await edit(store, "inbox/c.md", "C edited");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.deleted).toBe(2);
    expect([...github.files.keys()]).toEqual(["inbox/c.md"]);
    expect(github.files.get("inbox/c.md")).toBe("C edited");
    // The deletion and the edit are separate commits, so either can be reverted alone.
    expect(github.commits).toHaveLength(2);
    expect(github.commits[0].every((change) => change.text === null)).toBe(true);
    expect(github.messages[0]).toMatch(/^phone: delete 2 notes in recipes\n/);
    expect(store.notes.has("recipes/a.md")).toBe(false);
    expect(store.notes.get("inbox/c.md")?.dirty).toBe(false);
  });

  it("brings a note back if it changed elsewhere after being deleted here", async () => {
    const { github, store } = await setup({ "a.md": "old" });
    await markDeleted(store, "a.md");
    await github.set("a.md", "changed on the Mac");
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.keptDeletes).toEqual(["a.md"]);
    expect(github.files.get("a.md")).toBe("changed on the Mac");
    expect(store.notes.get("a.md")).toMatchObject({ text: "changed on the Mac", dirty: false });
    expect(store.notes.get("a.md")?.deleted).toBeFalsy();
    expect(github.commits).toHaveLength(0);
  });

  it("forgets a deletion when the note is already gone from GitHub", async () => {
    const { github, store } = await setup({ "a.md": "A" });
    await markDeleted(store, "a.md");
    github.remove("a.md");
    await syncNotes(github, store, undefined, NOW);
    expect(store.notes.has("a.md")).toBe(false);
    expect(github.commits).toHaveLength(0);
  });

  it("never pushes a new note that was deleted before it synced", async () => {
    const { github, store } = await setup({});
    await edit(store, "inbox/draft.md", "half a thought");
    await markDeleted(store, "inbox/draft.md");
    await syncNotes(github, store, undefined, NOW);
    expect(store.notes.has("inbox/draft.md")).toBe(false);
    expect(github.commits).toHaveLength(0);
  });

  it("keeps a deletion waiting while offline, then pushes it", async () => {
    const { github, store } = await setup({ "a.md": "A" });
    await markDeleted(store, "a.md");
    expect(store.notes.get("a.md")).toMatchObject({ deleted: true, dirty: true });
    await syncNotes(github, store, undefined, NOW);
    expect(github.files.has("a.md")).toBe(false);
  });

  it("names the folder and lists every file in the commit message", () => {
    expect(deletionMessage(["recipes/b.md", "recipes/a.md"])).toBe(
      "phone: delete 2 notes in recipes\n\n- recipes/a.md\n- recipes/b.md\n\nUndo with git revert on this commit.",
    );
    expect(deletionMessage(["a/x.md", "b/y.md"]).split("\n")[0]).toBe("phone: delete 2 notes");
    expect(deletionMessage(["diary/daily/2026/x.md"]).split("\n")[0]).toBe("phone: delete 1 note in diary/daily/2026");
  });
});

describe("batched downloads", () => {
  async function remote(count: number, batch: FakeGitHub["batch"]) {
    const github = new FakeGitHub();
    github.batch = batch;
    for (let i = 0; i < count; i += 1) await github.set(`n${i}.md`, `note ${i}`);
    return github;
  }

  it("fetches in batches of 100 instead of one note at a time", async () => {
    const github = await remote(250, "all");
    const store = new MemoryStore();
    const progress: number[] = [];
    const result = await syncNotes(github, store, (done) => progress.push(done), NOW);
    expect(result.downloaded).toBe(250);
    expect(github.batchCalls).toBe(3);
    expect(github.singleCalls).toBe(0);
    expect(store.notes.get("n249.md")?.text).toBe("note 249");
    expect(progress[progress.length - 1]).toBe(250);
  });

  it("fetches whatever a batch leaves out one at a time", async () => {
    const github = await remote(10, "half");
    const store = new MemoryStore();
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.downloaded).toBe(10);
    expect(github.singleCalls).toBe(5);
  });

  it("still downloads everything when batches are refused", async () => {
    const github = await remote(10, "none");
    const store = new MemoryStore();
    const result = await syncNotes(github, store, undefined, NOW);
    expect(result.downloaded).toBe(10);
    expect(github.singleCalls).toBe(10);
  });
});

describe("getTexts", () => {
  const config = { owner: "me", repo: "notes", branch: "main", root: "vault", token: "t" };
  const reply = (body: unknown, status = 200) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("keeps only text that hashes back to its SHA", async () => {
    const good = await blobSha("right");
    const bad = await blobSha("expected");
    const github = createGitHub(
      config,
      reply({
        data: {
          repository: {
            b0: { text: "right", isBinary: false, isTruncated: false },
            b1: { text: "re-encoded", isBinary: false, isTruncated: false },
          },
        },
      }),
    );
    const texts = await github.getTexts([good, bad]);
    expect([...texts]).toEqual([[good, "right"]]);
  });

  it("leaves out truncated, binary and missing blobs", async () => {
    const shas = await Promise.all(["a", "b", "c"].map(blobSha));
    const github = createGitHub(
      config,
      reply({
        data: {
          repository: {
            b0: { text: "a", isBinary: false, isTruncated: true },
            b1: { text: null, isBinary: true, isTruncated: false },
            b2: null,
          },
        },
      }),
    );
    expect((await github.getTexts(shas)).size).toBe(0);
  });

  it("returns nothing rather than failing when the batch is refused", async () => {
    const sha = await blobSha("a");
    expect((await createGitHub(config, reply({ message: "no" }, 403)).getTexts([sha])).size).toBe(0);
    const offline = async () => {
      throw new TypeError("offline");
    };
    expect((await createGitHub(config, offline).getTexts([sha])).size).toBe(0);
  });

  it("never puts anything but a SHA into the query", async () => {
    let body = "";
    const capture = async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body);
      return new Response("{}", { status: 200 });
    };
    await createGitHub(config, capture).getTexts(['x") { evil }', await blobSha("a")]);
    expect(body).not.toContain("evil");
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


describe("moveNote", () => {
  it("syncs unsaved writing, then changes both paths in a separate commit", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    await edit(store, "ideas/a.md", "finished writing");
    await moveNote(github, store, "ideas/a.md", "completed/a.md", "finished writing");
    expect(github.files.has("ideas/a.md")).toBe(false);
    expect(github.files.get("completed/a.md")).toBe("finished writing");
    expect(github.commits[github.commits.length - 1]).toEqual([
      { path: "ideas/a.md", text: null }, { path: "completed/a.md", text: "finished writing" },
    ]);
    expect(github.messages[github.messages.length - 1]).toMatch(/^phone: move ideas\/a.md to completed\/a.md/);
    expect(await store.get("ideas/a.md")).toBeUndefined();
    expect(await store.get("completed/a.md")).toMatchObject({ text: "finished writing", dirty: false });
  });

  it("doesn't overwrite a destination created remotely", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    await github.set("completed/a.md", "existing");
    await expect(moveNote(github, store, "ideas/a.md", "completed/a.md", "draft")).rejects.toThrow("already exists");
    expect(github.files.get("ideas/a.md")).toBe("draft");
    expect(github.files.get("completed/a.md")).toBe("existing");
  });

  it("stops if sync discovers a newer source", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    await github.set("ideas/a.md", "newer");
    await expect(moveNote(github, store, "ideas/a.md", "completed/a.md", "draft")).rejects.toThrow("changed");
    expect(github.files.get("ideas/a.md")).toBe("newer");
    expect(github.files.has("completed/a.md")).toBe(false);
  });

  it("refuses the whole move if the branch changes during the commit", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    github.beforeCommit = () => { void github.set("completed/a.md", "arrived during move"); };
    await expect(moveNote(github, store, "ideas/a.md", "completed/a.md", "draft")).rejects.toThrow("moved");
    expect(github.files.get("ideas/a.md")).toBe("draft");
    expect(github.files.get("completed/a.md")).toBe("arrived during move");
    expect((await store.get("ideas/a.md"))?.dirty).toBe(false);
  });

  it("recovers after the commit when local storage couldn't record the move", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    const update = store.update.bind(store);
    github.afterPush = () => { store.update = async () => { throw new Error("storage unavailable"); }; };
    await moveNote(github, store, "ideas/a.md", "completed/a.md", "draft");
    store.update = update;
    await syncNotes(github, store);
    expect(await store.get("ideas/a.md")).toBeUndefined();
    expect(await store.get("completed/a.md")).toMatchObject({ text: "draft", dirty: false });
    expect(github.files.has("ideas/a.md")).toBe(false);
    expect(github.files.size).toBe(1);
  });

  it("recovers when GitHub commits but the response is lost", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    github.afterPush = () => { throw new GitHubError("network", "reply lost"); };
    await moveNote(github, store, "ideas/a.md", "completed/a.md", "draft");
    expect(await store.get("ideas/a.md")).toBeUndefined();
    expect(await store.get("completed/a.md")).toMatchObject({ text: "draft", dirty: false });
    expect(github.files.size).toBe(1);
  });

  it("doesn't claim a move succeeded when the request never reached GitHub", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    github.commit = async () => { throw new GitHubError("network", "request lost"); };
    await expect(moveNote(github, store, "ideas/a.md", "completed/a.md", "draft")).rejects.toThrow("Couldn't confirm");
    expect(github.files.get("ideas/a.md")).toBe("draft");
    expect(await store.get("completed/a.md")).toBeUndefined();
  });

  it("doesn't mistake a destination with different writing for a successful move", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    github.afterPush = () => {
      void github.set("completed/a.md", "different writing");
      throw new GitHubError("network", "reply lost");
    };
    await expect(moveNote(github, store, "ideas/a.md", "completed/a.md", "draft")).rejects.toThrow("Couldn't confirm");
    expect(github.files.get("completed/a.md")).toBe("different writing");
    expect(await store.get("completed/a.md")).toBeUndefined();
  });

  it("leaves the source intact when offline", async () => {
    const { github, store } = await setup({ "ideas/a.md": "draft" });
    github.getTree = async () => { throw new GitHubError("network", "offline"); };
    await expect(moveNote(github, store, "ideas/a.md", "completed/a.md", "draft")).rejects.toThrow("offline");
    expect(github.files.get("ideas/a.md")).toBe("draft");
    expect((await store.get("ideas/a.md"))?.deleted).toBeFalsy();
  });
});
