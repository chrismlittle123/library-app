import { useState } from "react";
import { GitHubError, createGitHub, type RepoConfig } from "./sync/github";

const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

export function Setup({ onConnected }: { onConnected: (config: RepoConfig) => void }) {
  const [repoName, setRepoName] = useState("");
  const [folder, setFolder] = useState("vault");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const match = /^([\w.-]+)\/([\w.-]+)$/.exec(repoName.trim());
    if (!match) {
      setError("Enter the repo as owner/name.");
      return;
    }
    const [, owner, repo] = match;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token.trim()}`,
        },
      });
      if (response.status === 401) throw new GitHubError("auth", "GitHub rejected the key.");
      if (!response.ok) throw new GitHubError("not-found", "This key can't see that repo.");
      const details = (await response.json()) as {
        default_branch: string;
        permissions?: { push?: boolean };
      };
      if (!details.permissions?.push) {
        throw new GitHubError("auth", "This key can read the repo but not write to it.");
      }
      const config: RepoConfig = {
        owner,
        repo,
        branch: details.default_branch,
        root: folder.trim().replace(/^\/+|\/+$/g, ""),
        token: token.trim(),
      };
      const tree = await createGitHub(config).getTree();
      if (tree.files.size === 0) {
        throw new GitHubError("not-found", `No notes found in the "${config.root}" folder.`);
      }
      onConnected(config);
    } catch (failure) {
      setError(failure instanceof GitHubError ? failure.message : "Couldn't reach GitHub.");
      setBusy(false);
    }
  };

  return (
    <>
      <main className="list">
        <header className="welcome">
          <h1>Library</h1>
          <p>Your notes and flashcards, kept in GitHub.</p>
        </header>
        <form
          className="setup"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <label>
            Repo
            <input
              value={repoName}
              placeholder="owner/name"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setRepoName(event.target.value)}
            />
          </label>
          <label>
            Notes folder in the repo
            <input
              value={folder}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setFolder(event.target.value)}
            />
          </label>
          <label>
            GitHub key
            <input
              type="password"
              value={token}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <p className="hint">
            <a href={TOKEN_URL} target="_blank" rel="noreferrer">
              Create a fine-grained key
            </a>{" "}
            with access to only this repo, and Contents set to read and write. It's stored only on this
            phone.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary" disabled={busy || !repoName || !token}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </form>
      </main>
    </>
  );
}
