import { describe, it, expect } from "vitest";
import { addMonths, grade, isDue, newState, replay, yearMonth } from "./sr";

describe("addMonths", () => {
  it("rolls over the year", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", 0)).toBe("2026-01");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });
});

describe("isDue", () => {
  it("is due when the month has arrived", () => {
    expect(isDue({ ...newState("a", "2026-08"), due: "2026-08" }, "2026-08")).toBe(true);
    expect(isDue({ ...newState("a", "2026-09"), due: "2026-09" }, "2026-08")).toBe(false);
  });
});

describe("grade", () => {
  it("a new card graded good comes back next month", () => {
    const s = grade(newState("a", "2026-08"), "good", "2026-08");
    expect(s.interval).toBe(1);
    expect(s.due).toBe("2026-09");
    expect(s.reps).toBe(1);
  });

  it("intervals grow as you keep getting it right", () => {
    let s = newState("a", "2026-08");
    s = grade(s, "good", "2026-08"); // rep1 -> 1mo
    s = grade(s, "good", "2026-09"); // rep2 -> 2mo
    s = grade(s, "good", "2026-11"); // rep3 -> round(2 * 2.5) = 5mo
    expect(s.interval).toBe(5);
    expect(s.due).toBe("2027-04");
  });

  it("keeps high-priority cards on a three-month maximum interval", () => {
    let s = newState("a", "2026-08");
    s = grade(s, "good", "2026-08", undefined, "high");
    s = grade(s, "good", "2026-09", undefined, "high");
    s = grade(s, "good", "2026-11", undefined, "high");
    expect(s.interval).toBe(3);
    expect(s.due).toBe("2027-02");
  });

  it("a lapse resets the interval and lowers ease", () => {
    let s = newState("a", "2026-08");
    s = grade(s, "good", "2026-08");
    s = grade(s, "good", "2026-09");
    const before = s.ease;
    s = grade(s, "again", "2026-11");
    expect(s.interval).toBe(1);
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.ease).toBeCloseTo(before - 0.2);
  });

  it("never schedules beyond a year", () => {
    let s = newState("a", "2026-08");
    for (let i = 0; i < 10; i++) s = grade(s, "good", yearMonth());
    expect(s.interval).toBeLessThanOrEqual(12);
  });
});

describe("replay", () => {
  it("rebuilds the same state as grading live", () => {
    let live = newState("a", "2026-08");
    live = grade(live, "good", "2026-08");
    live = grade(live, "good", "2026-09");
    live = grade(live, "again", "2026-11");
    const rebuilt = replay([
      { ts: "2026-08-03T21:00:00Z", grades: [{ id: "a", rating: "good" }] },
      { ts: "2026-09-02T20:00:00Z", grades: [{ id: "a", rating: "good" }] },
      { ts: "2026-11-05T19:00:00Z", grades: [{ id: "a", rating: "again" }] },
    ]);
    // lastReviewed differs by design: replay stamps the session's end time.
    expect({ ...rebuilt["a"], lastReviewed: null }).toEqual({ ...live, lastReviewed: null });
    expect(rebuilt["a"].due).toBe("2026-12");
  });

  it("replays high-priority cards using their current tier", () => {
    const rebuilt = replay([
      { ts: "2026-08-03T21:00:00Z", grades: [{ id: "a", rating: "good" }] },
      { ts: "2026-09-03T21:00:00Z", grades: [{ id: "a", rating: "good" }] },
      { ts: "2026-11-03T21:00:00Z", grades: [{ id: "a", rating: "good" }] },
    ], { a: "high" });
    expect(rebuilt["a"].interval).toBe(3);
    expect(rebuilt["a"].due).toBe("2027-02");
  });

  it("replays sessions oldest first whatever order they arrive in", () => {
    const rebuilt = replay([
      { ts: "2026-09-02T20:00:00Z", grades: [{ id: "a", rating: "again" }] },
      { ts: "2026-08-03T21:00:00Z", grades: [{ id: "a", rating: "good" }] },
    ]);
    expect(rebuilt["a"].lapses).toBe(1);
    expect(rebuilt["a"].reps).toBe(0);
    expect(rebuilt["a"].due).toBe("2026-10");
  });

  it("keeps cards separate and leaves ungraded ones out", () => {
    const rebuilt = replay([
      {
        ts: "2026-08-03T21:00:00Z",
        grades: [
          { id: "a", rating: "good" },
          { id: "b", rating: "again" },
        ],
      },
    ]);
    expect(Object.keys(rebuilt).sort()).toEqual(["a", "b"]);
    expect(rebuilt["a"].due).toBe("2026-09");
    expect(rebuilt["b"].lapses).toBe(1);
  });

  it("is empty with no sessions", () => {
    expect(replay([])).toEqual({});
  });
});
