import { expect, test, type Page } from '@playwright/test'
async function paper(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 800
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#333'; ctx.fillRect(0, 0, 640, 800)
    ctx.fillStyle = 'white'; ctx.fillRect(35, 25, 570, 750)
    ctx.fillStyle = 'black'; ctx.font = '24px sans-serif'
    for (let i = 0; i < 15; i++) ctx.fillText(`Artículo de prueba ${i + 1}`, 50, 60 + i * 45)
    Object.assign(window, { scannerTestCanvas: canvas })
    return canvas.toDataURL('image/png').split(',')[1]!
  })
}
test('exports a local image and metadata without uploading a document', async ({ page }) => {
  await page.goto('./')
  const encoded = await paper(page), mutations: string[] = []
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url()) })
  await page.getByLabel('Cargar fotografía', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') })
  await page.getByRole('button', { name: 'Usar foto preparada', exact: true }).click()
  await page.getByRole('button', { name: 'Procesar imagen', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Descargar resultado', exact: true })).toBeVisible({ timeout: 60_000 })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar metadatos', exact: true }).click()
  const metadata = await downloaded
  expect(metadata.suggestedFilename()).toBe('documento-metadatos.json')
  const { readFile } = await import('node:fs/promises')
  const data = JSON.parse(await readFile((await metadata.path())!, 'utf8'))
  expect(data.schemaVersion).toBe(1); expect(data.source).toBe('single')
  expect(data.preparation.corners).toBeTruthy(); expect(data.preparation.geometry.homography).toHaveLength(9)
  expect(data.processing.width).toBeGreaterThan(0)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(mutations).toEqual([])
})
test('live outline follows the video and a six-photo burst releases the camera', async ({ page }) => {
  // Chromium cannot resize a native fullscreen window; emulate phone rotation in the viewport fallback.
  await page.addInitScript(() => { Object.defineProperty(Element.prototype, 'requestFullscreen', { value: () => Promise.reject(new Error('Viewport rotation test')) }) })
  await page.goto('./'); await paper(page)
  await page.evaluate(() => {
    const canvas = (window as unknown as { scannerTestCanvas: HTMLCanvasElement }).scannerTestCanvas
    const stream = canvas.captureStream(10)
    const repaint = setInterval(() => { const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#333'; ctx.fillRect(0, 0, 1, 1); if (stream.getTracks().every(track => track.readyState === 'ended')) clearInterval(repaint) }, 100)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } })
    Object.defineProperty(window, 'ImageCapture', { configurable: true, value: class {
      takePhoto() { return new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png')) }
    } })
    Object.assign(window, { scannerTestStream: stream })
  })
  await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
  const camera = page.getByRole('dialog', { name: 'Cámara de documentos', exact: true })
  await expect(camera).toBeVisible()
  const outline = page.getByLabel('Bordes detectados en cámara', { exact: true })
  await expect(outline).toBeVisible({ timeout: 30_000 })
  for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    const video = await page.getByLabel('Vista previa de la cámara', { exact: true }).boundingBox(), box = await outline.boundingBox()
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(video![key] - box![key])).toBeLessThan(1)
    expect(video!.width / video!.height).toBeCloseTo(.8, 2)
    const dialog = await camera.boundingBox()
    expect(dialog).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height })
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
    expect(Math.min(Math.abs(video!.width - viewport.width), Math.abs(video!.height - viewport.height))).toBeLessThan(1)
    for (const name of ['Capturar una foto', 'Capturar 6 fotos', 'Cerrar cámara']) {
      const control = await camera.getByRole('button', { name, exact: true }).boundingBox()
      expect(control!.x).toBeGreaterThanOrEqual(0); expect(control!.y).toBeGreaterThanOrEqual(0)
      expect(control!.x + control!.width).toBeLessThanOrEqual(viewport.width)
      expect(control!.y + control!.height).toBeLessThanOrEqual(viewport.height)
    }
  }
  await page.getByRole('button', { name: 'Capturar 6 fotos', exact: true }).click()
  await expect(page.getByText('Combinación de la ráfaga', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(camera).toHaveCount(0)
  expect(await page.evaluate(() => ({ overflow: document.body.style.overflow, fullscreen: !!document.fullscreenElement }))).toEqual({ overflow: '', fullscreen: false })
  expect(await page.evaluate(() => (window as unknown as { scannerTestStream: MediaStream }).scannerTestStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true)
  await page.getByRole('button', { name: 'Confirmar bordes y mejorar', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Descargar resultado', exact: true })).toBeVisible({ timeout: 60_000 })
})
test('production shell and all image engines remain available offline', async ({ page, context }) => {
  await page.goto('./')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  await page.getByRole('button', { name: 'Preparar para usar sin conexión', exact: true }).click()
  await expect(page.getByText('Motores descargados. Para verificar el modo offline, reabrí esta página sin conexión desde la PWA.', { exact: true })).toBeVisible({ timeout: 60_000 })
  await context.setOffline(true); await page.reload()
  await expect(page.getByRole('heading', { name: 'Escáner de documentos', exact: true })).toBeVisible()
  const encoded = await paper(page)
  await page.getByLabel('Cargar fotografía', { exact: true }).setInputFiles({ name: 'offline.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') })
  await page.getByRole('button', { name: 'Usar foto preparada', exact: true }).click()
  await page.getByRole('button', { name: 'Procesar imagen', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Descargar resultado', exact: true })).toBeVisible({ timeout: 60_000 })
})

async function singleCamera(page: Page, nativePhoto: boolean, blank = false) {
  await paper(page)
  await page.evaluate(async ({ nativePhoto, blank }) => {
    const canvas = (window as unknown as { scannerTestCanvas: HTMLCanvasElement }).scannerTestCanvas
    if (blank) { const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(35, 25, 570, 750) }
    const stream = canvas.captureStream(10), track = stream.getVideoTracks()[0]!
    const calls: unknown[] = [], photos: unknown[] = []
    Object.defineProperty(track, 'getCapabilities', { value: () => nativePhoto ? { focusMode: ['continuous'] } : {} })
    Object.defineProperty(track, 'getConstraints', { value: () => ({ width: { ideal: 2560 } }) })
    Object.defineProperty(track, 'applyConstraints', { value: async (value: unknown) => { calls.push(value) } })
    const repaint = setInterval(() => { const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#333'; ctx.fillRect(0, 0, 1, 1); if (track.readyState === 'ended') clearInterval(repaint) }, 100)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream, getSupportedConstraints: () => ({ pointsOfInterest: nativePhoto }) } })
    // Prebuild the synthetic still so the native-camera mock does not depend on canvas idle encoding in fullscreen.
    const full = document.createElement('canvas'); full.width = 1280; full.height = 1600
    full.getContext('2d')!.drawImage(canvas, 0, 0, full.width, full.height)
    const still = nativePhoto ? await new Promise<Blob>(resolve => full.toBlob(blob => resolve(blob!), 'image/png')) : null
    Object.defineProperty(window, 'ImageCapture', { configurable: true, value: nativePhoto ? class {
      getPhotoCapabilities() { return Promise.resolve({ imageWidth: { max: 1280 }, imageHeight: { max: 1600 } }) }
      takePhoto(settings: unknown) {
        photos.push(settings)
        return Promise.resolve(still!)
      }
    } : undefined })
    Object.assign(window, { scannerSingleTest: { stream, calls, photos } })
  }, { nativePhoto, blank })
}

test('single-photo capture preserves verified preview detail and native still resolution', async ({ page }) => {
  await page.goto('./'); await singleCamera(page, true)
  await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true)
  await expect(page.getByText('Hoja estable y con detalle. Lista para capturar.', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Capturar una foto', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toBeVisible({ timeout: 30_000 })
  const result = await page.evaluate(() => {
    const test = (window as unknown as { scannerSingleTest: { stream: MediaStream; calls: Array<{ advanced: Array<{ focusMode: string; pointsOfInterest?: unknown[] }> }>; photos: unknown[] } }).scannerSingleTest
    const image = document.querySelector<HTMLImageElement>('img[alt="Foto original del documento"]')!
    return { stopped: test.stream.getTracks().every(t => t.readyState === 'ended'), calls: test.calls, photos: test.photos, width: image.naturalWidth, height: image.naturalHeight }
  })
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  expect(result.stopped).toBe(true); expect(result.photos).toEqual([{ imageWidth: 1280, imageHeight: 1600 }])
  expect(result.calls.some(c => c.advanced.some(a => a.focusMode === 'continuous' && a.pointsOfInterest?.length === 1))).toBe(true)
  expect([result.width, result.height]).toEqual([1280, 1600])
  await expect(page.getByText('Combinación de la ráfaga', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Usar foto preparada', exact: true }).click()
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar metadatos', exact: true }).click()
  const { readFile } = await import('node:fs/promises')
  expect(JSON.parse(await readFile((await (await download).path())!, 'utf8')).source).toBe('single')
})

test('unconfirmed detail does not block capture or raise an error without focus or ImageCapture', async ({ page }) => {
  await page.goto('./'); await singleCamera(page, false, true)
  await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
  await expect(page.getByText(/La cámara administra el enfoque/)).toBeVisible()
  await page.getByRole('button', { name: 'Capturar una foto', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toBeVisible({ timeout: 8_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Foto capturada. Revisá que el texto se lea y ajustá las esquinas si hace falta.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { scannerSingleTest: { stream: MediaStream } }).scannerSingleTest.stream.getTracks().every(t => t.readyState === 'ended'))).toBe(true)
})

test('cancelling single-photo readiness releases the camera without replacing the document', async ({ page }) => {
  await page.goto('./'); const encoded = await paper(page)
  await page.getByLabel('Cargar fotografía', { exact: true }).setInputFiles({ name: 'retained.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') })
  const source = await page.getByRole('img', { name: 'Foto original del documento', exact: true }).getAttribute('src')
  await singleCamera(page, false, true)
  await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
  await page.getByRole('button', { name: 'Capturar una foto', exact: true }).click()
  await page.getByRole('button', { name: 'Cancelar captura', exact: true }).click()
  await expect(page.getByLabel('Vista previa de la cámara', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toHaveAttribute('src', source!)
  expect(await page.evaluate(() => (window as unknown as { scannerSingleTest: { stream: MediaStream } }).scannerSingleTest.stream.getTracks().every(t => t.readyState === 'ended'))).toBe(true)
})


test.describe('capture with unavailable live detection', () => {
  // The offline worker owns vendor requests, so block it here to exercise the injected detector.
  test.use({ serviceWorkers: 'block' })

  test('slow border detection does not block taking a photo', async ({ page }) => {
    let detectorRequests = 0
    await page.route('**/vendor/document-scanner/process.8010e3f6.js', async route => {
      detectorRequests++
      const response = await route.fetch(), source = await response.text()
      const send = 'self.postMessage({result:e,...r},n||[])'
      expect(source).toContain(send)
      await route.fulfill({ response, body: source.replace(send, 'setTimeout(()=>self.postMessage({result:e,...r},n||[]),1800)') })
    })
    await page.goto('./'); await singleCamera(page, true)
    await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
    await page.getByRole('button', { name: 'Capturar una foto', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toBeVisible({ timeout: 15_000 })
    expect(detectorRequests).toBeGreaterThan(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })


  test('failed live border detection remains advice and does not block the shutter', async ({ page }) => {
    await page.route('**/vendor/document-scanner/process.8010e3f6.js', route => route.fulfill({
      contentType: 'application/javascript',
      body: "self.onmessage = event => self.postMessage({ id: event.data.id, error: { message: 'Synthetic detector failure' } })",
    }))
    await page.goto('./'); await singleCamera(page, true)
    await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
    await expect(page.getByText(/No se pudieron detectar los bordes en vivo/)).toBeVisible()
    await page.getByRole('button', { name: 'Capturar una foto', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toBeVisible({ timeout: 8_000 })
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText('Foto capturada. Revisá que el texto se lea y ajustá las esquinas si hace falta.', { exact: true })).toBeVisible()
  })

})


test('fullscreen fallback covers the viewport and Escape releases the camera', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: () => Promise.reject(new Error('Fullscreen unavailable')) })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./'); await singleCamera(page, true)
  await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
  const camera = page.getByRole('dialog', { name: 'Cámara de documentos', exact: true })
  await expect(camera).toBeVisible()
  expect(await camera.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await page.keyboard.press('Escape')
  await expect(camera).toHaveCount(0)
  expect(await page.evaluate(() => {
    const test = (window as unknown as { scannerSingleTest: { stream: MediaStream } }).scannerSingleTest
    return { stopped: test.stream.getTracks().every(track => track.readyState === 'ended'), overflow: document.body.style.overflow }
  })).toEqual({ stopped: true, overflow: '' })
})


test.describe('stable contour and framing guidance', () => {
  test.use({ serviceWorkers: 'block' })
  test('ignores an isolated shape jump and shows distance advice while allowing capture', async ({ page }) => {
    await page.route('**/vendor/document-scanner/process.8010e3f6.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      let injected = false;
      self.onmessage = event => {
        const { id, msg: { data } } = event.data, stage = data.data[(4 * data.width + 4) * 4];
        let quad = { a: {x:.1,y:.9}, b: {x:.1,y:.1}, c: {x:.9,y:.1}, d: {x:.9,y:.9} };
        if (stage > 140) quad = { a: {x:.3,y:.7}, b: {x:.3,y:.3}, c: {x:.7,y:.3}, d: {x:.7,y:.7} };
        else if (stage > 70 && !injected) { quad.b = {x:.3,y:.12}; injected = true; }
        const result = Object.fromEntries(Object.entries(quad).map(([key, p]) => [key, {x:p.x*data.width,y:p.y*data.height}]));
        self.postMessage({ id, result });
      }` }))
    await page.goto('./'); await singleCamera(page, true)
    await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
    const guidance = page.locator('.scanner-camera-guidance'), polygon = page.getByLabel('Bordes detectados en cámara', { exact: true }).locator('polygon')
    await expect(guidance).toHaveAttribute('data-state', 'good')
    await expect(polygon).toHaveAttribute('stroke', '#00e5b8')
    const points = await polygon.getAttribute('points')
    const changeStage = (stage: number) => page.evaluate(stage => {
      const canvas = (window as unknown as { scannerTestCanvas: HTMLCanvasElement }).scannerTestCanvas
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = `rgb(${stage},${stage},${stage})`; ctx.fillRect(0,0,20,20)
    }, stage)
    await changeStage(100)
    await expect(guidance).toHaveAttribute('data-state', 'checking')
    await expect(polygon).toHaveAttribute('points', points!)
    await expect(polygon).toHaveAttribute('stroke', '#ffc857')
    await expect(guidance).toHaveAttribute('data-state', 'good')
    await changeStage(180)
    await expect(guidance).toHaveAttribute('data-state', 'far')
    await expect(guidance).toContainText('Acercá el teléfono')
    await expect(polygon).toHaveAttribute('stroke', '#ffc857')
    await page.getByRole('button', { name: 'Capturar una foto', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
