import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fakeGitHub";

// The service worker would hide the app's requests from the fake GitHub.
test.use({ serviceWorkers: "block" });

const TOMATO = "Notes/recipes/tomato-soup.md";
const POTATO = "Notes/recipes/roast-potatoes.md";

let github: FakeGitHub;

test.beforeEach(async ({ page }) => {
  github = new FakeGitHub({
    [`vault/${TOMATO}`]: "# Tomato soup\n\nSimmer.\n",
    [`vault/${POTATO}`]: "# Roast potatoes\n\nRoast.\n",
    "vault/Workshop/idea.md": "# Idea\n",
    "vault/templates/daily.md": "# {{date:YYYY-MM-DD}}\n\n",
  });
  await github.install(page);
});

const editor = (page: Page) => page.locator(".cm-content");
const status = (page: Page) => page.getByRole("status");
const synced = (page: Page) => page.getByRole("button", { name: "Synced", exact: true });
const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" });
const online = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Repo", { exact: true }).fill("me/notes");
  await page.getByLabel("GitHub key").fill(github.token);
  await button(page, "Connect").click();
  await expect(synced(page)).toBeVisible();
}

test("the diary shortcut writes today's entry headed with its date, and Templates is hidden", async ({ page }) => {
  await connect(page);
  await expect(button(page, /^Free text/)).toBeVisible();
  await expect(button(page, /^Templates/)).toHaveCount(0);
  await button(page, /^New diary entry/).click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("dear diary");
  await button(page, "Back").click();
  await expect(synced(page)).toBeVisible();
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // With no earlier entry it covers just today, and says so like every entry does.
  expect(github.read(`Diary/daily/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${iso}.md`)).toBe(
    `# ${pad(d.getDate())}/${pad(d.getMonth() + 1)}\n\ndear diary`,
  );
  await expect(button(page, /^Continue today's entry/)).toBeVisible();
});

test("a note deleted here goes from GitHub in a commit of its own", async ({ page }) => {
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await button(page, "Delete note").click();
  await button(page, "Cancel").click();
  await expect(editor(page)).toContainText("Simmer.");
  await button(page, "Delete note").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  // Back in the folder, and the note is gone from the phone straight away.
  await expect(button(page, "Roast potatoes")).toBeVisible();
  await expect(button(page, "Tomato soup")).toHaveCount(0);
  await expect(synced(page)).toBeVisible();
  expect(github.read(TOMATO)).toBeUndefined();
  expect(github.read(POTATO)).toBeDefined();
  expect(github.messages.at(-1)).toMatch(/^phone: delete 1 note in free-text\/recipes\n\n- free-text\/recipes\/tomato-soup\.md/);
});

test("deleting a folder removes every note in it as one commit", async ({ page }) => {
  await connect(page);
  await button(page, /^Free text/).click();
  await button(page, /^Recipes/).click();
  await button(page, "Delete folder").click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete all 2 notes in Recipes");
  await button(page, "Delete 2 notes").click();
  // Recipes was the only thing in Free text, so that empties too.
  await expect(button(page, /^Recipes/)).toHaveCount(0);
  await expect(synced(page)).toBeVisible();
  expect(github.read(TOMATO)).toBeUndefined();
  expect(github.read(POTATO)).toBeUndefined();
  expect(github.read("workshop/idea.md")).toBeDefined();
  const deletes = github.messages.filter((message) => message.startsWith("phone: delete"));
  expect(deletes).toEqual([expect.stringMatching(/^phone: delete 2 notes in free-text\/recipes\n/)]);
});

test("GitHub lagging just after a push doesn't make a conflict copy", async ({ page }) => {
  github.staleReadsAfterPush = 3;
  await connect(page);
  await openRecipe(page, "Roast potatoes");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" one");
  await button(page, "Back").click();
  await expect(synced(page)).toBeVisible();
  // Straight back in and writing more, while GitHub still answers with the old head.
  await button(page, "Roast potatoes").click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" two");
  await button(page, "Back").click();
  await expect(synced(page)).toBeVisible({ timeout: 15_000 });
  expect(github.paths().filter((path) => path.includes("phone conflict"))).toEqual([]);
  expect(github.read(POTATO)).toContain("one");
  expect(github.read(POTATO)).toContain("two");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a relaunch straight after a push, while GitHub lags, makes no conflict copy", async ({ page }) => {
  await connect(page);
  await openRecipe(page, "Roast potatoes");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" before");
  github.staleReadsAfterPush = 4;
  await button(page, "Back").click();
  await expect(synced(page)).toBeVisible();
  // iOS relaunching the app, which forgets everything not in storage.
  await page.reload();
  await button(page, /^Free text/).click();
  await button(page, /^Recipes/).click();
  await button(page, "Roast potatoes").click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" after");
  await button(page, "Back").click();
  await expect(synced(page)).toBeVisible({ timeout: 20_000 });
  expect(github.paths().filter((path) => path.includes("phone conflict"))).toEqual([]);
  expect(github.read(POTATO)).toMatch(/before after/);
});

test("the first download fetches notes in a batch, not one at a time", async ({ page }) => {
  await connect(page);
  expect(github.requests.filter((label) => label === "POST /graphql")).toHaveLength(1);
  expect(github.requests.filter((label) => label.startsWith("GET /git/blobs/"))).toHaveLength(0);
  await openRecipe(page, "Roast potatoes");
  await expect(editor(page)).toContainText("Roast.");
});

test("notes still arrive one at a time when batches are refused", async ({ page }) => {
  github.refuseBatches = true;
  await connect(page);
  expect(github.requests.filter((label) => label.startsWith("GET /git/blobs/"))).toHaveLength(4);
  await openRecipe(page, "Roast potatoes");
  await expect(editor(page)).toContainText("Roast.");
});

async function openRecipe(page: Page, title: string) {
  await button(page, /^Free text/).click();
  await button(page, /^Recipes/).click();
  await button(page, title).click();
}

async function typeAtStart(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type(text);
}

async function backToHome(page: Page) {
  await button(page, "Back").click();
  while (await button(page, "Up a folder").count()) await button(page, "Up a folder").click();
}

/** A promise and the function that resolves it. */
function gate() {
  let open = () => {};
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { closed, open };
}

test("writing in a new note starts below its heading", async ({ page }) => {
  await connect(page);
  await button(page, /^Workshop/).click();
  await button(page, /New note/).click();
  await page.getByLabel("Note name").fill("fresh");
  await button(page, "Create").click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("first words");
  await expect(editor(page).locator(".cm-line").first()).not.toContainText("first words");
  await expect(editor(page).locator(".cm-line").last()).toHaveText("first words");
});

test("typing while a change from elsewhere arrives keeps both", async ({ page, context }) => {
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await context.setOffline(true);
  await typeAtStart(page, "other edit ");
  await expect(status(page)).toHaveText("Not synced");
  await button(page, "Back").click();
  await button(page, "Roast potatoes").click();
  github.write(POTATO, "# Roast potatoes\n\nfrom the mac\n");

  // A slow push keeps the sync running after it has stored the Mac's change.
  const push = gate();
  const pushing = gate();
  github.holdNext(/^POST \/git\/trees/, () => {
    pushing.open();
    return push.closed;
  });
  await context.setOffline(false);
  await online(page);
  await pushing.closed;
  await expect(editor(page)).not.toContainText("from the mac");

  await typeAtStart(page, "from the phone ");
  await page.waitForTimeout(500);
  push.open();
  await backToHome(page);
  await expect(synced(page)).toBeVisible({ timeout: 30_000 });

  expect(github.read(POTATO)).toContain("from the mac");
  const copy = github.paths().find((path) => path.includes("roast-potatoes (phone conflict"));
  expect(copy).toBeTruthy();
  expect(github.read(copy!.replace("vault/", ""))).toContain("from the phone");
});

test("undo can't take back a change from elsewhere", async ({ page }) => {
  await connect(page);
  await openRecipe(page, "Roast potatoes");
  github.write(POTATO, "# Roast potatoes\n\nfrom the mac\n");
  await online(page);
  await expect(editor(page)).toContainText("from the mac");
  await button(page, "Undo").click();
  await page.waitForTimeout(500);
  await expect(editor(page)).toContainText("from the mac");
  await expect(status(page)).toHaveText("Synced");
});

test("a request that never answers doesn't stop sync for good", async ({ page }) => {
  test.setTimeout(90_000);
  await connect(page);
  const never = gate();
  github.holdNext(/^GET \/git\/ref\//, () => never.closed);
  await online(page);
  await expect(button(page, /Syncing/)).toBeVisible();
  await page.waitForTimeout(500);
  github.write(POTATO, "# Roast potatoes\n\nfrom the mac\n");
  await online(page);
  await openRecipe(page, "Roast potatoes");
  await expect(editor(page)).toContainText("from the mac", { timeout: 45_000 });
});

const BREAKABLE_STORAGE = () => {
  const open = new Set<IDBDatabase>();
  const dead = new WeakSet<IDBDatabase>();
  const original = IDBDatabase.prototype.transaction;
  const flags = window as unknown as { storageDown?: boolean; dropConnections?: () => void };
  flags.dropConnections = () => open.forEach((db) => dead.add(db));
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof original>) {
    open.add(this);
    if (flags.storageDown || dead.has(this)) throw new DOMException("closing", "InvalidStateError");
    return original.apply(this, args);
  } as typeof original;
};
const setStorageDown = (page: Page, down: boolean) =>
  page.evaluate((value) => {
    (window as unknown as { storageDown: boolean }).storageDown = value;
  }, down);

test("a connection iOS dropped silently is reopened", async ({ page }) => {
  await page.addInitScript(BREAKABLE_STORAGE);
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await page.evaluate(() => (window as unknown as { dropConnections: () => void }).dropConnections());
  await typeAtStart(page, "after the drop ");
  await expect(status(page)).toHaveText("Not synced");
  await button(page, "Back").click();
  await expect.poll(() => github.read(TOMATO)).toContain("after the drop");
});

test("sync carries on after storage fails during a run", async ({ page }) => {
  await page.addInitScript(BREAKABLE_STORAGE);
  await connect(page);
  github.holdNext(/^GET \/git\/ref\//, () => setStorageDown(page, true));
  await online(page);
  await expect(button(page, /Sync failed|Syncing/)).toBeVisible();
  await page.waitForTimeout(1_000);
  await setStorageDown(page, false);
  github.write(POTATO, "# Roast potatoes\n\nfrom the mac\n");
  await online(page);
  await openRecipe(page, "Roast potatoes");
  await expect(editor(page)).toContainText("from the mac", { timeout: 10_000 });
});

test("back won't leave a note it couldn't save", async ({ page }) => {
  await page.addInitScript(BREAKABLE_STORAGE);
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await setStorageDown(page, true);
  await typeAtStart(page, "precious words ");
  await expect(status(page)).toHaveText("Couldn't save");
  await button(page, "Back").click();
  await page.waitForTimeout(500);
  await expect(editor(page)).toContainText("precious words");

  await setStorageDown(page, false);
  await button(page, "Back").click();
  await button(page, "Tomato soup").click();
  await expect(editor(page)).toContainText("precious words");
});

test("an expired key can be replaced without losing unsynced writing", async ({ page, context }) => {
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await context.setOffline(true);
  await typeAtStart(page, "written offline ");
  await expect(status(page)).toHaveText("Not synced");
  await backToHome(page);
  github.token = "renewed-key";
  await context.setOffline(false);
  await online(page);
  await expect(button(page, /rejected the key/)).toBeVisible();

  await button(page, "Settings").click();
  await page.getByLabel("New GitHub key").fill("still-wrong");
  await button(page, "Replace key").click();
  await expect(page.getByRole("alert")).toContainText("rejected");
  await page.getByLabel("New GitHub key").fill("renewed-key");
  await button(page, "Replace key").click();
  await expect.poll(() => github.read(TOMATO)).toContain("written offline");
  await expect(synced(page)).toBeVisible();

  await page.reload();
  await expect(synced(page)).toBeVisible();
});

test("disconnecting during a sync still erases the phone copy", async ({ page }) => {
  await connect(page);
  const release = gate();
  github.holdNext(/^GET \/git\/ref\//, () => release.closed);
  await online(page);
  await button(page, "Settings").click();
  await button(page, "Disconnect this phone").click();
  await button(page, "Disconnect").click();
  await expect(page.getByLabel("GitHub key")).toBeVisible();
  release.open();
  await page.waitForTimeout(1_000);
  const databases = await page.evaluate(() => indexedDB.databases());
  expect(databases.map((db) => db.name)).toEqual([]);
});


test("moving a note saves the last keystrokes, follows the new path, and survives reload", async ({ page }) => {
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Finished.");
  await button(page, "Move note").click();
  await page.getByLabel("Destination folder").selectOption("workshop");
  await button(page, "Move").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor(page)).toContainText("Finished.");
  expect(github.read(TOMATO)).toBeUndefined();
  expect(github.read("workshop/tomato-soup.md")).toContain("Finished.");
  expect(github.messages.filter((message) => message.startsWith("phone: move"))).toHaveLength(1);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" More.");
  await button(page, "Back").click();
  await expect(button(page, "Tomato soup")).toBeVisible();
  await expect(synced(page)).toBeVisible();
  expect(github.read("workshop/tomato-soup.md")).toContain("Finished. More.");
  await page.reload();
  await expect(synced(page)).toBeVisible();
  await button(page, /^Workshop/).click();
  await button(page, "Tomato soup").click();
  await expect(editor(page)).toContainText("Finished. More.");
  expect(github.read(TOMATO)).toBeUndefined();
});

test("a move collision shows an error and preserves both notes", async ({ page }) => {
  github.write("workshop/tomato-soup.md", "# Existing soup\n");
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await button(page, "Move note").click();
  await page.getByLabel("Destination folder").selectOption("workshop");
  await button(page, "Move").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("already exists");
  expect(github.read(TOMATO)).toContain("Simmer.");
  expect(github.read("workshop/tomato-soup.md")).toBe("# Existing soup\n");
  await button(page, "Cancel").click();
  await expect(editor(page)).toContainText("Simmer.");
});

test("Home clears search and folder navigation, while Back keeps search results", async ({ page }) => {
  await connect(page);
  await button(page, /^Free text/).click();
  await button(page, /^Recipes/).click();
  await page.getByLabel("Search notes").fill("potatoes");
  await button(page, /^Roast potatoes/).click();
  await button(page, "Back").click();
  await expect(page.getByLabel("Search notes")).toHaveValue("potatoes");
  await button(page, "Home").click();
  await expect(page.getByLabel("Search notes")).toHaveValue("");
  await expect(button(page, /^Free text/)).toBeVisible();
  await expect(button(page, /^Workshop/)).toBeVisible();
  await expect(button(page, "Up a folder")).toHaveCount(0);
  await button(page, "Settings").click();
  await button(page, "Home").click();
  await expect(button(page, /^Free text/)).toBeVisible();
});

test("Home saves the last keystrokes and leaves a search result for the library root", async ({ page }) => {
  await connect(page);
  await page.getByLabel("Search notes").fill("potatoes");
  await button(page, /^Roast potatoes/).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Saved by Home.");
  await button(page, "Home").click();
  await expect(page.getByLabel("Search notes")).toHaveValue("");
  await expect(button(page, /^Free text/)).toBeVisible();
  await expect(synced(page)).toBeVisible();
  expect(github.read(POTATO)).toContain("Saved by Home.");
});

test("Home keeps the editor open if the writing couldn't be saved", async ({ page }) => {
  await page.addInitScript(BREAKABLE_STORAGE);
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await setStorageDown(page, true);
  await typeAtStart(page, "keep these words ");
  await expect(status(page)).toHaveText("Couldn't save");
  await button(page, "Home").click();
  await expect(editor(page)).toContainText("keep these words");
  await expect(page.getByLabel("Search notes")).toHaveCount(0);
  await setStorageDown(page, false);
  await button(page, "Home").click();
  await expect(synced(page)).toBeVisible();
  expect(github.read(TOMATO)).toContain("keep these words");
});

test("Move is visible and can move a note into a nested completed folder", async ({ page }) => {
  github.write("workshop/completed/blog-posts/another.md", "# Another post\n");
  await connect(page);
  await openRecipe(page, "Tomato soup");
  await expect(button(page, "Move note")).toContainText("Move");
  await button(page, "Move note").click();
  await page.getByLabel("Destination folder").selectOption("workshop/completed/blog-posts");
  await button(page, "Move").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".note-folder")).toHaveText("Workshop / Completed / Blog posts");
  expect(github.read("workshop/completed/blog-posts/tomato-soup.md")).toContain("Simmer.");
  expect(github.read(TOMATO)).toBeUndefined();
  await button(page, "Home").click();
  await expect(button(page, /^Workshop/)).toBeVisible();
});

test("the redesigned shelves fit a small phone and Home stays visible", async ({ page }, testInfo) => {
  github.write("knowledge/ideas.md", "# Ideas\n");
  github.write("Diary/daily/2026/11/2026-11-11.md", "# 11/11\n");
  await page.setViewportSize({ width: 320, height: 568 });
  await connect(page);
  const titles = page.locator(".shelf-grid .folder .row-title");
  await expect(titles).toHaveCount(4);
  expect(await titles.evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth))).toBe(true);
  await expect(button(page, "Home")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home-320.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecipe(page, "Tomato soup");
  await button(page, "Home").click();
  await expect(synced(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("home-390.png") });
});
