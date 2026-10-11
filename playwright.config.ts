import { defineConfig } from '@playwright/test'
const url = `http://127.0.0.1:4173${process.env.SCANNER_BASE || '/'}`
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 90_000, reporter: 'list',
  use: { baseURL: url, headless: true },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort', url, reuseExistingServer: false },
})
