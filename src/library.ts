import type { NoteRecord } from "./sync/store";

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Matches the library's layout: Diary/daily/YYYY/MM/YYYY-MM-DD.md */
export function diaryPath(date: Date): string {
  return `Diary/daily/${date.getFullYear()}/${pad(date.getMonth() + 1)}/${isoDate(date)}.md`;
}

const DAILY_ENTRY = /^Diary\/daily\/\d{4}\/\d{2}\/(\d{4}-\d{2}-\d{2})(?:_[^/]*)?\.md$/;
const MONTHLY_REVIEW = /^Diary\/monthly\/\d{4}\/(\d{4})-(\d{2})\.md$/;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parseIso = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export interface DiaryEntry {
  path: string;
  /** What a new entry starts with: the days it covers, as every entry in the vault does. */
  draft: string;
  /** The span it covers, for the button: "26 Oct – 10 Nov", or "Today". */
  span: string;
}

/**
 * The next diary entry, as the vault keeps them: each covers the days since the
 * one before, is named by its last day, and starts with "# DD/MM-DD/MM" (or
 * "# DD/MM" for one day). Today's entry is reopened if it's already there.
 */
export function nextDiaryEntry(notes: { path: string }[], today: Date): DiaryEntry {
  const todayIso = isoDate(today);
  const path = diaryPath(today);
  let last = "";
  for (const note of notes) {
    const date = DAILY_ENTRY.exec(note.path)?.[1];
    // A date in the future is a typo, not the last entry.
    if (date && date <= todayIso && date > last) last = date;
  }
  if (last === todayIso) return { path, draft: "", span: "Today" };
  const startIso = last ? isoDate(new Date(parseIso(last).getTime() + 36 * 3600 * 1000)) : todayIso;
  if (startIso >= todayIso) return { path, draft: `# ${ddmm(todayIso)}\n\n`, span: "Today" };
  return {
    path,
    draft: `# ${ddmm(startIso)}-${ddmm(todayIso)}\n\n`,
    span: `${dayMonth(startIso)} – ${dayMonth(todayIso)}`,
  };
}

/** Last month's review, if it hasn't been written yet. Reviews have no template. */
export function dueMonthlyReview(paths: string[], today: Date): { path: string; month: string } | null {
  const month = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const path = `Diary/monthly/${month.getFullYear()}/${month.getFullYear()}-${pad(month.getMonth() + 1)}.md`;
  return paths.includes(path) ? null : { path, month: MONTHS[month.getMonth()] };
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
  // Too short to be a word: "tv" is TV.
  if (/^[a-z]{1,2}$/.test(words)) return words.toUpperCase();
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

/** The heading a note starts with, if it's usable as its name. */
export function leadingHeading(text: string | undefined): string | null {
  const body = (text ?? "").replace(/^---\n[\s\S]*?\n---\n/, "").trimStart();
  const title = /^# +(.+?)\s*#*\s*$/m.exec(body.split("\n", 1)[0])?.[1].trim();
  // A template's placeholder or a date reads better from the path.
  if (!title || title.includes("{{") || /^\d{4}-\d{2}-\d{2}$/.test(title)) return null;
  return title;
}

/**
 * A note's name: its own heading if it starts with one, since a filename loses
 * accents and case. A diary entry is named by the days it covers, and a monthly
 * review by its month, whatever its heading says.
 */
export function noteName(path: string, text: string | undefined): string {
  const month = MONTHLY_REVIEW.exec(path);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const daily = DAILY_ENTRY.exec(path);
  if (daily) {
    const heading = leadingHeading(text);
    return heading && /^\d{2}\/\d{2}(-\d{2}\/\d{2})?$/.test(heading) ? heading : ddmm(daily[1]);
  }
  return leadingHeading(text) ?? displayName(path);
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
  const newestFirst = folder.startsWith("Diary");
  const rootOrder = ["Catalogues", "Diary", "Notes", "Reflections", "Knowledge", "Workshop"];
  const order = (a: string, b: string) => {
    if (!folder) {
      const rank = (name: string) => {
        const index = rootOrder.indexOf(name);
        return index < 0 ? rootOrder.length : index;
      };
      return rank(a) - rank(b) || a.localeCompare(b);
    }
    return newestFirst ? b.localeCompare(a, undefined, { numeric: true }) : a.localeCompare(b, undefined, { numeric: true });
  };
  return {
    folders: [...folders.values()].sort((a, b) => order(a.name, b.name)),
    notes: direct.sort((a, b) => order(a.path, b.path)),
  };
}
