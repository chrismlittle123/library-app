import { defineConfig, devices } from "@playwright/test";

// These run against the real GitHub API and the private throwaway repo, using the
// production build. WebKit is the closest engine to iOS Safari, but has no
// on-screen keyboard, so keyboard behaviour still needs a real iPhone.
//   LIBRARY_TEST_TOKEN=$(gh auth token) npm run test:e2e
export default defineConfig({
  testDir: "./e2e",
  reporter: [["list"]],
  workers: 1,
  timeout: 180_000,
  use: { baseURL: "http://localhost:5175" },
  webServer: {
    command: "npm run build && npm run preview -- --port 5175 --strictPort",
    url: "http://localhost:5175",
    reuseExistingServer: false,
  },
  projects: [{ name: "iPhone 14", use: { ...devices["iPhone 14"] } }],
});
