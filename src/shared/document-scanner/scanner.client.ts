import { scannerAssetUrl } from "../../app/scannerAssets"
import { validateScannerOptions, type ScannerMetadata, type ScannerOptions, type ScannerResult } from "./scanner.types"
export const scannerEngineAssets = [
  scannerAssetUrl("vendor/document-scanner/burst-worker-v1.js"), scannerAssetUrl("vendor/opencv/opencv-4.12.0.js"), scannerAssetUrl("vendor/document-scanner/image-worker-v1.js"),
  scannerAssetUrl("vendor/document-scanner/process.8010e3f6.js"), scannerAssetUrl("vendor/document-scanner/scanner_bg.0b3074af.wasm"),
] as const
export async function prepareScannerOffline(): Promise<void> {
  if (!("serviceWorker" in navigator)) throw new Error("Este navegador no permite preparar el modo sin conexión.")
  if (!navigator.serviceWorker.controller) throw new Error("La PWA todavía no está activa. Abrí la app instalada y volvé a intentar.")
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error("La descarga demoró demasiado. Volvé a intentar con conexión.")) }, 60_000)
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close()
      if (event.data?.ok) resolve()
      else reject(new Error("No se pudieron guardar todos los motores para usarlos sin conexión."))
    }
    navigator.serviceWorker.controller!.postMessage({ type: "PWA_PREPARE_SCANNER" }, [channel.port2])
  })
}
export async function processPreparedDocument(file: Blob, options: ScannerOptions, signal: AbortSignal, progress: (message: string) => void): Promise<ScannerResult> {
  validateScannerOptions(options)
  signal.throwIfAborted()
  progress("Preparando imagen…")
  const bitmap = await createImageBitmap(file)
  let image: ImageData
  try {
    const scale = Math.min(1, options.maxSize / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("No se pudo abrir la imagen.")
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    image = context.getImageData(0, 0, canvas.width, canvas.height)
  } finally { bitmap.close() }
  signal.throwIfAborted()
  const worker = new Worker(scannerAssetUrl("vendor/document-scanner/image-worker-v1.js"))
  try {
    const result = await new Promise<{ image: ImageData; metadata: ScannerMetadata }>((resolve, reject) => {
      const abort = () => { cleanup(); reject(new DOMException("Procesamiento cancelado", "AbortError")) }
      const timer = setTimeout(() => { cleanup(); reject(new Error("El procesamiento demoró demasiado. Probá una resolución menor.")) }, 90_000)
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort) }
      signal.addEventListener("abort", abort, { once: true })
      const fail = () => { cleanup(); reject(new Error("No se pudo cargar el motor. Prepará el modo sin conexión o verificá la conexión.")) }
      worker.onerror = fail
      worker.onmessageerror = fail
      worker.onmessage = (event: MessageEvent<{ progress?: string; error?: string; buffer?: ArrayBuffer; width: number; height: number; metadata: ScannerMetadata }>) => {
        const data = event.data
        if (data.progress) { progress(data.progress); return }
        cleanup()
        if (data.error || !data.buffer) reject(new Error(data.error ?? "Respuesta inválida del escáner."))
        else resolve({ image: new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height), metadata: data.metadata })
      }
      worker.postMessage({ buffer: image.data.buffer, width: image.width, height: image.height, options }, [image.data.buffer])
    })
    signal.throwIfAborted()
    progress("Exportando imagen…")
    const canvas = document.createElement("canvas"); canvas.width = result.image.width; canvas.height = result.image.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("No se pudo exportar la imagen.")
    context.putImageData(result.image, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No se pudo exportar la foto.")), options.format, options.quality))
    signal.throwIfAborted()
    return { ...result.metadata, blob, width: canvas.width, height: canvas.height, format: blob.type as ScannerResult["format"] }
  } finally { worker.terminate() }
}
