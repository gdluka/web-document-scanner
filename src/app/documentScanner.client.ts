import { scannerAssetUrl } from "./scannerAssets"
import type { GeometryMetadata } from "../shared/document-scanner/scannerSession"
import { compatibleCornerProposal, type CornerDetection, type DecodedCorners } from "../shared/document-scanner/neuralCorners"
import { neuralCornerModel } from "../shared/document-scanner/neuralCorners.config"
import { scannerPointKeys, validScannerQuad, type ScannerPoint, type ScannerQuad } from "../shared/document-scanner/documentCorners"
export { scannerPointKeys, validScannerQuad, type ScannerPoint, type ScannerQuad } from "../shared/document-scanner/documentCorners"

async function processImage<T>(message: object, precise = false, asset?: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  const worker = new Worker(scannerAssetUrl(asset ?? (precise ? "vendor/document-scanner/image-worker-v1.js" : "vendor/document-scanner/process.8010e3f6.js")))
  try {
    return await new Promise<T>((resolve, reject) => {
      const cleanup = () => { window.clearTimeout(timer); signal?.removeEventListener("abort", abort) }
      const abort = () => { cleanup(); reject(new DOMException("Detección cancelada", "AbortError")) }
      const timer = window.setTimeout(() => { cleanup(); reject(new Error("El procesamiento demoró demasiado. Probá recortar la foto.")) }, precise ? 60_000 : 15_000)
      signal?.addEventListener("abort", abort, { once: true })
      const fail = () => { cleanup(); reject(new Error("No se pudo procesar la foto. Podés ajustar las esquinas manualmente.")) }
      worker.onerror = fail
      worker.onmessageerror = fail
      worker.onmessage = (event: MessageEvent<{ result?: T; error?: { message: string } | string; progress?: string }>) => {
        if (event.data.progress) return
        cleanup()
        if (event.data.error) fail()
        else resolve(event.data.result as T)
      }
      worker.postMessage({ id: 0, msg: message })
    })
  } finally { worker.terminate() }
}

export async function detectDocumentCorners(data: ImageData, signal?: AbortSignal): Promise<ScannerQuad | null> {
  const result = await processImage<ScannerQuad | undefined>({ type: "find-document", data }, false, undefined, signal)
  return normalizeCorners(result, data)
}

/** Optional still-image detector. Camera preview keeps its lightweight classical worker. */
export async function detectDocumentCornersWithModel(data: ImageData, signal?: AbortSignal): Promise<CornerDetection> {
  const started = performance.now()
  let current: ScannerQuad | null = null
  try { current = await detectDocumentCorners(data, signal) }
  catch { signal?.throwIfAborted() }
  let confidence: number | null = null, fallbackReason = "La detección inteligente no está disponible."
  let neuralCorners: ScannerQuad | null = null
  try {
    const result = await processImage<DecodedCorners>({ type: "detect-neural", data }, false, "vendor/document-scanner/neural-corners-worker-v1.js", signal)
    confidence = Number.isFinite(result.confidence) ? result.confidence : null
    if (result.corners && confidence !== null && confidence >= .6 && validScannerQuad(result.corners)) {
      neuralCorners = result.corners
      if (!current || compatibleCornerProposal(current, neuralCorners)) {
        return { method: "neural", model: neuralCornerModel.id, confidence, elapsedMs: performance.now() - started, fallbackReason: null, corners: neuralCorners, neuralCorners }
      }
      fallbackReason = "La propuesta inteligente difiere demasiado de la hoja detectada. Se conservó el contorno habitual."
    } else fallbackReason = result.rejection ?? "No se distinguieron cuatro esquinas fiables."
  } catch { signal?.throwIfAborted() }
  return { method: current ? "classic" : "manual", model: neuralCornerModel.id, confidence, elapsedMs: performance.now() - started, fallbackReason, corners: current, neuralCorners }
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
