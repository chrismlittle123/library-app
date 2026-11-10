import { useState } from "react";
import { BackIcon } from "./icons";
import { GitHubError, createGitHub, type RepoConfig } from "./sync/github";

interface Props {
  config: RepoConfig;
  unsynced: number;
  onBack: () => void;
  onReplaceKey: (token: string) => void;
  onDisconnect: () => void;
}

export function Settings({ config, unsynced, onBack, onReplaceKey, onDisconnect }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const replaceKey = async () => {
    setChecking(true);
    setKeyError(null);
    try {
      await createGitHub({ ...config, token: token.trim() }).getTree();
      onReplaceKey(token.trim());
    } catch (failure) {
      setKeyError(failure instanceof GitHubError ? failure.message : "Couldn't reach GitHub.");
      setChecking(false);
    }
  };

  return (
    <>
      <header className="bar">
        <button type="button" className="tool" aria-label="Back" onClick={onBack}>
          <BackIcon />
        </button>
        <h1 className="bar-title">Settings</h1>
      </header>
      <main className="list">
        <dl className="facts">
          <dt>Repo</dt>
          <dd>
            {config.owner}/{config.repo}
          </dd>
          <dt>Branch</dt>
          <dd>{config.branch}</dd>
          <dt>Notes folder</dt>
          <dd>{config.root || "Repo root"}</dd>
          <dt>Version</dt>
          <dd>{__BUILD__}</dd>
        </dl>
        <form
          className="setup"
          onSubmit={(event) => {
            event.preventDefault();
            void replaceKey();
          }}
        >
          <label>
            New GitHub key
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
          <p className="hint">If your key expires, a new one here keeps everything on this phone.</p>
          {keyError && (
            <p className="error" role="alert">
              {keyError}
            </p>
          )}
          <button type="submit" className="secondary" disabled={checking || !token.trim()}>
            {checking ? "Checking…" : "Replace key"}
          </button>
        </form>
        <div className="actions">
          {confirming ? (
            <>
              <p className={unsynced > 0 ? "error" : "hint"} role="alert">
                {unsynced > 0
                  ? `${unsynced} notes haven't reached GitHub and will be lost for good.`
                  : "This removes the key and this phone's copy of your notes. Everything stays on GitHub."}
              </p>
              <button type="button" className="danger" onClick={onDisconnect}>
                {unsynced > 0 ? `Lose ${unsynced} notes and disconnect` : "Disconnect"}
              </button>
              <button type="button" className="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="secondary" onClick={() => setConfirming(true)}>
              Disconnect this phone
            </button>
          )}
        </div>
      </main>
    </>
  );
}
