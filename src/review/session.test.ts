import { describe, it, expect } from "vitest";
import type { Card, Grade } from "./types";
import { isFirstAnswer, progressLabel, requeue, uniqueCards } from "./session";

const card = (id: string): Card => ({ id, question: id, answer: id, topic: "t" });
const [a, b, c] = [card("a"), card("b"), card("c")];

describe("requeue", () => {
  it("sends a miss to the back, however often it's missed", () => {
    const once = requeue([a, b], 0, "again");
    expect(once.map((x) => x.id)).toEqual(["a", "b", "a"]);
    expect(requeue(once, 2, "again").map((x) => x.id)).toEqual(["a", "b", "a", "a"]);
  });

  it("adds nothing for a recalled card", () => {
    expect(requeue([a, b], 0, "good")).toEqual([a, b]);
  });
});

describe("isFirstAnswer", () => {
  it("is true only until the card has a grade", () => {
    const grades: Grade[] = [{ id: "a", rating: "again" }];
    expect(isFirstAnswer(grades, "a")).toBe(false);
    expect(isFirstAnswer(grades, "b")).toBe(true);
  });
});

describe("uniqueCards", () => {
  it("counts a repeated card once", () => {
    expect(uniqueCards([a, b, a, a])).toBe(2);
  });
});

describe("progressLabel", () => {
  it("counts through the deck, unmoved by requeued cards", () => {
    expect(progressLabel([a, b, c], 0, [])).toBe("1 / 3");
    expect(progressLabel([a, b, c, a], 1, [{ id: "a", rating: "again" }])).toBe("2 / 3");
  });

  it("counts down the cards left to re-ask", () => {
    const grades: Grade[] = [
      { id: "a", rating: "again" },
      { id: "b", rating: "again" },
    ];
    expect(progressLabel([a, b, a, b], 2, grades)).toBe("Again · 2 left");
    expect(progressLabel([a, b, a, b], 3, grades)).toBe("Again · 1 left");
  });
});
