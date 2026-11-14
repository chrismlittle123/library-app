export interface Card {
  id: string;
  question: string;
  answer: string;
  topic: string;
  /** Higher-priority cards return more often; missing values keep the standard schedule. */
  priority?: "high" | "standard";
}

export type Rating = "again" | "good";

/** Per-card scheduling state. Rebuilt from the server's grades on every open. */
export interface CardState {
  id: string;
  ease: number; // 1.3 .. ~2.5, adjusts down on lapse
  interval: number; // months until next due
  due: string; // "YYYY-MM" — the month this card next comes up
  reps: number; // consecutive successful reviews
  lapses: number; // times forgotten
  lastReviewed: string | null; // ISO timestamp
}

/** One card graded once. The server's log of these is the source of truth. */
export interface Grade {
  id: string;
  rating: Rating;
}

/**
 * One completed review session. The counts are the honest telemetry Sumi reads
 * to decide whether a review really happened (a genuine session grades many
 * cards over minutes; a bail-out grades ~none in seconds). NOT a boolean.
 * The grades are what the app replays to rebuild each card's state.
 */
export interface SessionRecord {
  session_id: string; // lets the server drop a retried duplicate
  ts: string; // ISO timestamp, session end
  cards_reviewed: number; // cards shown
  graded: number; // cards actually graded
  again: number;
  good: number;
  duration_s: number; // wall-clock seconds
  grades: Grade[];
}

/** What GET /flashcards/progress returns per session: enough to replay it. */
export interface GradedSession {
  session_id: string | null;
  ts: string;
  grades: Grade[];
}
