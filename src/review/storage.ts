import type { Card, CardState, SessionRecord } from "./types";

// localStorage is a cache, not the record: the server holds the grades and the
// deck, and the app rebuilds both from it on every open. What only lives here
// is the pending queue — sessions not yet accepted by the server, including one
// still in progress — and a factory reset can lose only those.
const STATES_KEY = "flashcards.states.v1";
const DECK_KEY = "flashcards.deck.v1";
const PENDING_KEY = "flashcards.pending.v1";
const SERVER_KEY = "flashcards.serverKey.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the app still works, it just won't remember.
  }
}

export function loadStates(): Record<string, CardState> {
  return read<Record<string, CardState>>(STATES_KEY, {});
}

export function saveStates(states: Record<string, CardState>): void {
  write(STATES_KEY, states);
}

export function loadDeck(): Card[] | null {
  return read<Card[] | null>(DECK_KEY, null);
}

export function saveDeck(cards: Card[]): void {
  write(DECK_KEY, cards);
}

export function loadServerKey(): string | null {
  return read<string | null>(SERVER_KEY, null);
}

export function saveServerKey(key: string): void {
  write(SERVER_KEY, key);
}

/** Forget the cards and the server key. Grades not yet uploaded stay, because nothing else holds them. */
export function clearCache(): void {
  try {
    localStorage.removeItem(DECK_KEY);
    localStorage.removeItem(STATES_KEY);
    localStorage.removeItem(SERVER_KEY);
  } catch {
    // Blocked storage has nothing to clear.
  }
}

export function loadPending(): SessionRecord[] {
  return read<SessionRecord[]>(PENDING_KEY, []);
}

/** Add a session to the queue, or replace the copy with the same session_id. */
export function upsertPending(rec: SessionRecord): void {
  write(PENDING_KEY, [...loadPending().filter((r) => r.session_id !== rec.session_id), rec]);
}

export function removePending(sessionId: string): void {
  write(
    PENDING_KEY,
    loadPending().filter((r) => r.session_id !== sessionId),
  );
}
