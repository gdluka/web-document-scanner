import { scannerAssetUrl } from '../../app/scannerAssets'
import type { CalibrationPoint, CalibrationView, CameraCalibrationProfile } from './cameraCalibration'
export class CameraCalibrationSession {
  private worker: Worker | null = null
  private next = 0
  private pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void; cleanup(): void }>()
  constructor(private progress: (message: string) => void) {}
  close(reason = 'Prueba cancelada.'): void {
    this.worker?.terminate(); this.worker = null
    for (const request of this.pending.values()) { request.cleanup(); request.reject(new Error(reason)) }
    this.pending.clear()
  }
  async command<T>(request: Record<string, unknown>, signal: AbortSignal, transfer: Transferable[] = []): Promise<T> {
    signal.throwIfAborted()
    if (!this.worker) {
      this.worker = new Worker(scannerAssetUrl('vendor/document-scanner/calibration-worker-v1.js'))
      this.worker.onmessage = ({ data }) => {
        if (data.progress) { this.progress(data.progress); return }
        const pending = this.pending.get(data.id)
        if (!pending) return
        this.pending.delete(data.id); pending.cleanup()
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result)
      }
      this.worker.onerror = () => this.close('No se pudo cargar el motor de calibración.')
    }
    const worker = this.worker, id = ++this.next
    return new Promise<T>((resolve, reject) => {
      const abort = () => this.close(), timer = setTimeout(() => this.close('La calibración demoró demasiado. Probá con menos fotos.'), 60_000)
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      this.pending.set(id, { resolve: value => resolve(value as T), reject, cleanup }); signal.addEventListener('abort', abort, { once: true })
      try { worker.postMessage({ ...request, id }, transfer) } catch (error) { this.pending.delete(id); cleanup(); reject(error) }
    })
  }
  board(signal: AbortSignal) { return this.command<{ width: number; height: number; buffer: ArrayBuffer }>({ command: 'board' }, signal) }
  detect(image: ImageData, signal: AbortSignal) { return this.command<CalibrationPoint[]>({ command: 'detect', buffer: image.data.buffer, width: image.width, height: image.height }, signal, [image.data.buffer]) }
  calibrate(views: CalibrationView[], name: string, signal: AbortSignal) { return this.command<CameraCalibrationProfile>({ command: 'calibrate', views, name }, signal) }
  preview(image: ImageData, profile: CameraCalibrationProfile, signal: AbortSignal) { return this.command<{ width: number; height: number; buffer: ArrayBuffer }>({ command: 'preview', buffer: image.data.buffer, width: image.width, height: image.height, profile }, signal, [image.data.buffer]) }
}
export async function calibrationImage(file: Blob, signal: AbortSignal): Promise<{ image: ImageData; sourceWidth: number; sourceHeight: number }> {
  signal.throwIfAborted()
  const bitmap = await createImageBitmap(file)
  try {
    signal.throwIfAborted()
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo leer la imagen.')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { image: ctx.getImageData(0, 0, canvas.width, canvas.height), sourceWidth: bitmap.width, sourceHeight: bitmap.height }
  } finally { bitmap.close() }
}
export async function calibrationBlob(value: { width: number; height: number; buffer: ArrayBuffer }): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = value.width; canvas.height = value.height
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo mostrar la imagen.')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(value.buffer), value.width, value.height), 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo exportar la imagen.')), 'image/png'))
}
