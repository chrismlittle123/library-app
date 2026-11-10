import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fakeGitHub";

// The service worker would hide the app's requests from the fakes.
test.use({ serviceWorkers: "block" });

const DECK = JSON.stringify([
  { id: "a", question: "What is the first question?", answer: "The **first** answer", topic: "history", memorise: true },
  { id: "b", question: "What is the second question?", answer: "The second answer", topic: "history", memorise: true },
  { id: "c", question: "Not being learned yet", answer: "Hidden", topic: "history", memorise: false },
]);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

type Sent = { session_id: string; ts: string; graded: number; again: number; good: number; grades: { id: string; rating: string }[] };

let github: FakeGitHub;
let serverUp: boolean;
let log: Sent[];
let secrets: (string | undefined)[];

const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" });

test.beforeEach(async ({ page }) => {
  github = new FakeGitHub({
    "vault/inbox/idea.md": "# Idea\n",
    "vault/knowledge/flashcards/flashcards.json": DECK,
    "vault/knowledge/flashcards/server-key.txt": "e2e-secret\n",
  });
  await github.install(page);
  serverUp = true;
  log = [];
  secrets = [];
  await page.route("https://openbanking.chris-little.com/flashcards/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (!serverUp) return route.abort();
    secrets.push(await request.headerValue("x-flashcards-secret") ?? undefined);
    const headers = { ...CORS, "content-type": "application/json" };
    if (request.method() === "POST") {
      const session = request.postDataJSON() as Sent;
      if (!log.some((item) => item.session_id === session.session_id)) log.push(session);
      return route.fulfill({ status: 200, headers, body: '{"ok":true}' });
    }
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ sessions: log }) });
  });
  await page.goto("/");
  await page.getByLabel("Repo", { exact: true }).fill("me/notes");
  await page.getByLabel("GitHub key").fill(github.token);
  await button(page, "Connect").click();
  await expect(button(page, "Synced")).toBeVisible();
});

async function grade(page: Page, rating: "Again" | "Good") {
  await button(page, "Show answer").click();
  await button(page, rating).click();
}

test("a review reads the cards from the notes and logs the grades", async ({ page }) => {
  await button(page, "Flashcards").click();
  await expect(page.getByText("2 due")).toBeVisible();
  await button(page, "Start review").click();
  await expect(button(page, "Library")).toBeHidden();
  await button(page, "Show answer").click();
  await expect(page.locator(".review-answer")).toContainText(/first|second/);
  await button(page, "Again").click();
  await grade(page, "Good");
  // The missed card comes back, but only its first answer is a grade.
  await expect(page.getByText(/Again · 1 left/)).toBeVisible();
  await grade(page, "Good");

  await expect(page.getByText("Saved and logged for Sumi")).toBeVisible();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ graded: 2, again: 1, good: 1 });
  expect(new Set(secrets)).toEqual(new Set(["e2e-secret"]));

  await button(page, "Back").click();
  await expect(page.getByText("All caught up")).toBeVisible();
  await button(page, "Library").click();
  await expect(page.getByRole("button", { name: /^Inbox/ })).toBeVisible();
});

test("a review can be left before answering anything", async ({ page }) => {
  await button(page, "Flashcards").click();
  await button(page, "Start review").click();
  await button(page, "Exit review").click();
  await expect(page.getByText("2 due")).toBeVisible();
  await expect(button(page, "Library")).toBeVisible();
  expect(log).toHaveLength(0);
});

test("leaving a review partway logs what was answered", async ({ page }) => {
  await button(page, "Flashcards").click();
  await button(page, "Start review").click();
  await grade(page, "Good");
  await button(page, "Exit review").click();
  await expect(page.getByText("1 / 1 recalled")).toBeVisible();
  await expect(page.getByText("Saved and logged for Sumi")).toBeVisible();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ graded: 1, good: 1 });
  await button(page, "Back").click();
  await expect(page.getByText("1 due")).toBeVisible();
});

test("a new card written on the Mac appears on the next open", async ({ page }) => {
  await button(page, "Flashcards").click();
  await expect(page.getByText("2 due")).toBeVisible();
  github.write(
    "knowledge/flashcards/flashcards.json",
    JSON.stringify([...(JSON.parse(DECK) as object[]), { id: "d", question: "New", answer: "New", topic: "t", memorise: true }]),
  );
  await button(page, "Library").click();
  await button(page, "Flashcards").click();
  await expect(page.getByText("3 due")).toBeVisible();
});

test("a review done while the server is down uploads later", async ({ page }) => {
  await button(page, "Flashcards").click();
  await expect(page.getByText("2 due")).toBeVisible();
  serverUp = false;
  await button(page, "Start review").click();
  await grade(page, "Good");
  await grade(page, "Good");
  await expect(page.getByText(/It'll upload next time/)).toBeVisible();
  expect(log).toHaveLength(0);

  serverUp = true;
  await button(page, "Back").click();
  await button(page, "Library").click();
  await button(page, "Flashcards").click();
  await expect(page.getByText("All caught up")).toBeVisible();
  expect(log).toHaveLength(1);
});

test("disconnecting removes the cards from the phone", async ({ page }) => {
  await button(page, "Flashcards").click();
  await expect(page.getByText("2 due")).toBeVisible();
  await button(page, "Library").click();
  await button(page, "Settings").click();
  await button(page, "Disconnect this phone").click();
  await button(page, "Disconnect").click();
  await expect(page.getByLabel("GitHub key")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("flashcards.deck.v1"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("flashcards.serverKey.v1"))).toBeNull();
});
