import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const base = process.env.SCANNER_BASE || '/'
const manifest = { name: "A Bob's Scan", short_name: "A Bob's Scan", start_url: base, scope: base, display: 'standalone', background_color: '#f5f6f3', theme_color: '#176d66', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }
await writeFile('dist/manifest.webmanifest', JSON.stringify(manifest))
const assets = ['index.html', 'icon.svg', 'manifest.webmanifest', ...(await readdir('dist/assets')).map(file => `assets/${file}`)]
const version = createHash('sha256')
version.update(await readFile('public/service-worker.js'))
for (const file of assets) version.update(await readFile(`dist/${file}`))
// Changing a vendor engine also invalidates the previous offline cache.
for (const file of ['document-scanner/image-worker-v1.js', 'document-scanner/burst-worker-v1.js', 'document-scanner/process.8010e3f6.js', 'document-scanner/scanner_bg.0b3074af.wasm', 'opencv/opencv-5.0.0.js']) version.update(await readFile(`dist/vendor/${file}`))
const prefix = `const VERSION = ${JSON.stringify(version.digest('hex').slice(0, 12))};\nconst APP_ASSETS = ${JSON.stringify(assets)};\n`
await writeFile('dist/service-worker.js', prefix + await readFile('public/service-worker.js', 'utf8'))
