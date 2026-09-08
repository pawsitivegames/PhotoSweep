// Integration E2E tests — no Google Photos auth required.
// Run: npm run test:integration
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/e2e/integration",
  timeout: 30_000,
  retries: 0,
  // One Chromium extension context per worker; parallel workers flake on
  // Target.createTarget / closed-context helper tabs under Xvfb.
  workers: 1,
  reporter: "list",
  projects: [
    {
      name: "chromium-extension",
      use: { headless: false },
    },
  ],
})
