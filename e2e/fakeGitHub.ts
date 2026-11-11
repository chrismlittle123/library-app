import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
};

const sha = (text: string) => createHash("sha1").update(text).digest("hex");
const blobSha = (text: string) => {
  const bytes = Buffer.from(text);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
};

type Files = Map<string, string>;

/**
 * The parts of GitHub's git API the app uses, in memory, so these tests can set up
 * awkward timing exactly and spend none of the account's API allowance. A push from
 * an out-of-date commit is refused with a 422, which real GitHub was checked to do.
 */
export class FakeGitHub {
  private commits = new Map<string, Files>();
  private trees = new Map<string, Files>();
  private blobs = new Map<string, string>();
  head = "";
  /** Runs before answering a matching request. Never resolving leaves it hanging. */
  private holds: { match: RegExp; hold: () => Promise<void> }[] = [];
  token = "good-key";
  /** Answer GraphQL batches with a 403, as GitHub would for a key that can't use them. */
  refuseBatches = false;
  /** Every request answered, as "METHOD /path", to count what a sync cost. */
  requests: string[] = [];
  /** Every commit message pushed, oldest first. */
  messages: string[] = [];
  /**
   * After each push, answer this many ref reads with the commit before it, as
   * real GitHub was seen to do on 2026-11-11 a few seconds after a write.
   */
  staleReadsAfterPush = 0;
  private staleReads = 0;
  private beforePush = "";

  constructor(files: Record<string, string>) {
    this.commitFiles(new Map(Object.entries(files)));
  }

  private commitFiles(files: Files) {
    const treeSha = this.storeTree(files);
    this.head = sha(`${treeSha}:${this.head}:${Math.random()}`);
    this.commits.set(this.head, files);
    return treeSha;
  }

  private storeTree(files: Files) {
    for (const text of files.values()) this.blobs.set(blobSha(text), text);
    const treeSha = sha(JSON.stringify([...files]));
    this.trees.set(treeSha, files);
    return treeSha;
  }

  /** A change pushed from somewhere else, as the Mac would. */
  write(path: string, text: string) {
    this.commitFiles(new Map(this.commits.get(this.head)).set(`vault/${path}`, text));
  }

  read(path: string) {
    return this.commits.get(this.head)!.get(`vault/${path}`);
  }

  paths() {
    return [...this.commits.get(this.head)!.keys()];
  }

  /** Holds the next request matching `match` until `hold` resolves. */
  holdNext(match: RegExp, hold: () => Promise<void>) {
    this.holds.push({ match, hold });
  }

  async install(page: Page) {
    await page.route("https://api.github.com/**", (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const request = route.request();
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(request.url()).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
    const label = `${method} ${path}`;
    this.requests.push(label);
    const held = this.holds.findIndex((item) => item.match.test(label));
    if (held !== -1) {
      const [{ hold }] = this.holds.splice(held, 1);
      await hold();
    }
    const reply = (status: number, body: unknown) =>
      route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});

    if ((await request.headerValue("authorization")) !== `Bearer ${this.token}`) return reply(401, {});
    if (method === "GET" && path === "") return reply(200, { default_branch: "main", permissions: { push: true } });
    if (method === "GET" && path === "/git/ref/heads/main") {
      if (this.staleReads > 0) {
        this.staleReads -= 1;
        return reply(200, { object: { sha: this.beforePush } });
      }
      return reply(200, { object: { sha: this.head } });
    }
    const compare = /^\/compare\/(\w+)\.\.\.(\w+)$/.exec(path);
    if (method === "GET" && compare) {
      const [, base, head] = compare;
      const ancestors = (sha: string) => {
        const seen = new Set<string>();
        for (let at: string | undefined = sha; at; at = this.parents.get(at)) seen.add(at);
        return seen;
      };
      const status =
        base === head ? "identical" : ancestors(base).has(head) ? "behind" : ancestors(head).has(base) ? "ahead" : "diverged";
      return reply(200, { status });
    }

    let match = /^\/git\/commits\/(\w+)$/.exec(path);
    if (method === "GET" && match) return reply(200, { tree: { sha: this.storeTree(this.commits.get(match[1])!) } });
    match = /^\/git\/trees\/(\w+)$/.exec(path);
    if (method === "GET" && match) {
      const tree = [...this.trees.get(match[1])!].map(([item, text]) => ({ path: item, type: "blob", sha: blobSha(text) }));
      return reply(200, { truncated: false, tree });
    }
    match = /^\/git\/blobs\/(\w+)$/.exec(path);
    if (method === "GET" && match) {
      return reply(200, { content: Buffer.from(this.blobs.get(match[1])!).toString("base64") });
    }

    if (method === "POST" && path === "/graphql") {
      if (this.refuseBatches) return reply(403, { message: "Resource not accessible" });
      const { query } = request.postDataJSON() as { query: string };
      const repository: Record<string, unknown> = {};
      for (const [, alias, oid] of query.matchAll(/(b\d+): object\(oid: "(\w+)"\)/g)) {
        const text = this.blobs.get(oid);
        repository[alias] = text === undefined ? null : { text, isBinary: false, isTruncated: false };
      }
      return reply(200, { data: { repository } });
    }

    match = /^\/contents\/(.+)$/.exec(path);
    if (method === "GET" && match) {
      const text = this.commits.get(this.head)!.get(decodeURIComponent(match[1]));
      if (text === undefined) return reply(404, {});
      return reply(200, { content: Buffer.from(text).toString("base64") });
    }

    const body = request.postDataJSON() as Record<string, never>;
    if (method === "POST" && path === "/git/trees") {
      const files: Files = new Map(this.trees.get(body.base_tree));
      for (const item of body.tree as { path: string; content?: string; sha?: string | null }[]) {
        if (item.sha === null) files.delete(item.path);
        else files.set(item.path, item.content!);
      }
      return reply(201, { sha: this.storeTree(files) });
    }
    if (method === "POST" && path === "/git/commits") {
      const id = sha(`${body.tree}:${body.parents}:${Math.random()}`);
      this.commits.set(id, this.trees.get(body.tree)!);
      this.messages.push(body.message as string);
      this.parents.set(id, (body.parents as string[])[0]);
      return reply(201, { sha: id });
    }
    if (method === "PATCH" && path === "/git/refs/heads/main") {
      if (this.parents.get(body.sha) !== this.head) return reply(422, { message: "Update is not a fast forward" });
      this.beforePush = this.head;
      this.staleReads = this.staleReadsAfterPush;
      this.head = body.sha;
      return reply(200, {});
    }
    return reply(500, { message: `not faked: ${label}` });
  }

  private parents = new Map<string, string>();
}
