import { useCallback, useEffect, useMemo, useState } from "react";
import { loadConfig, saveConfig } from "./config";
import { Editor } from "./Editor";
import { Home } from "./Home";
import { Review } from "./review/Review";
import { clearCache } from "./review/storage";
import { Settings } from "./Settings";
import { Setup } from "./Setup";
import type { RepoConfig } from "./sync/github";
import { openStore, type NoteStore } from "./sync/store";
import { useSync } from "./useSync";
import { DIARY_TEMPLATE_PATH, diaryPath, fillTemplate, noteTitle } from "./library";

/** Fit the app to the space above the keyboard, which iOS doesn't do for us. */
function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty("--app-height", `${viewport.height}px`);
      root.style.setProperty("--app-top", `${viewport.offsetTop}px`);
      root.classList.toggle("keyboard-open", window.innerHeight - viewport.height > 120);
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);
}

export function App() {
  useVisualViewport();
  const [config, setConfig] = useState(loadConfig);
  const owner = config?.owner;
  const repo = config?.repo;
  // Kept when the key is replaced, because disconnecting has to close this store's connection.
  const store = useMemo(() => (owner && repo ? openStore(owner, repo) : null), [owner, repo]);

  let content;
  if (config && store) {
    content = (
      <Connected
        key={`${config.owner}/${config.repo}/${config.token}`}
        config={config}
        store={store}
        onReplaceKey={(token) => {
          const next = { ...config, token };
          saveConfig(next);
          setConfig(next);
        }}
        onDisconnect={() => {
          void store.erase();
          clearCache();
          saveConfig(null);
          setConfig(null);
        }}
      />
    );
  } else {
    content = (
      <Setup
        onConnected={(next) => {
          saveConfig(next);
          setConfig(next);
        }}
      />
    );
  }
  return <div className="app">{content}</div>;
}

type Tab = "library" | "review";

type Screen =
  | { name: "home" }
  | { name: "settings" }
  /** `draft` is the starting text of a note that doesn't exist until it's edited. */
  | { name: "note"; path: string; draft?: string };

function Connected({
  config,
  store,
  onReplaceKey,
  onDisconnect,
}: {
  config: RepoConfig;
  store: NoteStore;
  onReplaceKey: (token: string) => void;
  onDisconnect: () => void;
}) {
  const { notes, loaded, status, edit, syncNow, conflicts, clearConflicts } = useSync(config, store);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [tab, setTab] = useState<Tab>("library");
  const [folder, setFolder] = useState("");
  // Kept here so going back from a search result returns to the results.
  const [query, setQuery] = useState("");

  const goHome = useCallback(() => {
    setScreen({ name: "home" });
    // Leaving a note is a natural moment to push it, without waiting.
    window.setTimeout(() => void syncNow(), 300);
  }, [syncNow]);

  const openDraft = (path: string, draft: string) => {
    if (notes.some((note) => note.path === path)) setScreen({ name: "note", path });
    else setScreen({ name: "note", path, draft });
  };

  const openToday = () => {
    const today = new Date();
    const template = notes.find((note) => note.path === DIARY_TEMPLATE_PATH)?.text ?? "";
    openDraft(diaryPath(today), fillTemplate(template, today));
  };

  const notePath = screen.name === "note" ? screen.path : null;
  const save = useCallback(
    (text: string, editedFrom: string) => edit(notePath!, text, editedFrom),
    [edit, notePath],
  );
  const readStored = useCallback(() => store.get(notePath!), [store, notePath]);

  if (!loaded) return null;

  const notice = conflicts.length > 0 && (
    <div className="notice" role="alert">
      <p>
        {conflicts.map((c) => noteTitle(c.path)).join(", ")} also changed elsewhere. Both versions are
        kept, and your phone's is listed on the home screen.
      </p>
      <button type="button" className="tool" aria-label="Dismiss" onClick={clearConflicts}>
        ×
      </button>
    </div>
  );

  if (screen.name === "settings") {
    return (
      <Settings
        config={config}
        unsynced={notes.filter((note) => note.dirty).length}
        onBack={() => setScreen({ name: "home" })}
        onReplaceKey={onReplaceKey}
        onDisconnect={onDisconnect}
      />
    );
  }

  if (screen.name === "note") {
    const record = notes.find((note) => note.path === screen.path);
    return (
      <>
        {notice}
        <Editor
          key={screen.path}
          path={screen.path}
          text={record?.text ?? screen.draft ?? ""}
          record={record}
          readStored={readStored}
          onSave={save}
          onBack={goHome}
          autoFocus={!record}
        />
      </>
    );
  }

  const tabs = (
    <nav className="tabs" aria-label="Sections">
      {(["library", "review"] as const).map((item) => (
        <button
          key={item}
          type="button"
          className="tab"
          aria-current={tab === item ? "page" : undefined}
          onClick={() => setTab(item)}
        >
          {item === "library" ? "Library" : "Flashcards"}
        </button>
      ))}
    </nav>
  );

  if (tab === "review") return <Review config={config} tabs={tabs} />;

  return (
    <>
      {notice}
      <Home
        notes={notes}
        status={status}
        folder={folder}
        onFolder={setFolder}
        query={query}
        onQuery={setQuery}
        onOpen={(path) => setScreen({ name: "note", path })}
        onToday={openToday}
        onCreate={(path) => openDraft(path, `# ${noteTitle(path)}\n\n`)}
        onSync={() => void syncNow()}
        onSettings={() => setScreen({ name: "settings" })}
      />
      {tabs}
    </>
  );
}
