// Render the app icons from one SVG: an open book, full-bleed so iOS can apply
// its own corner mask. Run after changing the design; the PNGs in public/ are
// committed.
//
//   node scripts/icons.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webkit } from "@playwright/test";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

const LEFT = "M256 168C214 134 150 124 88 132V372C150 364 214 374 256 408Z";
const RIGHT = "M256 168C298 134 362 124 424 132V372C362 364 298 374 256 408Z";
const line = (x1, y1, x2, y2, colour) =>
  `<path d="M${x1} ${y1}Q${(x1 + x2) / 2} ${(y1 + y2) / 2 - 8} ${x2} ${y2}" fill="none" stroke="${colour}" stroke-width="12" stroke-linecap="round"/>`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1a1410"/>
  <g stroke="#e0a15c" stroke-width="14" stroke-linejoin="round">
    <path d="${LEFT}" fill="#241c15"/>
    <path d="${RIGHT}" fill="#2d241a"/>
  </g>
  ${line(128, 196, 216, 212, "#b0a089")}
  ${line(128, 248, 216, 264, "#b0a089")}
  ${line(128, 300, 186, 310, "#b0a089")}
  ${line(296, 212, 384, 196, "#e0a15c")}
  ${line(296, 264, 384, 248, "#e0a15c")}
</svg>`;

const ICONS = [
  { file: "pwa-192.png", size: 192 },
  { file: "pwa-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

const browser = await webkit.launch();
const page = await browser.newPage();
for (const { file, size } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${SVG}`);
  writeFileSync(resolve(PUBLIC, file), await page.screenshot({ type: "png" }));
  console.log(`wrote public/${file} (${size}×${size})`);
}
await browser.close();
