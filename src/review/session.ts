import type { Card, Grade, Rating } from "./types";

export const MAX_SESSION_CARDS = 30;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Bound each session and let due high-priority cards go first. */
export function selectSessionCards(cards: Card[], limit = MAX_SESSION_CARDS): Card[] {
  const high = shuffle(cards.filter((c) => c.priority === "high"));
  const standard = shuffle(cards.filter((c) => c.priority !== "high"));
  return [...high, ...standard].slice(0, limit);
}

// Within a session a missed card comes back until it's recalled correctly once
// (successive relearning: retrieve to a criterion of one, then again in later
// sessions). Only a card's first answer is a grade: it sets the schedule and is
// what Sumi reads. The answers after it only re-teach the card.

/** Whether this card has yet to be graded in the session. */
export function isFirstAnswer(grades: Grade[], id: string): boolean {
  return !grades.some((g) => g.id === id);
}

/** The queue after answering the card at `idx`: a miss goes to the back. */
export function requeue(queue: Card[], idx: number, rating: Rating): Card[] {
  return rating === "again" ? [...queue, queue[idx]] : queue;
}

/** How many different cards the session covers, however often they repeat. */
export function uniqueCards(queue: Card[]): number {
  return new Set(queue.map((c) => c.id)).size;
}

/** The header's progress: through the deck, then through the cards to re-ask. */
export function progressLabel(queue: Card[], idx: number, grades: Grade[]): string {
  return isFirstAnswer(grades, queue[idx].id)
    ? `${grades.length + 1} / ${uniqueCards(queue)}`
    : `Again · ${queue.length - idx} left`;
}
