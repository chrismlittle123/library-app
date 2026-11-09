import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fakeGitHub";

// The service worker would hide the app's requests from the fake GitHub.
test.use({ serviceWorkers: "block" });

const TOMATO = "catalogues/recipes/tomato-soup.md";
const POTATO = "catalogues/recipes/roast-potatoes.md";

let github: FakeGitHub;

test.beforeEach(async ({ page }) => {
  github = new FakeGitHub({
    [`vault/${TOMATO}`]: "# Tomato soup\n\nSimmer.\n",
    [`vault/${POTATO}`]: "# Roast potatoes\n\nRoast.\n",
    "vault/workshop/idea.md": "# Idea\n",
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

async function openRecipe(page: Page, title: string) {
  await button(page, /^catalogues/).click();
  await button(page, /^recipes/).click();
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
  await button(page, /^workshop/).click();
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
  await openRecipe(page, "tomato-soup");
  await context.setOffline(true);
  await typeAtStart(page, "other edit ");
  await expect(status(page)).toHaveText("Not synced");
  await button(page, "Back").click();
  await button(page, "roast-potatoes").click();
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
  await openRecipe(page, "roast-potatoes");
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
  await openRecipe(page, "roast-potatoes");
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
  await openRecipe(page, "tomato-soup");
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
  await openRecipe(page, "roast-potatoes");
  await expect(editor(page)).toContainText("from the mac", { timeout: 10_000 });
});

test("back won't leave a note it couldn't save", async ({ page }) => {
  await page.addInitScript(BREAKABLE_STORAGE);
  await connect(page);
  await openRecipe(page, "tomato-soup");
  await setStorageDown(page, true);
  await typeAtStart(page, "precious words ");
  await expect(status(page)).toHaveText("Couldn't save");
  await button(page, "Back").click();
  await page.waitForTimeout(500);
  await expect(editor(page)).toContainText("precious words");

  await setStorageDown(page, false);
  await button(page, "Back").click();
  await button(page, "tomato-soup").click();
  await expect(editor(page)).toContainText("precious words");
});

test("an expired key can be replaced without losing unsynced writing", async ({ page, context }) => {
  await connect(page);
  await openRecipe(page, "tomato-soup");
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
