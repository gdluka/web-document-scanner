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
  const outline = page.getByLabel('Bordes detectados en cámara', { exact: true })
  await expect(outline).toBeVisible({ timeout: 30_000 })
  for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    const video = await page.getByLabel('Vista previa de la cámara', { exact: true }).boundingBox(), box = await outline.boundingBox()
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(video![key] - box![key])).toBeLessThan(1)
    expect(video!.width / video!.height).toBeCloseTo(.8, 2)
  }
  await page.getByRole('button', { name: 'Capturar 6 fotos', exact: true }).click()
  await expect(page.getByText('Combinación de la ráfaga', { exact: true })).toBeVisible({ timeout: 60_000 })
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
  await page.evaluate(({ nativePhoto, blank }) => {
    const canvas = (window as unknown as { scannerTestCanvas: HTMLCanvasElement }).scannerTestCanvas
    if (blank) { const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(35, 25, 570, 750) }
    const stream = canvas.captureStream(10), track = stream.getVideoTracks()[0]!
    const calls: unknown[] = [], photos: unknown[] = []
    Object.defineProperty(track, 'getCapabilities', { value: () => nativePhoto ? { focusMode: ['continuous'] } : {} })
    Object.defineProperty(track, 'getConstraints', { value: () => ({ width: { ideal: 2560 } }) })
    Object.defineProperty(track, 'applyConstraints', { value: async (value: unknown) => { calls.push(value) } })
    const repaint = setInterval(() => { const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#333'; ctx.fillRect(0, 0, 1, 1); if (track.readyState === 'ended') clearInterval(repaint) }, 100)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream, getSupportedConstraints: () => ({ pointsOfInterest: nativePhoto }) } })
    Object.defineProperty(window, 'ImageCapture', { configurable: true, value: nativePhoto ? class {
      getPhotoCapabilities() { return Promise.resolve({ imageWidth: { max: 1280 }, imageHeight: { max: 1600 } }) }
      takePhoto(settings: unknown) {
        photos.push(settings)
        const full = document.createElement('canvas'); full.width = 1280; full.height = 1600
        full.getContext('2d')!.drawImage(canvas, 0, 0, full.width, full.height)
        return new Promise<Blob>(resolve => full.toBlob(blob => resolve(blob!), 'image/png'))
      }
    } : undefined })
    Object.assign(window, { scannerSingleTest: { stream, calls, photos } })
  }, { nativePhoto, blank })
}

test('single-photo autofocus waits for document detail and uses native still resolution', async ({ page }) => {
  await page.goto('./'); await singleCamera(page, true)
  await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
  await expect(page.getByText(/Enfoque automático solicitado sobre el centro/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Capturar una foto', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toBeVisible({ timeout: 30_000 })
  const result = await page.evaluate(() => {
    const test = (window as unknown as { scannerSingleTest: { stream: MediaStream; calls: Array<{ advanced: Array<{ focusMode: string; pointsOfInterest?: unknown[] }> }>; photos: unknown[] } }).scannerSingleTest
    const image = document.querySelector<HTMLImageElement>('img[alt="Foto original del documento"]')!
    return { stopped: test.stream.getTracks().every(t => t.readyState === 'ended'), calls: test.calls, photos: test.photos, width: image.naturalWidth, height: image.naturalHeight }
  })
  expect(result.stopped).toBe(true); expect(result.photos).toEqual([{ imageWidth: 1280, imageHeight: 1600 }])
  expect(result.calls.some(c => c.advanced.some(a => a.focusMode === 'continuous' && a.pointsOfInterest?.length === 1))).toBe(true)
  expect([result.width, result.height]).toEqual([1280, 1600])
  await expect(page.getByText('Combinación de la ráfaga', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Usar foto preparada', exact: true }).click()
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar metadatos', exact: true }).click()
  const { readFile } = await import('node:fs/promises')
  expect(JSON.parse(await readFile((await (await download).path())!, 'utf8')).source).toBe('single')
})

test('blank document does not pass readiness and manual capture works without focus or ImageCapture', async ({ page }) => {
  await page.goto('./'); await singleCamera(page, false, true)
  await page.getByRole('button', { name: 'Abrir cámara', exact: true }).click()
  await expect(page.getByText(/La cámara administra el enfoque/)).toBeVisible()
  await page.getByRole('button', { name: 'Capturar una foto', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Capturar de todos modos', exact: true })).toBeEnabled({ timeout: 20_000 })
  await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Vista previa de la cámara', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Capturar de todos modos', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Foto original del documento', exact: true })).toBeVisible()
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
