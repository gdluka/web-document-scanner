import { scannerAssetUrl } from "./scannerAssets"
import type { GeometryMetadata } from "../shared/document-scanner/scannerSession"
/** 101arrowz/scanner (MIT), locally hosted: https://github.com/101arrowz/scanner. */
export interface ScannerPoint { x: number; y: number }
/** Clockwise: bottom left, top left, top right, bottom right. Coordinates are normalized. */
export interface ScannerQuad { a: ScannerPoint; b: ScannerPoint; c: ScannerPoint; d: ScannerPoint }
export const scannerPointKeys = ["a", "b", "c", "d"] as const

export function validScannerQuad(quad: ScannerQuad): boolean {
  const points = scannerPointKeys.map((key) => quad[key])
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false
  const crosses = points.map((p, index) => {
    const q = points[(index + 1) % 4]!, r = points[(index + 2) % 4]!
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x)
  })
  const area = Math.abs(points.reduce((sum, p, index) => {
    const q = points[(index + 1) % 4]!
    return sum + p.x * q.y - p.y * q.x
  }, 0)) / 2
  return area >= 0.02 && (crosses.every((value) => value > 0) || crosses.every((value) => value < 0))
}

async function processImage<T>(message: object, precise = false): Promise<T> {
  const worker = new Worker(precise ? scannerAssetUrl("vendor/document-scanner/image-worker-v1.js") : scannerAssetUrl("vendor/document-scanner/process.8010e3f6.js"))
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("El procesamiento demoró demasiado. Probá recortar la foto.")), precise ? 60_000 : 15_000)
      const fail = () => { window.clearTimeout(timer); reject(new Error("No se pudo procesar la foto. Podés ajustar las esquinas manualmente.")) }
      worker.onerror = fail
      worker.onmessageerror = fail
      worker.onmessage = (event: MessageEvent<{ result?: T; error?: { message: string } | string; progress?: string }>) => {
        if (event.data.progress) return
        window.clearTimeout(timer)
        if (event.data.error) fail()
        else resolve(event.data.result as T)
      }
      worker.postMessage({ id: 0, msg: message })
    })
  } finally { worker.terminate() }
}

export async function detectDocumentCorners(data: ImageData): Promise<ScannerQuad | null> {
  const result = await processImage<ScannerQuad | undefined>({ type: "find-document", data })
  return normalizeCorners(result, data)
}

function normalizeCorners(result: ScannerQuad | undefined, data: ImageData): ScannerQuad | null {
  if (!result) return null
  const normalized = Object.fromEntries(scannerPointKeys.map((key) => [key, {
    x: Math.max(0, Math.min(1, result[key].x / data.width)),
    y: Math.max(0, Math.min(1, result[key].y / data.height)),
  }])) as unknown as ScannerQuad
  return validScannerQuad(normalized) ? normalized : null
}

/** A camera session reuses its detector so each frame does not reload the WASM engine. */
export function createDocumentCornerDetector() {
  let worker: Worker | null = null, cancel: (() => void) | null = null, sequence = 0
  function dispose() { worker?.terminate(); worker = null; cancel?.(); cancel = null }
  return {
    dispose,
    async detect(data: ImageData): Promise<ScannerQuad | null> {
      if (cancel) throw new Error("Ya hay una detección en curso.")
      worker ??= new Worker(scannerAssetUrl("vendor/document-scanner/process.8010e3f6.js"))
      const active = worker, id = ++sequence
      const result = await new Promise<ScannerQuad | undefined>((resolve, reject) => {
        const finish = (error?: Error, result?: ScannerQuad) => {
          window.clearTimeout(timer); cancel = null
          active.onmessage = null; active.onerror = null; active.onmessageerror = null
          if (error) { active.terminate(); if (worker === active) worker = null; reject(error) }
          else {
            // Older WASM bindings have no automatic finalizers; bound the session's allocations.
            if (id % 30 === 0) { active.terminate(); if (worker === active) worker = null }
            resolve(result)
          }
        }
        const timer = window.setTimeout(() => finish(new Error("La detección de bordes demoró demasiado.")), 15_000)
        cancel = () => finish(new DOMException("Detección cancelada", "AbortError"))
        active.onerror = active.onmessageerror = () => finish(new Error("No se pudieron detectar los bordes."))
        active.onmessage = (event: MessageEvent<{ id: number; result?: ScannerQuad; error?: unknown; progress?: string }>) => {
          if (event.data.progress || event.data.id !== id) return
          if (event.data.error) finish(new Error("No se pudieron detectar los bordes."))
          else finish(undefined, event.data.result)
        }
        try { active.postMessage({ id, msg: { type: "find-document", data } }) }
        catch (error) { finish(error instanceof Error ? error : new Error("No se pudieron detectar los bordes.")) }
      })
      return normalizeCorners(result, data)
    },
  }
}

export async function straightenDocument(data: ImageData, quad: ScannerQuad, precise = false): Promise<ImageData> {
  return (await prepareDocumentGeometry(data, quad, precise, false)).image
}
export async function prepareDocumentGeometry(data: ImageData, quad: ScannerQuad, precise = true, correctCurvature = false): Promise<{ image: ImageData; geometry: GeometryMetadata | null }> {
  if (!validScannerQuad(quad)) throw new Error("Las esquinas deben rodear la hoja sin cruzarse.")
  const region = Object.fromEntries(scannerPointKeys.map((key) => [key, {
    x: quad[key].x * (data.width - 1), y: quad[key].y * (data.height - 1),
  }])) as unknown as ScannerQuad
  const distance = (p: ScannerPoint, q: ScannerPoint) => Math.hypot(p.x - q.x, p.y - q.y)
  const width = (distance(region.b, region.c) + distance(region.a, region.d)) / 2
  const height = (distance(region.a, region.b) + distance(region.c, region.d)) / 2
  const scale = Math.min(2, 2400 / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale)), targetHeight = Math.max(1, Math.round(height * scale))
  if (precise) return processImage<{ image: ImageData; geometry: GeometryMetadata }>({ type: "extract-document", data, region, targetWidth, targetHeight, correctCurvature, returnMetadata: true }, true)
  return { image: await processImage<ImageData>({ type: "extract-document", data, region, targetWidth, targetHeight }), geometry: null }
}

/** Normalize uneven paper lighting using a local background, preserving dark strokes. */
export function improveDocumentContrast(image: ImageData): ImageData {
  const { width, height, data } = image
  const gray = new Uint8Array(width * height), horizontal = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i += 1) gray[i] = Math.round(data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114)
  const radius = Math.max(12, Math.round(Math.min(width, height) / 40))
  for (let y = 0; y < height; y += 1) {
    let sum = 0
    for (let x = 0; x <= Math.min(radius, width - 1); x += 1) sum += gray[y * width + x]!
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / (Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1)
      if (x - radius >= 0) sum -= gray[y * width + x - radius]!
      if (x + radius + 1 < width) sum += gray[y * width + x + radius + 1]!
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = 0; y <= Math.min(radius, height - 1); y += 1) sum += horizontal[y * width + x]!
    for (let y = 0; y < height; y += 1) {
      const background = sum / (Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1)
      const value = Math.max(0, Math.min(255, 255 - Math.max(0, background + 8 - gray[y * width + x]!) * 3))
      const offset = (y * width + x) * 4
      data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255
      if (y - radius >= 0) sum -= horizontal[(y - radius) * width + x]!
      if (y + radius + 1 < height) sum += horizontal[(y + radius + 1) * width + x]!
    }
  }
  return image
}
