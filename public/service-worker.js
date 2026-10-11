/* The production build prepends VERSION and APP_ASSETS. */
const ROOT = new URL('./', self.location.href)
const CACHE_PREFIX = `document-scanner:${ROOT.pathname}:`
const CACHE = `${CACHE_PREFIX}${typeof VERSION === 'undefined' ? 'development' : VERSION}`
const ENGINES = ['vendor/document-scanner/burst-worker-v1.js', 'vendor/document-scanner/image-worker-v1.js', 'vendor/document-scanner/neural-corners-worker-v1.js', 'vendor/docaligner/docaligner-lcnet100-f4117b78.onnx', 'vendor/document-scanner/process.8010e3f6.js', 'vendor/document-scanner/scanner_bg.0b3074af.wasm', 'vendor/opencv/opencv-5.0.0.js']
const urlFor = path => new URL(path, ROOT).href
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll((typeof APP_ASSETS === 'undefined' ? ['index.html'] : APP_ASSETS).map(urlFor))
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name)
    await self.clients.claim()
  })())
})
self.addEventListener('message', event => {
  if (event.data?.type !== 'PWA_PREPARE_SCANNER') return
  event.waitUntil((async () => {
    try { await (await caches.open(CACHE)).addAll(ENGINES.map(urlFor)); event.ports[0]?.postMessage({ ok: true }) }
    catch { event.ports[0]?.postMessage({ ok: false }) }
  })())
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    if (event.request.mode === 'navigate') {
      try { const response = await fetch(event.request); if (response.ok) await cache.put(urlFor('index.html'), response.clone()); return response }
      catch { return await cache.match(urlFor('index.html'), { ignoreVary: true }) || Response.error() }
    }
    // Static files are identical for every same-origin visitor. Some preview
    // servers add Vary: Origin, which must not prevent a cached offline hit.
    const saved = await cache.match(event.request, { ignoreVary: true })
    if (saved) return saved
    const response = await fetch(event.request)
    if (response.ok) await cache.put(event.request, response.clone())
    return response
  })())
})
