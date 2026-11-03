import { useState } from "react";
import type { RepoConfig } from "./sync/github";

interface Props {
  config: RepoConfig;
  unsynced: number;
  onBack: () => void;
  onDisconnect: () => void;
}

export function Settings({ config, unsynced, onBack, onDisconnect }: Props) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <header className="bar">
        <button type="button" className="tool" aria-label="Back" onClick={onBack}>
          ‹
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
