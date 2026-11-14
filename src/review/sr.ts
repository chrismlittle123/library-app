import type { CardState, Grade, Rating } from "./types";

// Spaced repetition on a MONTHLY clock. Classic SM-2 runs daily; this app is a
// monthly habit, so intervals are counted in months and "due" is a year-month.
// Successful cards spread out to a tier-specific cap (3 months for high
// priority, 12 for standard); one you miss comes straight back next month.

const MAX_INTERVAL_MONTHS: Record<"high" | "standard", number> = { high: 3, standard: 12 };
const MIN_EASE = 1.3;
const START_EASE = 2.5;

/** Current year-month as "YYYY-MM" (UTC, so it's stable across timezones). */
export function yearMonth(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Add n months to a "YYYY-MM" string. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function newState(id: string, now: string = yearMonth()): CardState {
  return { id, ease: START_EASE, interval: 0, due: now, reps: 0, lapses: 0, lastReviewed: null };
}

/** A card is due if its month has arrived (or passed). */
export function isDue(s: CardState, now: string = yearMonth()): boolean {
  return s.due <= now;
}

/** Apply a grade and return the next state. Pure — easy to test. */
export function grade(
  s: CardState,
  rating: Rating,
  now: string = yearMonth(),
  at: string = new Date().toISOString(),
  priority: "high" | "standard" = "standard",
): CardState {
  let { ease, interval, reps, lapses } = s;

  if (rating === "again") {
    ease = Math.max(MIN_EASE, ease - 0.2);
    interval = 1;
    reps = 0;
    lapses += 1;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 2;
    else interval = Math.min(MAX_INTERVAL_MONTHS[priority], Math.round(interval * ease));
    reps += 1;
  }

  return { ...s, ease, interval, reps, lapses, due: addMonths(now, interval), lastReviewed: at };
}

/**
 * Rebuild every card's state by replaying graded sessions, oldest first.
 *
 * This is what makes the phone disposable: the server keeps the grades, and
 * any device can recompute the same schedule from them. Each session is
 * replayed in the month it ended, exactly as `grade` ran when it happened.
 */
export function replay(
  sessions: { ts: string; grades: Grade[] }[],
  priorities: Record<string, "high" | "standard" | undefined> = {},
): Record<string, CardState> {
  const states: Record<string, CardState> = {};
  const ordered = [...sessions].sort((a, b) => a.ts.localeCompare(b.ts));
  for (const s of ordered) {
    const ym = yearMonth(new Date(s.ts));
    for (const g of s.grades) {
      states[g.id] = grade(states[g.id] ?? newState(g.id, ym), g.rating, ym, s.ts, priorities[g.id]);
    }
  }
  return states;
}
