import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: /(^|\/)local-ux-review\.spec\.ts$/,
  timeout: 40_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  projects: [
    {
      name: "chromium-extension",
      use: { headless: false }
    }
  ]
})
