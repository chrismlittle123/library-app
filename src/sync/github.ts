import { decodeBase64 } from "./blob";

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
  text: string;
}

export interface GitHubApi {
  getTree(): Promise<RemoteTree>;
  /** Null when the file isn't valid UTF-8. */
  getText(sha: string): Promise<string | null>;
  commit(base: RemoteTree, changes: FileChange[], message: string): Promise<void>;
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

export function createGitHub(config: RepoConfig, fetchFn: typeof fetch = fetch.bind(globalThis)): GitHubApi {
  const prefix = config.root ? `${config.root}/` : "";
  const repoUrl = `${API}/repos/${config.owner}/${config.repo}`;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetchFn(`${repoUrl}${path}`, {
        ...init,
        // A cached ref would make the phone think it was up to date when it wasn't.
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new GitHubError("network", "Couldn't reach GitHub.");
    }
    if (response.ok) return (await response.json()) as T;
    throw errorFor(response);
  }

  return {
    async getTree() {
      const ref = await request<{ object: { sha: string } }>(
        `/git/ref/heads/${encodeURIComponent(config.branch)}`,
      );
      const commit = await request<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`);
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
      return { commitSha: ref.object.sha, treeSha: commit.tree.sha, files };
    },

    async getText(sha) {
      const blob = await request<{ content: string }>(`/git/blobs/${sha}`);
      return decodeBase64(blob.content);
    },

    async commit(base, changes, message) {
      const tree = await request<{ sha: string }>("/git/trees", {
        method: "POST",
        body: JSON.stringify({
          base_tree: base.treeSha,
          tree: changes.map((change) => ({
            path: prefix + change.path,
            mode: "100644",
            type: "blob",
            content: change.text,
          })),
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
