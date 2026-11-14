import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GradedSession, SessionRecord } from "./types";

const api = vi.hoisted(() => ({
  fetchProgress: vi.fn(),
  publishSession: vi.fn(),
}));
vi.mock("./api", () => api);

import { DECK_PATH, parseDeck, syncReview } from "./sync";
import { clearCache, loadDeck, loadPending, loadServerKey, saveDeck, saveServerKey, upsertPending } from "./storage";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

const CARD = { id: "a", question: "q", answer: "x", topic: "t" };
const DECK = JSON.stringify([{ ...CARD, memorise: true }]);
const readFile = (path: string) => Promise.resolve(path === DECK_PATH ? DECK : "the-key\n");

function session(id: string, ts: string, rating: "good" | "again" = "good"): SessionRecord {
  return {
    session_id: id,
    ts,
    cards_reviewed: 1,
    graded: 1,
    again: rating === "again" ? 1 : 0,
    good: rating === "good" ? 1 : 0,
    duration_s: 60,
    grades: [{ id: "a", rating }],
  };
}

const onServer = (s: SessionRecord): GradedSession => ({ session_id: s.session_id, ts: s.ts, grades: s.grades });

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  api.fetchProgress.mockReset().mockResolvedValue([]);
  api.publishSession.mockReset().mockResolvedValue(true);
});

describe("parseDeck", () => {
  it("keeps only the active cards and the fields the app shows", () => {
    const text = JSON.stringify([
      { ...CARD, memorise: true, source: "a book" },
      { ...CARD, id: "b", memorise: false },
    ]);
    expect(parseDeck(text)).toEqual([{ ...CARD, priority: "standard" }]);
  });

  it("preserves high priority from the deck", () => {
    const text = JSON.stringify([{ ...CARD, memorise: true, priority: "high" }]);
    expect(parseDeck(text)).toEqual([{ ...CARD, priority: "high" }]);
  });

  it("refuses a broken or empty deck, so the cached one stays", () => {
    expect(parseDeck("not json")).toBeNull();
    expect(parseDeck("{}")).toBeNull();
    expect(parseDeck("[]")).toBeNull();
  });
});

describe("syncReview", () => {
  it("rebuilds state from the server's sessions on a fresh phone", async () => {
    api.fetchProgress.mockResolvedValue([onServer(session("s1", "2026-08-03T21:00:00Z"))]);
    const r = await syncReview(readFile);
    expect(r.online).toBe(true);
    expect(r.deck).toEqual([{ ...CARD, priority: "standard" }]);
    expect(r.states?.["a"].due).toBe("2026-09");
  });

  it("uploads a queued session and clears it once accepted", async () => {
    upsertPending(session("s1", "2026-08-03T21:00:00Z"));
    await syncReview(readFile);
    expect(api.publishSession).toHaveBeenCalledTimes(1);
    expect(loadPending()).toEqual([]);
  });

  it("keeps a session queued while the server refuses it, and still counts it", async () => {
    api.publishSession.mockResolvedValue(false);
    upsertPending(session("s2", "2026-09-02T20:00:00Z", "again"));
    api.fetchProgress.mockResolvedValue([onServer(session("s1", "2026-08-03T21:00:00Z"))]);
    const r = await syncReview(readFile);
    expect(loadPending()).toHaveLength(1);
    expect(r.states?.["a"].lapses).toBe(1);
  });

  it("does not count a queued session twice once the server has it", async () => {
    api.publishSession.mockResolvedValue(false); // lost response: it landed, we think it didn't
    const s1 = session("s1", "2026-08-03T21:00:00Z");
    upsertPending(s1);
    api.fetchProgress.mockResolvedValue([onServer(s1)]);
    const r = await syncReview(readFile);
    expect(r.states?.["a"].reps).toBe(1);
  });

  it("keeps the cache when neither GitHub nor the server can be reached", async () => {
    api.fetchProgress.mockResolvedValue(null);
    const r = await syncReview(() => Promise.reject(new Error("offline")));
    expect(r).toEqual({ deck: null, states: null, online: false });
  });

  it("still gets the cards when only the server is down", async () => {
    api.fetchProgress.mockResolvedValue(null);
    const r = await syncReview(readFile);
    expect(r).toEqual({ deck: [{ ...CARD, priority: "standard" }], states: null, online: false });
  });

  it("uploads a half-finished session so its grades survive the reopen", async () => {
    const partial = session("s1", "2026-08-03T21:00:00Z", "again");
    upsertPending({ ...partial, cards_reviewed: 139 });
    api.fetchProgress.mockImplementation(() =>
      Promise.resolve(api.publishSession.mock.calls.map((c) => onServer(c[0] as SessionRecord))),
    );
    const r = await syncReview(readFile);
    expect(api.publishSession).toHaveBeenCalledTimes(1);
    expect(r.states?.["a"].lapses).toBe(1);
  });

  it("saves the server's key from the notes repo", async () => {
    await syncReview(readFile);
    expect(loadServerKey()).toBe("the-key");
  });

  it("keeps the saved key when the notes repo can't be reached", async () => {
    saveServerKey("saved");
    await syncReview(() => Promise.reject(new Error("offline")));
    expect(loadServerKey()).toBe("saved");
  });
});

describe("upsertPending", () => {
  it("keeps one copy of a session as it grows, grade by grade", () => {
    const first = session("s1", "2026-08-03T21:00:00Z");
    upsertPending(first);
    upsertPending({ ...first, graded: 2, grades: [...first.grades, { id: "b", rating: "good" }] });
    upsertPending(session("s2", "2026-08-04T21:00:00Z"));
    const q = loadPending();
    expect(q.map((r) => r.session_id)).toEqual(["s1", "s2"]);
    expect(q[0].grades).toHaveLength(2);
  });
});

describe("clearCache", () => {
  it("removes the cards and key but keeps grades not yet uploaded", () => {
    saveDeck([CARD]);
    saveServerKey("the-key");
    upsertPending(session("s1", "2026-08-03T21:00:00Z"));
    clearCache();
    expect(loadDeck()).toBeNull();
    expect(loadServerKey()).toBeNull();
    expect(loadPending()).toHaveLength(1);
  });
});
