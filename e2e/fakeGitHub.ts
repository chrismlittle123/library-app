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
    const held = this.holds.findIndex((item) => item.match.test(label));
    if (held !== -1) {
      const [{ hold }] = this.holds.splice(held, 1);
      await hold();
    }
    const reply = (status: number, body: unknown) =>
      route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});

    if ((await request.headerValue("authorization")) !== `Bearer ${this.token}`) return reply(401, {});
    if (method === "GET" && path === "") return reply(200, { default_branch: "main", permissions: { push: true } });
    if (method === "GET" && path === "/git/ref/heads/main") return reply(200, { object: { sha: this.head } });

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

    match = /^\/contents\/(.+)$/.exec(path);
    if (method === "GET" && match) {
      const text = this.commits.get(this.head)!.get(decodeURIComponent(match[1]));
      if (text === undefined) return reply(404, {});
      return reply(200, { content: Buffer.from(text).toString("base64") });
    }

    const body = request.postDataJSON() as Record<string, never>;
    if (method === "POST" && path === "/git/trees") {
      const files: Files = new Map(this.trees.get(body.base_tree));
      for (const item of body.tree as { path: string; content: string }[]) files.set(item.path, item.content);
      return reply(201, { sha: this.storeTree(files) });
    }
    if (method === "POST" && path === "/git/commits") {
      const id = sha(`${body.tree}:${body.parents}:${Math.random()}`);
      this.commits.set(id, this.trees.get(body.tree)!);
      this.parents.set(id, (body.parents as string[])[0]);
      return reply(201, { sha: id });
    }
    if (method === "PATCH" && path === "/git/refs/heads/main") {
      if (this.parents.get(body.sha) !== this.head) return reply(422, { message: "Update is not a fast forward" });
      this.head = body.sha;
      return reply(200, {});
    }
    return reply(500, { message: `not faked: ${label}` });
  }

  private parents = new Map<string, string>();
}
