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
  await page.getByRole('button', { name: 'Abrir cámara para ráfaga', exact: true }).click()
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
