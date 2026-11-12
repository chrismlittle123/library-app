// Raster exports of the same vector master, with an opaque, full-square ground
// for iOS to mask. Run: node scripts/build-icons.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const publicDir = new URL("../public/", import.meta.url);
const svg = await readFile(new URL("library-mark.svg", publicDir), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  for (const [size, name] of [[180, "apple-touch-icon.png"], [192, "pwa-192.png"], [512, "pwa-512.png"]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#553437}svg{width:100vw;height:100vh;display:block}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(name, publicDir)) });
    await page.close();
  }
} finally {
  await browser.close();
}
