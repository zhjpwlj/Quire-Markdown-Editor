import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
