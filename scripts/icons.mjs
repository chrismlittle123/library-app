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

// An open book on a warm, lamp-lit ground: cream pages over a gilt cover, a
// ribbon bookmark hanging from the bottom, and a soft shadow beneath.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="ground" cx="50%" cy="28%" r="80%">
      <stop offset="0" stop-color="#5a3a24"/>
      <stop offset="0.55" stop-color="#2c1d13"/>
      <stop offset="1" stop-color="#170f0a"/>
    </radialGradient>
    <linearGradient id="cover" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e6ad62"/>
      <stop offset="1" stop-color="#9c6328"/>
    </linearGradient>
    <linearGradient id="pageLeft" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fbf2e2"/>
      <stop offset="0.82" stop-color="#efe0c6"/>
      <stop offset="1" stop-color="#cdb594"/>
    </linearGradient>
    <linearGradient id="pageRight" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#fdf5e7"/>
      <stop offset="0.82" stop-color="#f1e3ca"/>
      <stop offset="1" stop-color="#d2bb9a"/>
    </linearGradient>
    <linearGradient id="ribbon" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b8402f"/>
      <stop offset="1" stop-color="#7a231a"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>
  <rect width="512" height="512" fill="url(#ground)"/>
  <ellipse cx="256" cy="398" rx="176" ry="20" fill="#000" opacity="0.45" filter="url(#soft)"/>
  <path d="M66 178Q150 150 256 182Q362 150 446 178L446 376Q362 352 256 386Q150 352 66 376Z" fill="url(#cover)"/>
  <path d="M78 368Q160 344 252 374M80 360Q162 336 252 366" fill="none" stroke="#f3e4c8" stroke-width="3" opacity="0.8"/>
  <path d="M260 374Q352 344 434 368M260 366Q350 336 432 360" fill="none" stroke="#f3e4c8" stroke-width="3" opacity="0.8"/>
  <path d="M82 162Q172 130 252 166L252 360Q172 328 82 352Z" fill="url(#pageLeft)"/>
  <path d="M260 166Q340 130 430 162L430 352Q340 328 260 360Z" fill="url(#pageRight)"/>
  <path d="M256 176L256 360" stroke="#8a6a45" stroke-width="3" opacity="0.45"/>
  <g fill="none" stroke="#bda585" stroke-width="5.5" stroke-linecap="round" opacity="0.7">
    <path d="M112 200Q170 184 226 204"/>
    <path d="M112 236Q170 220 226 240"/>
    <path d="M112 272Q170 256 226 276"/>
    <path d="M112 308Q150 297 186 306"/>
    <path d="M286 204Q342 184 400 200"/>
    <path d="M286 240Q342 220 400 236"/>
    <path d="M286 276Q342 256 400 272"/>
  </g>
  <path d="M244 360L268 360L268 446L256 432L244 446Z" fill="url(#ribbon)"/>
  <path d="M244 360L268 360L268 368L244 368Z" fill="#000" opacity="0.18"/>
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
