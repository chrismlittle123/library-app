import { blobSha, decodeBase64 } from "./blob";

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Folder in the repo that holds the notes, such as "vault". Empty for the root. */
  root: string;
  token: string;
}

export interface RemoteTree {
  commitSha: string;
  treeSha: string;
  /** Note path (relative to the root) to blob SHA. */
  files: Map<string, string>;
}

export interface FileChange {
  path: string;
  /** Null deletes the file. */
  text: string | null;
}

export interface GitHubApi {
  getTree(): Promise<RemoteTree>;
  /** Null when the file isn't valid UTF-8. */
  getText(sha: string): Promise<string | null>;
  /**
   * Many notes in one request. Only texts that hash back to their SHA are
   * returned, so anything missing is fetched one at a time with getText.
   */
  getTexts(shas: string[]): Promise<Map<string, string>>;
  commit(base: RemoteTree, changes: FileChange[], message: string): Promise<void>;
  /** One file by its path relative to the root, whatever its type. Null when it isn't valid UTF-8. */
  readFile(path: string): Promise<string | null>;
}

export type GitHubErrorKind = "auth" | "not-found" | "rate-limit" | "stale" | "network" | "other";

export class GitHubError extends Error {
  constructor(
    public kind: GitHubErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export function isNotePath(path: string): boolean {
  return path.endsWith(".md") && !path.split("/").some((part) => part.startsWith("."));
}

const API = "https://api.github.com";
// Right after a push, GitHub can briefly answer a ref read with the commit before
// it. Taken at face value, that looks like someone else changed every note just
// pushed, and makes conflict copies of them. So each branch remembers the last
// commit this app pushed, and a read that's behind it is asked again. It's kept
// in storage, because iOS often relaunches the app between a push and the next read.
const headKey = (branchKey: string) => `vault:head:${branchKey}`;
function lastHead(branchKey: string): string | undefined {
  try {
    const sha = localStorage.getItem(headKey(branchKey));
    return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}
function rememberHead(branchKey: string, sha: string) {
  try {
    localStorage.setItem(headKey(branchKey), sha);
  } catch {
    // Without storage this protects only until the app closes.
  }
}
const STALE_RETRIES = 5;
const STALE_WAIT_MS = 1000;

/** How many notes one batch asks for. GraphQL charges a batch as one request. */
export const BATCH_SIZE = 100;
// iOS can leave a request hanging after the app is suspended, which would block every later sync.
const REQUEST_TIMEOUT_MS = 30_000;

export function createGitHub(config: RepoConfig, fetchFn: typeof fetch = fetch.bind(globalThis)): GitHubApi {
  const prefix = config.root ? `${config.root}/` : "";
  const repoUrl = `${API}/repos/${config.owner}/${config.repo}`;
  const branchKey = `${config.owner}/${config.repo}/${config.branch}`;

  /** The branch head, never older than the last commit this app pushed to it. */
  async function readHead(): Promise<string> {
    const read = () =>
      request<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(config.branch)}`).then((ref) => ref.object.sha);
    let head = await read();
    const pushed = lastHead(branchKey);
    for (let attempt = 0; pushed && head !== pushed && attempt < STALE_RETRIES; attempt += 1) {
      const comparison = await request<{ status: string }>(`/compare/${pushed}...${head}`).catch(
        // Gone, as after a force push: there's nothing to be behind.
        (error: unknown) => (error instanceof GitHubError && error.kind === "not-found" ? null : Promise.reject(error)),
      );
      if (comparison?.status !== "behind") break;
      await new Promise((resolve) => setTimeout(resolve, STALE_WAIT_MS));
      head = await read();
    }
    // Still behind after that is a real rewind, not lag, so it's believed.
    // Caught up, or moved on past it: either way it's the head from now on.
    rememberHead(branchKey, head);
    return head;
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`${repoUrl}${path}`, {
        ...init,
        // A cached ref would make the phone think it was up to date when it wasn't.
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (response.ok) return (await response.json()) as T;
    } catch {
      throw new GitHubError("network", "Couldn't reach GitHub.");
    }
    throw errorFor(response);
  }

  return {
    async getTree() {
      const head = await readHead();
      const commit = await request<{ tree: { sha: string } }>(`/git/commits/${head}`);
      const tree = await request<{
        truncated: boolean;
        tree: { path: string; type: string; sha: string }[];
      }>(`/git/trees/${commit.tree.sha}?recursive=1`);
      // A partial list would look like remote deletions, so refuse it outright.
      if (tree.truncated) throw new GitHubError("other", "This repo is too large to list.");
      const files = new Map<string, string>();
      for (const item of tree.tree) {
        if (item.type !== "blob" || !item.path.startsWith(prefix)) continue;
        const path = item.path.slice(prefix.length);
        if (isNotePath(path)) files.set(path, item.sha);
      }
      return { commitSha: head, treeSha: commit.tree.sha, files };
    },

    async getText(sha) {
      const blob = await request<{ content: string }>(`/git/blobs/${sha}`);
      return decodeBase64(blob.content);
    },

    async getTexts(shas) {
      const texts = new Map<string, string>();
      const wanted = shas.filter((sha) => /^[0-9a-f]{40}$/.test(sha));
      if (wanted.length === 0) return texts;
      const fields = wanted
        .map((sha, i) => `b${i}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated } }`)
        .join(" ");
      let data: Record<string, { text: string | null; isBinary: boolean; isTruncated: boolean } | null> | undefined;
      try {
        const response = await fetchFn(`${API}/graphql`, {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
            variables: { owner: config.owner, name: config.repo },
          }),
        });
        // Refused or failed: the one-at-a-time path gets the notes and reports any real error.
        if (!response.ok) return texts;
        data = ((await response.json()) as { data?: { repository?: typeof data } }).data?.repository ?? undefined;
      } catch {
        return texts;
      }
      if (!data) return texts;
      await Promise.all(
        wanted.map(async (sha, i) => {
          const blob = data[`b${i}`];
          if (!blob || blob.isBinary || blob.isTruncated || blob.text === null) return;
          // Proof the text is exactly what's in git, not a re-encoded copy.
          if ((await blobSha(blob.text)) === sha) texts.set(sha, blob.text);
        }),
      );
      return texts;
    },

    async readFile(path) {
      const encoded = `${prefix}${path}`.split("/").map(encodeURIComponent).join("/");
      const file = await request<{ content: string }>(`/contents/${encoded}?ref=${encodeURIComponent(config.branch)}`);
      return decodeBase64(file.content);
    },

    async commit(base, changes, message) {
      const tree = await request<{ sha: string }>("/git/trees", {
        method: "POST",
        body: JSON.stringify({
          base_tree: base.treeSha,
          tree: changes.map((change) =>
            change.text === null
              ? // A null SHA is how the trees API removes a path.
                { path: prefix + change.path, mode: "100644", type: "blob", sha: null }
              : { path: prefix + change.path, mode: "100644", type: "blob", content: change.text },
          ),
        }),
      });
      const commit = await request<{ sha: string }>("/git/commits", {
        method: "POST",
        body: JSON.stringify({ message, tree: tree.sha, parents: [base.commitSha] }),
      });
      await request(`/git/refs/heads/${encodeURIComponent(config.branch)}`, {
        method: "PATCH",
        // Never forced: if the Mac pushed first, this fails and sync starts again.
        body: JSON.stringify({ sha: commit.sha, force: false }),
      }).catch((error: unknown) => {
        if (error instanceof GitHubError && error.kind === "other" && error.message.includes("422")) {
          throw new GitHubError("stale", "The branch moved during the push.");
        }
        throw error;
      });
      rememberHead(branchKey, commit.sha);
    },
  };
}

function errorFor(response: Response): GitHubError {
  const { status } = response;
  if (status === 401) return new GitHubError("auth", "GitHub rejected the key.");
  if (status === 403 || status === 429) {
    return response.headers.get("x-ratelimit-remaining") === "0" || status === 429
      ? new GitHubError("rate-limit", "GitHub's rate limit was reached. Try again later.")
      : new GitHubError("auth", "The key doesn't have permission for this repo.");
  }
  if (status === 404) return new GitHubError("not-found", "Repo or branch not found. Check the key can see it.");
  return new GitHubError("other", `GitHub returned ${status}.`);
}
