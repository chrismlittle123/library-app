import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base: "./" keeps the bundle path-relative, for GitHub Pages subpaths and the
// iOS home screen.
export default defineConfig({
  base: "./",
  define: {
    __BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? "local").slice(0, 7)),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Vault",
        short_name: "Vault",
        description: "A phone editor for a git-backed vault",
        theme_color: "#16151a",
        background_color: "#16151a",
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
