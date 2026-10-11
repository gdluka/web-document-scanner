export interface Mat { data: Uint8Array; data32S: Int32Array; data32F: Float32Array; data64F: Float64Array; matSize: number[]; delete(): void }
export interface OpenCV {
  Scalar: new (a: number, b: number, c: number, d: number) => object
  FS_createDataFile(path: string, name: string, bytes: Uint8Array, read: boolean, write: boolean): void
  FS_unlink(path: string): void
  readNetFromONNX(path: string): { setInput(blob: Mat): void; forward(): Mat; delete(): void }
  blobFromImage(source: Mat, scale: number, size: object, mean: object, swapRB: boolean, crop: boolean): Mat
  COLOR_RGBA2BGR: number
  Mat: new (rows?: number, cols?: number, type?: number) => Mat
  Size: new (width: number, height: number) => object
  matFromArray(rows: number, cols: number, type: number, data: number[]): Mat
  getPerspectiveTransform(source: Mat, target: Mat): Mat
  warpPerspective(source: Mat, target: Mat, matrix: Mat, size: object, interpolation: number, border: number): void
  matFromImageData(image: ImageData): Mat
  cvtColor(source: Mat, target: Mat, code: number): void
  resize(source: Mat, target: Mat, size: object, fx?: number, fy?: number, interpolation?: number): void
  adaptiveThreshold(source: Mat, target: Mat, max: number, method: number, type: number, block: number, constant: number): void
  getStructuringElement(shape: number, size: object): Mat
  morphologyEx(source: Mat, target: Mat, operation: number, kernel: Mat): void
  ADAPTIVE_THRESH_GAUSSIAN_C: number; THRESH_BINARY_INV: number; MORPH_OPEN: number; MORPH_RECT: number
  Canny(source: Mat, target: Mat, low: number, high: number): void
  HoughLinesP(source: Mat, target: Mat, rho: number, theta: number, threshold: number, minLength: number, maxGap: number): void
  remap(source: Mat, target: Mat, mapX: Mat, mapY: Mat, interpolation: number, border: number): void
  GaussianBlur(source: Mat, target: Mat, size: object, sigma: number, sigmaY?: number, border?: number): void
  COLOR_RGBA2GRAY: number; COLOR_GRAY2RGBA: number; CV_32FC1: number; CV_32FC2: number; INTER_CUBIC: number; INTER_LANCZOS4: number; BORDER_REPLICATE: number
}
const scope = globalThis as unknown as {
  cv?: (OpenCV & { then?: (callback: () => void) => void; onRuntimeInitialized?: () => void }) | Promise<OpenCV>
  importScripts(url: string): void
  postMessage(message: unknown): void
}
let initializing: Promise<OpenCV> | undefined
export function loadOpenCV(): Promise<OpenCV> {
  return initializing ??= (async () => {
    scope.postMessage({ progress: "Cargando motor de imagen…" })
    scope.importScripts(new URL("../opencv/opencv-5.0.0.js", globalThis.location.href).href)
    let cv = scope.cv
    if (cv instanceof Promise) cv = await cv
    if (!cv) throw new Error("No se pudo inicializar OpenCV.")
    // Legacy Emscripten builds can expose a self-resolving thenable.
    // Awaiting it directly recurses forever; wait for initialization and remove then.
    await new Promise<void>(resolve => {
      if (cv.Mat) resolve()
      else if (cv.then) cv.then(() => resolve())
      else cv.onRuntimeInitialized = () => resolve()
    })
    delete cv.then
    if (!cv.Mat || !cv.HoughLinesP || !cv.remap) throw new Error("El motor de imagen no está disponible.")
    return cv as OpenCV
  })()
}
