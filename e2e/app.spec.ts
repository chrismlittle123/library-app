import { expect, test, type Page } from "@playwright/test";

const REPO = "chrismlittle123/library-app-test";
const token = process.env.LIBRARY_TEST_TOKEN ?? "";
const API = `https://api.github.com/repos/${REPO}/contents/vault`;
const HEADERS = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

test.skip(!token, "needs LIBRARY_TEST_TOKEN");
test.describe.configure({ mode: "serial" });

/**
 * Puts the throwaway repo back to its `baseline` tag, dropping every commit the
 * tests made. Run before as well as after, in case a run was stopped halfway.
 */
async function resetTestRepo() {
  // The token can usually write to every repo, so never force-move anything else.
  if (REPO !== "chrismlittle123/library-app-test") throw new Error(`refusing to reset ${REPO}`);
  const git = `https://api.github.com/repos/${REPO}/git`;
  const tag = await fetch(`${git}/ref/tags/baseline`, { headers: HEADERS, cache: "no-store" });
  expect(tag.ok, "the test repo needs a baseline tag").toBe(true);
  const { object } = (await tag.json()) as { object: { sha: string } };
  const reset = await fetch(`${git}/refs/heads/main`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ sha: object.sha, force: true }),
  });
  expect(reset.ok).toBe(true);
}

test.beforeAll(resetTestRepo);
test.afterAll(resetTestRepo);
// The service worker hides requests from the blob cache. The offline test turns it back on.
test.use({ serviceWorkers: "block" });

function isoToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { year: d.getFullYear(), month: pad(d.getMonth() + 1), iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
}

async function readRemote(path: string): Promise<string | null> {
  const response = await fetch(`${API}/${path}?t=${Date.now()}`, { headers: HEADERS, cache: "no-store" });
  if (response.status === 404) return null;
  const body = (await response.json()) as { content: string };
  return Buffer.from(body.content, "base64").toString("utf8");
}

/** A change made somewhere else, as the Mac would. */
async function writeRemote(path: string, text: string) {
  const current = await fetch(`${API}/${path}?t=${Date.now()}`, { headers: HEADERS, cache: "no-store" });
  const sha = current.ok ? ((await current.json()) as { sha: string }).sha : undefined;
  const response = await fetch(`${API}/${path}`, {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify({
      message: "test: change from elsewhere",
      content: Buffer.from(text).toString("base64"),
      sha,
    }),
  });
  expect(response.ok).toBe(true);
}

const blobs = new Map<string, string>();

/**
 * A blob's content never changes, so each is fetched from GitHub once per run.
 * Otherwise every test downloads the whole practice repo and hits the rate limit.
 */
async function serveBlobsFromCache(page: Page) {
  await page.route("**/git/blobs/*", async (route) => {
    const url = route.request().url();
    const cached = blobs.get(url);
    const headers = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (cached) return route.fulfill({ status: 200, headers, body: cached });
    const response = await route.fetch();
    if (response.ok()) blobs.set(url, await response.text());
    return route.fulfill({ response });
  });
}

async function connect(page: Page) {
  await serveBlobsFromCache(page);
  await page.goto("/");
  await page.getByLabel("Repo", { exact: true }).fill(REPO);
  await page.getByLabel("GitHub key").fill(token);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("button", { name: "Synced", exact: true })).toBeVisible({ timeout: 120_000 });
}

const editor = (page: Page) => page.locator(".cm-content");

async function typeAtStart(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type(text);
}

async function backAndSync(page: Page) {
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "Synced", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function openRecipe(page: Page, title: string) {
  await page.getByRole("button", { name: /Catalogues/ }).click();
  await page.getByRole("button", { name: /Recipes/ }).click();
  await page.getByRole("button", { name: title, exact: true }).click();
}

test("rejects a bad key", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Repo", { exact: true }).fill(REPO);
  await page.getByLabel("GitHub key").fill("not-a-real-key");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("alert")).toContainText("rejected");
});

test("connects, downloads notes, and hides non-notes", async ({ page }) => {
  await connect(page);
  await expect(page.getByRole("button", { name: /^Diary/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pipeline/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /obsidian/i })).toHaveCount(0);
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(size[0]).toBeLessThanOrEqual(size[1]);
  // The production build's security policy must still let GitHub through.
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
});

test("a new diary entry covers the days since the last one and reaches GitHub", async ({ page }) => {
  await connect(page);
  const { year, month, iso } = isoToday();
  const mark = `written-${Date.now()}`;
  await page.getByRole("button", { name: /^(New diary entry|Continue today's entry)/ }).click();
  await typeAtStart(page, `${mark} `);
  await expect(page.getByRole("status")).toHaveText(/Not synced|Saving/);
  await backAndSync(page);
  // The baseline's last entry is in the past, so this is a range entry ending today.
  const listing = await fetch(`${API}/diary/weekly/${year}?t=${Date.now()}`, { headers: HEADERS, cache: "no-store" });
  const names = listing.ok ? ((await listing.json()) as { name: string }[]).map((item) => item.name) : [];
  const range = names.find((name) => name.endsWith(`_to_${iso}.md`));
  const remote = await readRemote(range ? `diary/weekly/${year}/${range}` : `diary/daily/${year}/${month}/${iso}.md`);
  expect(remote).toContain(mark);
});

test("a new note left empty creates nothing", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: /^Workshop/ }).click();
  await page.getByRole("button", { name: /New note/ }).click();
  const name = `untouched-${Date.now()}`;
  await page.getByLabel("Note name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "Synced", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await readRemote(`workshop/${name}.md`)).toBeNull();
});

test("generated views open read-only", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: /Catalogues/ }).click();
  await page.getByRole("button", { name: /^Wines/ }).click();
  await page.getByRole("button", { name: "Wines", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Read only");
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("navigation", { name: "Formatting" })).toHaveCount(0);
});

test("search ignores accents and tolerates typos", async ({ page }) => {
  await connect(page);
  await page.getByLabel("Search notes").fill("senorio");
  await expect(page.getByRole("button", { name: /tomato-soup/ })).toBeVisible();
  await page.getByLabel("Search notes").fill("senorrio");
  await expect(page.getByRole("button", { name: /tomato-soup/ })).toBeVisible();
  await page.getByRole("button", { name: /tomato-soup/ }).click();
  await expect(editor(page)).toContainText("Señorío");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Search notes")).toHaveValue("senorrio");
});

test("an open note picks up a change from elsewhere", async ({ page }) => {
  await connect(page);
  await openRecipe(page, "Roast potatoes");
  const mark = `from-mac-${Date.now()}`;
  await writeRemote("catalogues/recipes/roast-potatoes.md", `# Roast potatoes\n\n${mark}\n`);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(editor(page)).toContainText(mark, { timeout: 20_000 });
  await expect(page.getByRole("status")).toHaveText("Synced");
});

test.describe("with the service worker", () => {
test.use({ serviceWorkers: "allow" });

test("writing offline survives a reload and pushes once back online", async ({ page, context }) => {
  await connect(page);
  await openRecipe(page, "Señorío soup");
  const mark = `offline-${Date.now()}`;
  await context.setOffline(true);
  await typeAtStart(page, `${mark} `);
  await expect(page.getByRole("status")).toHaveText("Not synced");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Up a folder" }).click();
  await page.getByRole("button", { name: "Up a folder" }).click();
  await expect(page.getByRole("button", { name: /Offline · 1 not synced/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Not synced" })).toContainText("catalogues/recipes/tomato-soup.md");
  expect(await readRemote("catalogues/recipes/tomato-soup.md")).not.toContain(mark);

  // The service worker serves the app, and the note comes back from the phone's storage.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("region", { name: "Not synced" })).toContainText("catalogues/recipes/tomato-soup.md");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Synced", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await readRemote("catalogues/recipes/tomato-soup.md")).toContain(mark);
});
});

test("a change on both sides keeps both versions", async ({ page, context }) => {
  // The list names a note by its heading, so start from a known one.
  await writeRemote("workshop/ideas/the-log.md", "# The log\n\nStart.\n");
  await connect(page);
  await page.getByRole("button", { name: /^Workshop/ }).click();
  await page.getByRole("button", { name: /^Ideas/ }).click();
  await page.getByRole("button", { name: "The log", exact: true }).click();
  await context.setOffline(true);
  const phone = `phone-${Date.now()}`;
  await typeAtStart(page, `${phone} `);
  await expect(page.getByRole("status")).toHaveText("Not synced");
  const mac = `mac-${Date.now()}`;
  await writeRemote("workshop/ideas/the-log.md", `# The log\n\n${mac}\n`);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByRole("alert")).toContainText("The log also changed elsewhere", { timeout: 30_000 });
  await expect(editor(page)).toContainText(mac);
  expect(await readRemote("workshop/ideas/the-log.md")).toContain(mac);

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Up a folder" }).click();
  await page.getByRole("button", { name: "Up a folder" }).click();
  const conflicts = page.getByRole("region", { name: "Conflict copies" });
  await expect(conflicts).toContainText("the-log (phone conflict");
  await conflicts.getByRole("button").last().click();
  await expect(editor(page)).toContainText(phone);
});

test("a deleted note leaves GitHub in a commit that names it", async ({ page }) => {
  // Its own note, so deleting it can't affect the other tests.
  const name = `doomed-${Date.now()}`;
  await writeRemote(`workshop/${name}.md`, `# ${name}\n`);
  await connect(page);
  await page.getByRole("button", { name: /^Workshop/ }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Synced", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await readRemote(`workshop/${name}.md`)).toBeNull();
  const commits = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=1`, { headers: HEADERS, cache: "no-store" });
  const [head] = (await commits.json()) as { commit: { message: string } }[];
  expect(head.commit.message).toContain("phone: delete 1 note in workshop");
  expect(head.commit.message).toContain(`- workshop/${name}.md`);
});

test("disconnecting erases the phone copy and key", async ({ page }) => {
  await connect(page);
  // Opening a note puts its name in Recent, which has to go too.
  await openRecipe(page, "Roast potatoes");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Up a folder" }).click();
  await page.getByRole("button", { name: "Up a folder" }).click();
  await expect(page.getByRole("region", { name: "Recent" })).toContainText("Roast potatoes");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Disconnect this phone" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByLabel("GitHub key")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("GitHub key")).toHaveValue("");
  const stored = await page.evaluate(async () => ({
    config: localStorage.getItem("vault:config"),
    recent: localStorage.getItem("vault:recent"),
    dbs: (await indexedDB.databases()).map((db) => db.name),
  }));
  expect(stored.config).toBeNull();
  expect(stored.recent).toBeNull();
  expect(stored.dbs).toEqual([]);
});
