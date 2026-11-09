import { fetchProgress, hasBackend, publishSession } from "./api";
import { replay } from "./sr";
import { loadPending, removePending } from "./storage";
import type { Card, CardState } from "./types";

/** Where the cards are written, relative to the notes folder. */
export const DECK_PATH = "knowledge/flashcards/flashcards.json";

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
 * 1. Re-send any session finished while offline. A retry of one that did land
 *    is harmless: the server keeps the first copy of each session_id.
 * 2. Read the cards from the notes repo, and every graded session from the server.
 * 3. Replay the server's sessions plus anything still queued, so a review done
 *    offline still counts on this phone before it reaches the server.
 */
export async function syncReview(readDeck: () => Promise<string | null>): Promise<SyncResult> {
  for (const rec of hasBackend ? loadPending() : []) {
    if (await publishSession(rec)) removePending(rec.session_id);
  }

  const [text, sessions] = await Promise.all([readDeck().catch(() => null), fetchProgress()]);
  const deck = text === null ? null : parseDeck(text);
  let states: Record<string, CardState> | null = null;
  if (sessions) {
    const onServer = new Set(sessions.map((s) => s.session_id));
    const queued = loadPending().filter((p) => !onServer.has(p.session_id));
    states = replay([...sessions, ...queued]);
  }
  return { deck, states, online: deck !== null && sessions !== null };
}
