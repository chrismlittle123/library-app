// Open the app in Chrome as an iPhone: its screen size, pixel density, touch
// and Safari's user agent, so you can see and use it as your phone would.
//
//   npm run phone                        the local preview (started for you)
//   npm run phone -- --live              the deployed app
//   npm run phone -- --device "iPhone 15"  any iPhone Playwright knows
//
// Once connected with a real GitHub key, this is the real thing: edits reach the
// notes repo and finished reviews are logged for Sumi, as on the phone.
//
// It's Chrome's engine, not Safari's, and the notch isn't drawn (the safe-area
// insets are 0): close enough for layout and type, not a pixel-exact iPhone.
// The browser profile is kept between runs, so the preview remembers its cache
// and queue as an installed app would.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, devices } from "@playwright/test";
import { createServer } from "vite";

const DEFAULT_DEVICE = "iPhone 16e";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = resolve(ROOT, "node_modules/.cache/phone-profile");
const LIVE = "https://chrismlittle123.github.io/library-app/";

// A `-- …` separator can be passed through; it isn't an argument.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    live: { type: "boolean", default: false },
    device: { type: "string", default: DEFAULT_DEVICE },
    url: { type: "string" },
  },
});

const device = devices[values.device];
if (!device) {
  const iphones = Object.keys(devices).filter((d) => d.startsWith("iPhone") && !d.endsWith("landscape"));
  console.error(`✗ no device "${values.device}". Try one of: ${iphones.join(", ")}`);
  process.exit(1);
}
// The descriptor asks for WebKit; we want Chrome with the iPhone's settings.
const phone = { ...device };
delete phone.defaultBrowserType;

// The preview: a dev server of its own, on whichever port is free.
const server = values.live || values.url ? null : await createServer({ root: ROOT, logLevel: "warn" });
if (server) await server.listen();
const url = values.url ?? (values.live ? LIVE : server.resolvedUrls.local[0]);
const { width, height } = phone.viewport;

const context = await chromium.launchPersistentContext(PROFILE, {
  ...phone,
  channel: "chrome",
  headless: false,
  // The window is the phone plus Chrome's own toolbar.
  args: [`--window-size=${width + 20},${height + 140}`],
});
const page = context.pages()[0] ?? (await context.newPage());

try {
  await page.goto(url);
} catch {
  console.error(`✗ couldn't open ${url}`);
  await context.close();
  await server?.close();
  process.exit(1);
}

console.log(`✓ ${values.device} (${width}×${height}) → ${url}`);
console.log("  close the window to quit");
await new Promise((done) => context.on("close", done));
await server?.close();
