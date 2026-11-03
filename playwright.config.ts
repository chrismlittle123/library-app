import { defineConfig, devices } from "@playwright/test";

// WebKit is the closest engine to iOS Safari, but it has no on-screen keyboard:
// keyboard behaviour can only be judged on a real iPhone.
export default defineConfig({
  testDir: "./e2e",
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5175" },
  webServer: {
    command: "npm run dev -- --port 5175 --strictPort",
    url: "http://localhost:5175",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "iPhone 14", use: { ...devices["iPhone 14"] } },
    { name: "iPhone SE", use: { ...devices["iPhone SE"] } },
  ],
});
