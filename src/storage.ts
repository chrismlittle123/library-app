import type { Mode } from "./editor";

const PREFIX = "vault-editor-test:";

// Storage can throw or come back empty in private windows, so every access is
// guarded. This test only ever holds dummy notes.
function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

export const loadNote = (id: string) => read(`note:${id}`);
export const saveNote = (id: string, text: string) => write(`note:${id}`, text);
export const clearNote = (id: string) => {
  try {
    localStorage.removeItem(`${PREFIX}note:${id}`);
  } catch {
    // Nothing stored to clear.
  }
};
export const loadMode = (): Mode => (read("mode") === "hidden" ? "hidden" : "styled");
export const saveMode = (mode: Mode) => write("mode", mode);
export const loadLastNote = () => read("last");
export const saveLastNote = (id: string) => write("last", id);
