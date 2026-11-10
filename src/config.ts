import type { Mode } from "./editorState";
import type { RepoConfig } from "./sync/github";

const CONFIG_KEY = "vault:config";
const MODE_KEY = "vault:mode";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Without storage the app still works until it's closed.
  }
}

export function loadConfig(): RepoConfig | null {
  const raw = read(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RepoConfig;
  } catch {
    return null;
  }
}

export const saveConfig = (config: RepoConfig | null) =>
  write(CONFIG_KEY, config && JSON.stringify(config));

export const loadMode = (): Mode => (read(MODE_KEY) === "styled" ? "styled" : "hidden");
export const saveMode = (mode: Mode) => write(MODE_KEY, mode);

const RECENT_KEY = "vault:recent";
const RECENT_LIMIT = 8;

/** Notes opened on this phone, most recent first. */
export function loadRecent(): string[] {
  try {
    const paths: unknown = JSON.parse(read(RECENT_KEY) ?? "[]");
    return Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : [];
  } catch {
    return [];
  }
}

export const clearRecent = () => write(RECENT_KEY, null);

export function addRecent(path: string): string[] {
  const next = [path, ...loadRecent().filter((item) => item !== path)].slice(0, RECENT_LIMIT);
  write(RECENT_KEY, JSON.stringify(next));
  return next;
}
