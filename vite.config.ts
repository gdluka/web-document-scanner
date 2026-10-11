import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
export default defineConfig({
  base: process.env.SCANNER_BASE || '/',
  plugins: [solid()],
  server: { host: '0.0.0.0', allowedHosts: true },
  build: { target: 'es2022' },
})
