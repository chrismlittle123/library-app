import { expect, test } from "@playwright/test";

const content = (page: import("@playwright/test").Page) => page.locator(".cm-content");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(content(page)).toContainText("What to test");
});

test("fits the screen without sideways scrolling", async ({ page }) => {
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
  const toolbar = await page.getByRole("navigation", { name: "Formatting" }).boundingBox();
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test("keeps typing across a reload", async ({ page }) => {
  await page.getByLabel("Note").selectOption("diary");
  await content(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("Fresh words. ");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(content(page)).toContainText("Fresh words.");
});

test("the toolbar formats text and keeps focus", async ({ page }) => {
  await page.getByLabel("Note").selectOption("diary");
  await content(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.getByRole("button", { name: "Bold" }).click();
  await page.keyboard.type("loud");
  await expect(content(page)).toContainText("**loud**");
  await page.getByRole("button", { name: "Undo" }).click();
});

test("Enter carries a list on", async ({ page }) => {
  await page.getByLabel("Note").selectOption("recipe");
  await page.locator(".cm-line", { hasText: "2 tins of tomatoes" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("salt");
  await expect(content(page)).toContainText("- salt");
});

test("Aa hides symbols except on the cursor's line", async ({ page }) => {
  await page.getByLabel("Note").selectOption("recipe");
  await expect(content(page)).toContainText("# Tomato soup");
  await page.getByRole("button", { name: "Hide markdown symbols" }).click();
  await expect(content(page)).not.toContainText("# Tomato soup");
  await expect(content(page)).toContainText("Tomato soup");
  await page.locator(".cm-line", { hasText: "Tomato soup" }).click();
  await expect(content(page)).toContainText("# Tomato soup");
});

test("Reset restores the sample", async ({ page }) => {
  await page.getByLabel("Note").selectOption("diary");
  await content(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("Throwaway. ");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(content(page)).not.toContainText("Throwaway.");
  await page.reload();
  await expect(content(page)).not.toContainText("Throwaway.");
});
