import { scannerAssetUrl } from "../../app/scannerAssets"
import type { BurstFrame } from "./burst"
export async function combineBurst(files: Blob[], signal: AbortSignal) {
  if (files.length < 2 || files.length > 8) throw new Error("Elegí entre 2 y 8 fotos de la misma hoja.")
  const frames: BurstFrame[] = []
  for (const file of files) {
    signal.throwIfAborted()
    const bitmap = await createImageBitmap(file)
    try {
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement("canvas")
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
      const context = canvas.getContext("2d")!
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      frames.push({ width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data })
    } finally { bitmap.close() }
  }
  if (frames.some(frame => frame.width !== frames[0]!.width || frame.height !== frames[0]!.height)) throw new Error("Las fotos deben tener la misma resolución y orientación.")
  signal.throwIfAborted()
  const worker = new Worker(scannerAssetUrl("vendor/document-scanner/burst-worker-v1.js"))
  try {
    const result = await new Promise<{ pixels: Uint8ClampedArray; width: number; height: number; bestIndex: number; accepted: number; total: number }>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort) }
      const abort = () => { cleanup(); reject(new DOMException("Procesamiento cancelado", "AbortError")) }
      const timer = setTimeout(() => { cleanup(); reject(new Error("La combinación demoró demasiado.")) }, 60_000)
      signal.addEventListener("abort", abort, { once: true })
      const fail = () => { cleanup(); reject(new Error("No se pudo cargar el motor de ráfaga.")) }
      worker.onerror = fail
      worker.onmessageerror = fail
      worker.onmessage = event => { cleanup(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data) }
      worker.postMessage(frames, frames.map(frame => frame.pixels.buffer))
    })
    signal.throwIfAborted()
    const canvas = document.createElement("canvas"); canvas.width = result.width; canvas.height = result.height
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height), 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No se pudo exportar la ráfaga.")), "image/png"))
    signal.throwIfAborted()
    return { ...result, blob }
  } finally { worker.terminate() }
}
