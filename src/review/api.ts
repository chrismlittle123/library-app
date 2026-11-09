import type { GradedSession, SessionRecord } from "./types";

const BASE = "https://openbanking.chris-little.com/flashcards";
const SECRET = import.meta.env.VITE_API_SECRET as string | undefined;

// Long enough for a slow phone connection, short enough that a dead server
// doesn't hold the start screen hostage: the app falls back to its cache.
const TIMEOUT_MS = 8000;

/** Whether this build can log reviews to the server at all. */
export const hasBackend = Boolean(SECRET);

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(SECRET ? { "X-Flashcards-Secret": SECRET } : {}), ...extra };
}

/**
 * Log a finished session, which is what Sumi reads and what the schedule is
 * rebuilt from. Never throws: the caller keeps the session queued and retries
 * on the next open, so being offline never loses a review.
 */
export async function publishSession(rec: SessionRecord): Promise<boolean> {
  if (!hasBackend) return false;
  try {
    const res = await fetch(`${BASE}/review`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(rec),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Every graded session the server holds, or null when it can't be reached. */
export async function fetchProgress(): Promise<GradedSession[] | null> {
  if (!hasBackend) return null;
  try {
    const res = await fetch(`${BASE}/progress`, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sessions?: unknown };
    return Array.isArray(data.sessions) ? (data.sessions as GradedSession[]) : null;
  } catch {
    return null;
  }
}
