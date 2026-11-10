import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com https://openbanking.chris-little.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// base: "./" keeps the bundle path-relative, for GitHub Pages subpaths and the
// iOS home screen.
export default defineConfig({
  base: "./",
  define: {
    __BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? "local").slice(0, 7)),
  },
  plugins: [
    react(),
    {
      // Build only, because the dev server relies on inline scripts. The GitHub key
      // lives in this page, so it may only ever talk to itself, GitHub and the server
      // that logs reviews.
      name: "content-security-policy",
      apply: "build",
      transformIndexHtml: () => [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
          injectTo: "head-prepend",
        },
      ],
    },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      // The font too, or an offline app falls back to Georgia.
      workbox: { globPatterns: ["**/*.{js,css,html,woff2}"] },
      manifest: {
        name: "Library",
        short_name: "Library",
        description: "A phone editor for a git-backed library",
        theme_color: "#1a1410",
        background_color: "#1a1410",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
