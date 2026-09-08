import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: /final-runtime-probes\.spec\.ts$/,
  timeout: 30_000,
  retries: 0,
  reporter: "list",
  workers: 1,
  projects: [{ name: "chromium-extension", use: { headless: false } }]
})
