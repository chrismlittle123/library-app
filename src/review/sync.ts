import { fetchProgress, publishSession } from "./api";
import { replay } from "./sr";
import { loadPending, removePending, saveServerKey } from "./storage";
import type { Card, CardState } from "./types";

/** Where the cards are written, relative to the notes folder. */
export const DECK_PATH = "knowledge/flashcards/flashcards.json";
/** The review server's key, kept in the private repo because this page is public. */
export const KEY_PATH = "knowledge/flashcards/server-key.txt";

export interface SyncResult {
  deck: Card[] | null; // null: keep the cached deck
  states: Record<string, CardState> | null; // null: keep the cached states
  online: boolean;
}

/** The active cards in the deck file, or null if it isn't a usable deck. */
export function parseDeck(text: string): Card[] | null {
  try {
    const raw = JSON.parse(text) as (Card & { memorise?: boolean })[];
    if (!Array.isArray(raw)) return null;
    const cards = raw
      .filter((c) => c.memorise)
      .map(({ id, question, answer, topic }) => ({ id, question, answer, topic }));
    // An empty deck is a fault, not a reason to hide every card.
    return cards.length > 0 ? cards : null;
  } catch {
    return null;
  }
}

/**
 * Bring this phone up to date, run each time Flashcards opens.
 *
 * 1. Fetch the server's key from the notes repo, so changing it there is enough.
 * 2. Re-send any session finished while offline. A retry of one that did land
 *    is harmless: the server keeps the first copy of each session_id.
 * 3. Read the cards from the notes repo, and every graded session from the server.
 * 4. Replay the server's sessions plus anything still queued, so a review done
 *    offline still counts on this phone before it reaches the server.
 */
export async function syncReview(readFile: (path: string) => Promise<string | null>): Promise<SyncResult> {
  const key = await readFile(KEY_PATH).catch(() => null);
  if (key?.trim()) saveServerKey(key.trim());

  for (const rec of loadPending()) {
    if (await publishSession(rec)) removePending(rec.session_id);
  }

  const [text, sessions] = await Promise.all([readFile(DECK_PATH).catch(() => null), fetchProgress()]);
  const deck = text === null ? null : parseDeck(text);
  let states: Record<string, CardState> | null = null;
  if (sessions) {
    const onServer = new Set(sessions.map((s) => s.session_id));
    const queued = loadPending().filter((p) => !onServer.has(p.session_id));
    states = replay([...sessions, ...queued]);
  }
  return { deck, states, online: deck !== null && sessions !== null };
}
