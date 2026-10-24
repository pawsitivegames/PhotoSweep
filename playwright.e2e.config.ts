// Signed-in, scan-only synthetic-album E2E. See VALIDATION.md for required target/oracle.
// Run: npm run test:e2e; authentication stays in the configured existing Chrome.
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/e2e/full",
  // Generous timeout: real library scans can take several minutes
  timeout: 600_000,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      name: "chromium-extension",
      use: { headless: false },
    },
  ],
})
