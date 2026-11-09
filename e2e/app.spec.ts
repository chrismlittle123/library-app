import { expect, test, type Page } from "@playwright/test";

const REPO = "chrismlittle123/library-app-test";
const token = process.env.LIBRARY_TEST_TOKEN ?? "";
const API = `https://api.github.com/repos/${REPO}/contents/vault`;
const HEADERS = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

test.skip(!token, "needs LIBRARY_TEST_TOKEN");
test.describe.configure({ mode: "serial" });
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
  await page.getByRole("button", { name: /catalogues/ }).click();
  await page.getByRole("button", { name: /recipes/ }).click();
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
  await expect(page.getByRole("button", { name: /^diary/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^pipeline/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /obsidian/ })).toHaveCount(0);
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(size[0]).toBeLessThanOrEqual(size[1]);
  // The production build's security policy must still let GitHub through.
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
});

test("today's entry uses the template and reaches GitHub", async ({ page }) => {
  await connect(page);
  const { year, month, iso } = isoToday();
  const mark = `written-${Date.now()}`;
  await page.getByRole("button", { name: "Today's entry" }).click();
  await typeAtStart(page, `${mark} `);
  await expect(page.getByRole("status")).toHaveText(/Not synced|Saving/);
  await backAndSync(page);
  const remote = await readRemote(`diary/daily/${year}/${month}/${iso}.md`);
  expect(remote).toContain(mark);
  expect(remote).toContain(`# ${iso}`);
});

test("a new note left empty creates nothing", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: /^workshop/ }).click();
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
  await page.getByRole("button", { name: /catalogues/ }).click();
  await page.getByRole("button", { name: /wines/ }).click();
  await page.getByRole("button", { name: "wines", exact: true }).click();
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
  await openRecipe(page, "roast-potatoes");
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
  await openRecipe(page, "tomato-soup");
  const mark = `offline-${Date.now()}`;
  await context.setOffline(true);
  await typeAtStart(page, `${mark} `);
  await expect(page.getByRole("status")).toHaveText("Not synced");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Up a folder" }).click();
  await page.getByRole("button", { name: "Up a folder" }).click();
  await expect(page.getByRole("button", { name: /Offline · 1 not synced/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Not synced" })).toContainText("tomato-soup");
  expect(await readRemote("catalogues/recipes/tomato-soup.md")).not.toContain(mark);

  // The service worker serves the app, and the note comes back from the phone's storage.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("region", { name: "Not synced" })).toContainText("tomato-soup");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Synced", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await readRemote("catalogues/recipes/tomato-soup.md")).toContain(mark);
});
});

test("a change on both sides keeps both versions", async ({ page, context }) => {
  await connect(page);
  await page.getByRole("button", { name: /^workshop/ }).click();
  await page.getByRole("button", { name: /ideas/ }).click();
  await page.getByRole("button", { name: "the-log", exact: true }).click();
  await context.setOffline(true);
  const phone = `phone-${Date.now()}`;
  await typeAtStart(page, `${phone} `);
  await expect(page.getByRole("status")).toHaveText("Not synced");
  const mac = `mac-${Date.now()}`;
  await writeRemote("workshop/ideas/the-log.md", `# An idea\n\n${mac}\n`);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.getByRole("alert")).toContainText("the-log also changed elsewhere", { timeout: 30_000 });
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

test("disconnecting erases the phone copy and key", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Disconnect this phone" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByLabel("GitHub key")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("GitHub key")).toHaveValue("");
  const stored = await page.evaluate(async () => ({
    config: localStorage.getItem("vault:config"),
    dbs: (await indexedDB.databases()).map((db) => db.name),
  }));
  expect(stored.config).toBeNull();
  expect(stored.dbs).toEqual([]);
});
