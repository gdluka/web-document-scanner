import { scannerPointKeys, type ScannerQuad } from "../../app/documentScanner.client"

type FocusConstraints = MediaTrackConstraintSet & { focusMode?: ConstrainDOMString; focusDistance?: ConstrainDouble; pointsOfInterest?: { x: number; y: number }[] }
export interface FocusControl { mode: "continuous" | "single-shot" | "device"; pointRequested: boolean }

function cameraTask<T>(task: Promise<T>, signal?: AbortSignal, timeout = 2500): Promise<T> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort) }
    const abort = () => { clean(); reject(new DOMException("Cancelado", "AbortError")) }
    const timer = setTimeout(() => { clean(); reject(new Error("La cámara no respondió a tiempo.")) }, timeout)
    signal?.addEventListener("abort", abort, { once: true })
    task.then(value => { clean(); resolve(value) }, error => { clean(); reject(error) })
  })
}

/** Capabilities belong to this track, not merely to the browser's supported constraints. */
export async function requestDocumentFocus(track: MediaStreamTrack, quad?: ScannerQuad | null, signal?: AbortSignal): Promise<FocusControl> {
  signal?.throwIfAborted()
  let capabilities: { focusMode?: string[] }
  try { capabilities = track.getCapabilities() as typeof capabilities } catch { return { mode: "device", pointRequested: false } }
  const mode = capabilities.focusMode?.includes("continuous") ? "continuous" : capabilities.focusMode?.includes("single-shot") ? "single-shot" : null
  if (!mode) return { mode: "device", pointRequested: false }
  const center = quad ? scannerPointKeys.reduce((p, key) => ({ x: p.x + quad[key].x / 4, y: p.y + quad[key].y / 4 }), { x: 0, y: 0 }) : null
  const { focusMode: _oldMode, pointsOfInterest: _oldPoint, focusDistance: _oldDistance, ...constraints } = track.getConstraints() as MediaTrackConstraints & FocusConstraints
  // Replace earlier focus requests so an old point cannot constrain the new one.
  const advanced = (constraints.advanced ?? []).map(value => { const { focusMode: _mode, pointsOfInterest: _points, focusDistance: _distance, ...rest } = value as FocusConstraints; return rest }).filter(value => Object.keys(value).length)
  const apply = (point: boolean) => cameraTask(track.applyConstraints({ ...constraints, advanced: [...advanced, { focusMode: mode, ...(point && center ? { pointsOfInterest: [center] } : {}) } as FocusConstraints] }), signal)
  // pointsOfInterest has no range in getCapabilities; browser recognition is
  // exposed by getSupportedConstraints. Device rejection still has a fallback.
  let supportedPoint = false
  try { supportedPoint = !!(navigator.mediaDevices?.getSupportedConstraints?.() as { pointsOfInterest?: boolean } | undefined)?.pointsOfInterest } catch { /* Unavailable in this browser. */ }
  const point = !!center && supportedPoint
  try { await apply(point); return { mode, pointRequested: point } }
  catch {
    signal?.throwIfAborted()
    if (point) { try { await apply(false); return { mode, pointRequested: false } } catch { signal?.throwIfAborted() } }
    return { mode: "device", pointRequested: false }
  }
}

export function waitForCamera(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener("abort", abort); resolve() }
    const timer = setTimeout(finish, ms)
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Cancelado", "AbortError")) }
    signal.addEventListener("abort", abort, { once: true })
  })
}

type PhotoSettings = { imageWidth?: number; imageHeight?: number }
interface PhotoCapture { takePhoto(settings?: PhotoSettings): Promise<Blob>; getPhotoCapabilities?(): Promise<{ imageWidth?: { max: number }; imageHeight?: { max: number } }> }
export async function captureDocumentPhoto(track: MediaStreamTrack, video: HTMLVideoElement, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted()
  const Capture = (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => PhotoCapture }).ImageCapture
  let blob: Blob | null = null
  if (Capture) {
    try {
      const photo = new Capture(track), settings: PhotoSettings = {}
      try {
        const capabilities = photo.getPhotoCapabilities ? await cameraTask(photo.getPhotoCapabilities(), signal) : undefined
        if (capabilities?.imageWidth && capabilities.imageWidth.max > 0) settings.imageWidth = capabilities.imageWidth.max
        if (capabilities?.imageHeight && capabilities.imageHeight.max > 0) settings.imageHeight = capabilities.imageHeight.max
      } catch { /* Some devices expose still capture without its capabilities. */ }
      signal.throwIfAborted()
      try { blob = await cameraTask(photo.takePhoto(settings), signal, 15000) } catch { signal.throwIfAborted(); blob = await cameraTask(photo.takePhoto(), signal, 15000) }
    } catch { signal.throwIfAborted() }
  }
  signal.throwIfAborted()
  if (!blob) {
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error("Esperá a que la cámara muestre la hoja.")
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const context = canvas.getContext("2d")
    if (!context) throw new Error("No se pudo capturar la imagen.")
    context.drawImage(video, 0, 0)
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No se pudo capturar la foto.")), "image/png"))
  }
  signal.throwIfAborted()
  return new File([blob], `documento-camara.${blob.type === "image/png" ? "png" : "jpg"}`, { type: blob.type })
}
