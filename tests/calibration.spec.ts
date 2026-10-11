import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { syntheticCalibrationViews } from './calibrationFixture'
test.use({ serviceWorkers: 'block' })
test('the complete photo-upload workflow computes and exports a real calibration profile', async ({ page }) => {
  await page.goto('./')
  await page.addScriptTag({ url: new URL('vendor/opencv/opencv-5.0.0.js', page.url()).href })
  const images = await page.evaluate(async views => {
    const cv = await (window as unknown as { cv: Promise<any> }).cv
    const dictionary = cv.getPredefinedDictionary(cv.DICT_4X4_50), ids = new cv.Mat(), board = new cv.aruco_CharucoBoard(new cv.Size(5,7),.03,.021,dictionary,ids), pattern = new cv.Mat()
    const sourceCorners = cv.matFromArray(4,1,cv.CV_32FC2,[299.5,299.5,1199.5,299.5,1199.5,1799.5,299.5,1799.5])
    const files: string[] = []
    try {
      board.generateImage(new cv.Size(1500,2100),pattern,0,1)
      for (const view of views) {
        const targetCorners = cv.matFromArray(4,1,cv.CV_32FC2,[0,3,23,20].flatMap(id=>{const p=view.points.find(p=>p.id===id)!;return[p.x,p.y]}))
        const h = cv.getPerspectiveTransform(sourceCorners,targetCorners), gray = new cv.Mat(), rgba = new cv.Mat()
        try {
          cv.warpPerspective(pattern,gray,h,new cv.Size(1280,960),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255))
          cv.cvtColor(gray,rgba,cv.COLOR_GRAY2RGBA)
          const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=960;canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.data),1280,960),0,0)
          files.push(canvas.toDataURL().split(',')[1]!)
        } finally { rgba.delete();gray.delete();h.delete();targetCorners.delete() }
      }
    } finally { sourceCorners.delete();pattern.delete();board.delete();ids.delete();dictionary.delete() }
    return files
  }, syntheticCalibrationViews(false))
  await page.getByText('Probar calibración de cámara — experimental', { exact: true }).click()
  await page.getByLabel('Agregar fotos del patrón', { exact: true }).setInputFiles(images.map((encoded,index)=>({name:`synthetic-view-${index}.png`,mimeType:'image/png',buffer:Buffer.from(encoded,'base64')})))
  await expect(page.getByRole('button', { name: 'Calcular perfil de cámara', exact: true })).toBeEnabled({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Cancelar prueba', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Calcular perfil de cámara', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Descargar perfil JSON', exact: true })).toBeVisible({ timeout: 30_000 })
  const download=page.waitForEvent('download');await page.getByRole('button', { name: 'Descargar perfil JSON', exact: true }).click()
  const profile=JSON.parse(await readFile((await (await download).path())!,'utf8'))
  expect(profile.views).toBeGreaterThanOrEqual(10);expect(profile.rms).toBeLessThan(.8)
  expect(Math.abs(profile.cameraMatrix[0]-1050)).toBeLessThan(50)
  expect(profile.sourceWidth).toBe(1280);expect(profile.sourceHeight).toBe(960)
  expect(profile.distortion).toHaveLength(5)
})
test('a slow calibration operation can be cancelled without blocking the scanner', async ({ page }) => {
  await page.route('**/calibration-worker-v1.js', route => route.fulfill({ contentType: 'application/javascript', body: 'onmessage=()=>postMessage({progress:"Synthetic slow calibration"})' }))
  await page.goto('./'); await page.getByText('Probar calibración de cámara — experimental', { exact: true }).click()
  await page.getByRole('button', { name: 'Preparar patrón A4', exact: true }).click()
  await expect(page.getByText('Synthetic slow calibration', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar prueba', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Preparar patrón A4', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Prueba cancelada.', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Cargar fotografía', { exact: true })).toBeEnabled()
})
test('pattern generation and detection stay local and reject repeated or incomplete photos', async ({ page }) => {
  const requests: string[] = [], violations: string[] = []
  page.on('request', r => requests.push(r.url()))
  page.on('console', m => { if (/violates.*Content Security Policy|Refused to.*Content Security Policy/i.test(m.text())) violations.push(m.text()) })
  const policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'"
  await page.route('**/*', async route => { const response = await route.fetch(); await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } }) })
  await page.goto('./')
  expect(requests.some(r => r.includes('calibration-worker'))).toBe(false)
  await page.getByText('Probar calibración de cámara — experimental', { exact: true }).click()
  const pdfDownload = page.waitForEvent('download'); await page.getByRole('link', { name: 'Descargar patrón A4 en PDF', exact: true }).click()
  const pdf = await readFile((await (await pdfDownload).path())!)
  expect(pdf.subarray(0,8).toString()).toBe('%PDF-1.4')
  expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 595.2756 841.8898]')
  await page.getByRole('button', { name: 'Preparar patrón A4', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Descargar patrón A4', exact: true })).toBeVisible({ timeout: 30_000 })
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Descargar patrón A4', exact: true }).click()
  const svg = await readFile((await (await download).path())!, 'utf8')
  expect(svg).toContain('width="210mm" height="297mm"'); expect(svg).toContain('width="150" height="210"')
  const png = Buffer.from(svg.match(/base64,([^"\s]+)/)![1]!, 'base64')
  await page.getByLabel('Agregar fotos del patrón', { exact: true }).setInputFiles({ name: 'synthetic-charuco.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('1 de 10 fotos mínimas', { exact: false })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Calcular perfil de cámara', exact: true })).toBeDisabled()
  await page.getByLabel('Agregar fotos del patrón', { exact: true }).setInputFiles({ name: 'same-pattern.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('same-pattern.png: Esta foto ya está cargada.', { exact: true })).toBeVisible()
  const blank = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d')!; x.fillStyle = 'white'; x.fillRect(0,0,640,480); return c.toDataURL().split(',')[1]! })
  await page.getByLabel('Agregar fotos del patrón', { exact: true }).setInputFiles({ name: 'no-pattern.png', mimeType: 'image/png', buffer: Buffer.from(blank, 'base64') })
  await expect(page.getByText('no-pattern.png:', { exact: false })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(violations).toEqual([])
  expect(new Set(requests.filter(r => /^https?:/.test(r)).map(r => new URL(r).origin))).toEqual(new Set([new URL(page.url()).origin]))
})
test('real OpenCV 5 calibration recovers known optics and straightens a distorted grid in the preview', async ({ page }) => {
  await page.goto('./')
  const result = await page.evaluate(views => new Promise<{ result?: import('../src/shared/document-scanner/cameraCalibration').CameraCalibrationProfile; error?: string }>((resolve, reject) => {
    const worker = new Worker(new URL('vendor/document-scanner/calibration-worker-v1.js', location.href)), timer = setTimeout(() => { worker.terminate(); reject(new Error('Calibration timed out')) }, 45_000)
    worker.onmessage = ({ data }) => { if (data.progress) return; clearTimeout(timer); worker.terminate(); resolve(data) }
    worker.onerror = e => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message)) }
    worker.postMessage({ id: 1, command: 'calibrate', views, name: 'Synthetic known optics' })
  }), syntheticCalibrationViews())
  expect(result.error).toBeUndefined(); const profile = result.result!
  expect(profile.rms).toBeLessThan(.001)
  expect(Math.abs(profile.cameraMatrix[0]! - 1050)).toBeLessThan(.02)
  expect(Math.abs(profile.cameraMatrix[4]! - 1040)).toBeLessThan(.02)
  expect(Math.abs(profile.distortion[0]! + .09)).toBeLessThan(.0001)
  await page.getByText('Probar calibración de cámara — experimental', { exact: true }).click()
  await page.getByLabel('Cargar perfil JSON', { exact: true }).setInputFiles({ name: 'synthetic-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) })
  await expect(page.getByText('Synthetic known optics · error RMS', { exact: false })).toBeVisible()
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 960
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0,0,1280,960)
    const distort = (px: number, py: number) => {
      const x = (px-640)/1050, y = (py-480)/1040, r2 = x*x+y*y, radial = 1-.09*r2+.02*r2*r2-.003*r2*r2*r2
      return [1050*(x*radial+2*.001*x*y-.002*(r2+2*x*x))+640,1040*(y*radial+.001*(r2+2*y*y)-2*.002*x*y)+480]
    }
    ctx.strokeStyle = 'red'; ctx.lineWidth = 3; ctx.beginPath()
    for (let y = 0; y < 960; y+=2) { const [x,dy] = distort(200,y); if (y===0) ctx.moveTo(x!,dy!); else ctx.lineTo(x!,dy!) }; ctx.stroke()
    return canvas.toDataURL().split(',')[1]!
  })
  await page.getByLabel('Foto para comparar la corrección óptica', { exact: true }).setInputFiles({ name: 'synthetic-distorted-grid.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') })
  await expect(page.getByAltText('Foto con corrección óptica', { exact: true })).toBeVisible({ timeout: 30_000 })
  const measurements = await page.evaluate(async () => {
    const images = [document.querySelector('img[alt="Foto original para comparar calibración"]'), document.querySelector('img[alt="Foto con corrección óptica"]')] as HTMLImageElement[]
    const result = []
    for (const image of images) {
      await image.decode(); const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight; const x = c.getContext('2d')!; x.drawImage(image,0,0)
      const pixels = x.getImageData(0,0,c.width,c.height).data, errors = []
      for (const y of [100,200,480,760,860]) {
        const positions=[]
        for (let px=150;px<250;px++) { const i=(y*c.width+px)*4; if(pixels[i]!>150&&pixels[i+1]!<100&&pixels[i+2]!<100)positions.push(px) }
        if (!positions.length) throw new Error('Expected synthetic red line was lost')
        errors.push(Math.abs(positions.reduce((a,b)=>a+b,0)/positions.length-200))
      }
      result.push({ width:c.width,height:c.height,meanError:errors.reduce((a,b)=>a+b,0)/errors.length })
    }
    return result
  })
  expect(measurements[0]!.meanError).toBeGreaterThan(5)
  expect(measurements[1]!.meanError).toBeLessThan(1)
  expect(measurements[1]!.width).toBe(1280); expect(measurements[1]!.height).toBe(960)
  await page.getByLabel('Foto para comparar la corrección óptica', { exact: true }).setInputFiles({ name: 'wrong-dimensions.png', mimeType: 'image/png', buffer: Buffer.from(await page.evaluate(() => { const c=document.createElement('canvas'); c.width=640;c.height=480;return c.toDataURL().split(',')[1]! }), 'base64') })
  await expect(page.getByRole('alert')).toContainText('misma resolución y orientación')
})
