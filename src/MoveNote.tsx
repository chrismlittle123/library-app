import { useEffect, useMemo, useRef, useState } from "react";
import { displayName } from "./library";

export function MoveNote({ path, paths, onMove, onClose }: {
  path: string;
  paths: string[];
  onMove: (destination: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const current = path.split("/").slice(0, -1).join("/");
  const [folder, setFolder] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const folders = useMemo(() => {
    const all = new Set(["", current]);
    for (const item of paths) {
      const parts = item.split("/").slice(0, -1);
      if (parts[0] === "templates") continue;
      for (let i = 1; i <= parts.length; i += 1) all.add(parts.slice(0, i).join("/"));
    }
    return [...all].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [paths, current]);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog ref={dialog} className="move-dialog" aria-labelledby="move-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (busy || folder === current) return;
        setBusy(true);
        setError("");
        const filename = path.split("/").pop()!;
        void onMove(folder ? `${folder}/${filename}` : filename).then(onClose).catch((failure: unknown) => {
          setError(failure instanceof Error ? failure.message : "Couldn't move this note. Try again.");
          setBusy(false);
        });
      }}>
        <h2 id="move-title">Move note</h2>
        <p>Choose a folder. Your note keeps its filename. Moving needs a connection.</p>
        <label htmlFor="move-folder">Destination folder</label>
        <select id="move-folder" value={folder} disabled={busy} onChange={(event) => setFolder(event.target.value)}>
          {folders.map((item) => <option key={item} value={item}>
            {item ? item.split("/").map((_, i, parts) => displayName(parts.slice(0, i + 1).join("/"))).join(" › ") : "Library"}
            {item === current ? " (current folder)" : ""}
          </option>)}
        </select>
        {error && <p role="alert">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || folder === current}>{busy ? "Moving…" : "Move"}</button>
        </div>
      </form>
    </dialog>
  );
}
