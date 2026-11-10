import type { NoteRecord } from "./sync/store";

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Matches the library's layout: diary/daily/YYYY/MM/YYYY-MM-DD.md */
export function diaryPath(date: Date): string {
  return `diary/daily/${date.getFullYear()}/${pad(date.getMonth() + 1)}/${isoDate(date)}.md`;
}

export const DIARY_TEMPLATE_PATH = "templates/daily.md";

export function fillTemplate(template: string, date: Date): string {
  return template.replace(/\{\{date(?::YYYY-MM-DD)?\}\}/g, isoDate(date));
}

export function noteTitle(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A filename as words: "roast-potatoes" reads "Roast potatoes". Mixed case is left alone. */
export function prettify(name: string): string {
  // Hyphens between digits stay, so dates inside a name still read as dates.
  const words = name.replace(/(?<!\d)[-_]+|[-_]+(?!\d)/g, " ").replace(/\s+/g, " ").trim();
  if (words !== words.toLowerCase()) return words;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How a note or folder is named on screen. Diary dates and month folders read as dates. */
export function displayName(path: string): string {
  const name = noteTitle(path);
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name);
  if (date) {
    const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
    const weekday = DAYS[new Date(year, month - 1, day).getDay()];
    return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
  }
  const parent = path.split("/").slice(-2, -1)[0] ?? "";
  if (/^\d{4}$/.test(parent) && /^(0[1-9]|1[0-2])$/.test(name)) return MONTHS[Number(name) - 1];
  return prettify(name);
}

/** Generated views say "do not edit" at the top, and get overwritten if edited. */
export function isGenerated(text: string): boolean {
  return text.slice(0, 120).includes("do not edit");
}

export function isConflictCopy(path: string): boolean {
  return path.includes("(phone conflict ");
}

/** A note path from a typed name, or null if there's nothing usable in it. */
export function newNotePath(folder: string, name: string): string | null {
  const clean = name
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[/\\:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  if (!clean) return null;
  return `${folder ? `${folder}/` : ""}${clean}.md`;
}

export interface FolderView {
  folders: { name: string; path: string; count: number; unsynced: number }[];
  notes: NoteRecord[];
}

/** The folders and notes directly inside `folder`. Diary folders list newest first. */
export function listFolder(notes: NoteRecord[], folder: string): FolderView {
  const prefix = folder ? `${folder}/` : "";
  const folders = new Map<string, FolderView["folders"][number]>();
  const direct: NoteRecord[] = [];
  for (const note of notes) {
    if (!note.path.startsWith(prefix)) continue;
    const rest = note.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      direct.push(note);
      continue;
    }
    const name = rest.slice(0, slash);
    const entry = folders.get(name) ?? { name, path: prefix + name, count: 0, unsynced: 0 };
    entry.count += 1;
    if (note.dirty) entry.unsynced += 1;
    folders.set(name, entry);
  }
  const newestFirst = folder.startsWith("diary");
  const order = (a: string, b: string) =>
    newestFirst ? b.localeCompare(a, undefined, { numeric: true }) : a.localeCompare(b, undefined, { numeric: true });
  return {
    folders: [...folders.values()].sort((a, b) => order(a.name, b.name)),
    notes: direct.sort((a, b) => order(a.path, b.path)),
  };
}
