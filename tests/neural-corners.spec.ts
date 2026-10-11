import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { documentPhoto } from './documentPhoto'

test.use({ serviceWorkers: 'block' })
async function loadSyntheticPhoto(page: import('@playwright/test').Page) {
  const encoded = await documentPhoto(page)
  await page.getByLabel('Cargar fotografía', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') })
}
test('neural inference runs under CSP and protects the complete sheet from a high-confidence inner crop', async ({ page }) => {
  const policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' data:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'"
  const violations: string[] = [], mutations: string[] = [], origins: string[] = []
  page.on('console', message => { if (/violates.*Content Security Policy|Refused to.*Content Security Policy/i.test(message.text())) violations.push(message.text()) })
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url())
    if (/^https?:/.test(request.url())) origins.push(new URL(request.url()).origin)
  })
  await page.route('**/*', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
  await page.goto('./')
  await page.getByLabel('Detección inteligente de bordes — experimental', { exact: true }).check()
  await loadSyntheticPhoto(page)
  await expect(page.getByText('Se usó la detección habitual.', { exact: false })).toBeVisible({ timeout: 30_000 })
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    const photo = await page.getByLabel('Vista previa; arrastrá para seleccionar el recorte', { exact: true }).boundingBox()
    const outline = await page.locator('.document-scanner-outline').boundingBox()
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(photo![key] - outline![key])).toBeLessThan(1)
    expect(photo!.width / photo!.height).toBeCloseTo(.8, 2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  const suggestedX = await page.getByRole('button', { name: 'Esquina 1 de la hoja', exact: true }).evaluate(button => button.style.left)
  await page.getByRole('button', { name: 'Esquina 1 de la hoja', exact: true }).press('ArrowRight')
  expect(await page.getByRole('button', { name: 'Esquina 1 de la hoja', exact: true }).evaluate(button => button.style.left)).not.toBe(suggestedX)
  await page.getByRole('button', { name: 'Usar foto preparada', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar metadatos', exact: true }).click()
  const metadata = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  const preparation = metadata.preparation
  expect(preparation.detection.method).toBe('classic')
  expect(preparation.detection.neuralCorners).toBeTruthy()
  expect(preparation.detection.fallbackReason).toContain('difiere demasiado')
  expect(preparation.detection.confidence).toBeGreaterThanOrEqual(.6)
  for (const [key, x, y] of [['b', 120, 100], ['c', 530, 70], ['d', 570, 700], ['a', 80, 730]] as const) {
    expect(Math.abs(preparation.detection.corners[key].x - x / 640)).toBeLessThan(.025)
    expect(Math.abs(preparation.detection.corners[key].y - y / 800)).toBeLessThan(.025)
  }
  expect(preparation.corners.a.x - preparation.detection.corners.a.x).toBeCloseTo(.005)
  expect(preparation.originalWidth).toBe(640); expect(preparation.originalHeight).toBe(800)
  expect(violations).toEqual([]); expect(mutations).toEqual([])
  expect(new Set(origins)).toEqual(new Set([new URL(page.url()).origin]))
})
test('a missing model falls back to the existing detector and remains usable', async ({ page }) => {
  await page.route('**/*.onnx', route => route.fulfill({ status: 404, body: 'Unavailable model' }))
  await page.goto('./')
  await page.getByLabel('Detección inteligente de bordes — experimental', { exact: true }).check()
  await loadSyntheticPhoto(page)
  await expect(page.getByText('Se usó la detección habitual.', { exact: false })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Usar foto preparada', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar metadatos', exact: true }).click()
  const metadata = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(metadata.preparation.detection.method).toBe('classic')
  expect(metadata.preparation.detection.fallbackReason).toBeTruthy()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
test('switching off a slow model cancels its work and returns to normal detection', async ({ page }) => {
  let started = false
  await page.route('**/neural-corners-worker-v1.js', route => {
    started = true
    return route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage=()=>{ self.postMessage({progress:"Synthetic slow model"}) }' })
  })
  await page.goto('./')
  await page.getByLabel('Detección inteligente de bordes — experimental', { exact: true }).check()
  await loadSyntheticPhoto(page)
  await expect.poll(() => started).toBe(true)
  await page.getByLabel('Detección inteligente de bordes — experimental', { exact: true }).uncheck()
  await expect(page.getByText('Bordes detectados. Revisá', { exact: false })).toBeVisible({ timeout: 8_000 })
  await expect(page.getByRole('button', { name: 'Usar foto preparada', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
