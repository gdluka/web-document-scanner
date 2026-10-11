import { detectCurvedGuides, fillCombinedCurvatureMaps } from "./curvedTableGeometry"
import type { GeometryMetadata } from "./scannerSession"
import { fillTableMaps, selectTableGuides } from "./tableGeometry"
import type { ScannerMetadata, ScannerOptions } from "./scanner.types"
interface Mat { data: Uint8Array; data32S: Int32Array; data32F: Float32Array; data64F: Float64Array; delete(): void }
interface OpenCV {
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
  cv?: OpenCV & { then?: (callback: () => void) => void; onRuntimeInitialized?: () => void }
  importScripts(url: string): void
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<FilterRequest | PerspectiveRequest>) => void) | null
}
interface FilterRequest { width: number; height: number; buffer: ArrayBuffer; options: ScannerOptions }
interface PerspectiveRequest { msg: { data: ImageData; region: Record<"a" | "b" | "c" | "d", { x: number; y: number }>; targetWidth: number; targetHeight: number; correctCurvature?: boolean; returnMetadata?: boolean } }
let initializing: Promise<OpenCV> | undefined
function loadOpenCV(): Promise<OpenCV> {
  return initializing ??= (async () => {
    scope.postMessage({ progress: "Cargando motor de imagen…" })
    scope.importScripts(new URL("../opencv/opencv-4.12.0.js", globalThis.location.href).href)
    const cv = scope.cv
    if (!cv) throw new Error("No se pudo inicializar OpenCV.")
    // This pinned Emscripten build exposes a self-resolving legacy thenable.
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
scope.onmessage = (event) => { void ("msg" in event.data ? perspective(event.data) : process(event.data)).catch(() => scope.postMessage({ error: "No se pudo procesar la imagen. Probá reducir la resolución o usar la foto original." })) }
async function perspective({ msg }: PerspectiveRequest) {
  const cv = await loadOpenCV(), resources: Mat[] = []
  const keep = (value: Mat) => { resources.push(value); return value }
  try {
    const source = keep(cv.matFromImageData(msg.data)), output = keep(new cv.Mat())
    const points = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [msg.region.b.x, msg.region.b.y, msg.region.c.x, msg.region.c.y, msg.region.d.x, msg.region.d.y, msg.region.a.x, msg.region.a.y]))
    const target = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, msg.targetWidth - 1, 0, msg.targetWidth - 1, msg.targetHeight - 1, 0, msg.targetHeight - 1]))
    const matrix = keep(cv.getPerspectiveTransform(points, target))
    const width = msg.targetWidth, height = msg.targetHeight
    const homography = Array.from(matrix.data64F)
    const geometry: GeometryMetadata = { version: "curvature-v1", sourceWidth: msg.data.width, sourceHeight: msg.data.height,
      outputWidth: width, outputHeight: height, homography, guides: [], curvatureRequested: !!msg.correctCurvature,
      curvatureApplied: false, minimumVerticalStep: null, fallbackReason: null }
    if (msg.correctCurvature) {
      try {
      scope.postMessage({ progress: "Buscando curvas de la tabla…" })
      const preview = keep(new cv.Mat()), gray = keep(new cv.Mat()), binary = keep(new cv.Mat()), rules = keep(new cv.Mat())
      // Preview contributes geometry only. Final pixels always come from source.
      cv.warpPerspective(source, preview, matrix, new cv.Size(width, height), cv.INTER_LANCZOS4, cv.BORDER_REPLICATE)
      cv.cvtColor(preview, gray, cv.COLOR_RGBA2GRAY)
      cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 41, 10)
      const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(15, Math.floor(width / 80)), 1)))
      cv.morphologyEx(binary, rules, cv.MORPH_OPEN, kernel)
      geometry.guides = detectCurvedGuides(rules.data, width, height)
      if (geometry.guides.length >= 4) {
        const mapX = keep(new cv.Mat(height, width, cv.CV_32FC1)), mapY = keep(new cv.Mat(height, width, cv.CV_32FC1))
        const minimum = fillCombinedCurvatureMaps(geometry.guides, width, height, homography, mapX.data32F, mapY.data32F)
        if (minimum !== null) {
          cv.remap(source, output, mapX, mapY, cv.INTER_LANCZOS4, cv.BORDER_REPLICATE)
          geometry.curvatureApplied = true; geometry.minimumVerticalStep = minimum
        } else geometry.fallbackReason = "El mapa de curvas no es fiable. Se aplicó solo perspectiva."
      } else geometry.fallbackReason = "No hay suficientes curvas fiables. Se aplicó solo perspectiva."
      } catch {
        geometry.curvatureApplied = false; geometry.minimumVerticalStep = null
        geometry.fallbackReason = "No se pudo corregir la curvatura. Se aplicó solo perspectiva."
      }
    }
    if (!geometry.curvatureApplied) cv.warpPerspective(source, output, matrix, new cv.Size(width, height), cv.INTER_LANCZOS4, cv.BORDER_REPLICATE)
    const data = new ImageData(new Uint8ClampedArray(output.data), width, height)
    scope.postMessage({ result: msg.returnMetadata ? { image: data, geometry } : data }, [data.data.buffer])
  } finally { for (const resource of resources.reverse()) resource.delete() }
}
async function process(request: { width: number; height: number; buffer: ArrayBuffer; options: ScannerOptions }) {
  const cv = await loadOpenCV(), { width, height, options } = request
  const started = performance.now(), resources: Mat[] = []
  const mat = (rows?: number, cols?: number, type?: number) => {
    const result = rows === undefined ? new cv.Mat() : new cv.Mat(rows, cols, type)
    resources.push(result); return result
  }
  try {
    const source = cv.matFromImageData(new ImageData(new Uint8ClampedArray(request.buffer), width, height)); resources.push(source)
    let output = source
    const gray = mat(); cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY)
    const metadata: ScannerMetadata = { guides: 0, alignmentApplied: false, lightingApplied: false, elapsedMs: 0, warnings: [] }
    if (options.alignTable) {
      scope.postMessage({ progress: "Buscando líneas de la tabla…" })
      const edges = mat(), segments = mat(), preview = mat()
      const detectionScale = Math.min(1, 900 / Math.max(width, height))
      const previewWidth = Math.max(1, Math.round(width * detectionScale)), previewHeight = Math.max(1, Math.round(height * detectionScale))
      cv.resize(gray, preview, new cv.Size(previewWidth, previewHeight))
      cv.Canny(preview, edges, 60, 160)
      cv.HoughLinesP(edges, segments, 1, Math.PI / 720, Math.max(30, Math.round(previewWidth * 0.085)), previewWidth * 0.45, previewWidth * 0.05)
      const scaledSegments = Int32Array.from(segments.data32S, coordinate => Math.round(coordinate / detectionScale))
      const guides = selectTableGuides(scaledSegments, width, height)
      metadata.guides = guides.length
      if (guides.length >= 4) {
        scope.postMessage({ progress: "Enderezando las filas…" })
        const mapX = mat(height, width, cv.CV_32FC1), mapY = mat(height, width, cv.CV_32FC1), aligned = mat()
        fillTableMaps(guides, width, height, mapX.data32F, mapY.data32F)
        cv.remap(source, aligned, mapX, mapY, cv.INTER_CUBIC, cv.BORDER_REPLICATE)
        output = aligned; metadata.alignmentApplied = true
        cv.cvtColor(output, gray, cv.COLOR_RGBA2GRAY)
      } else metadata.warnings.push("No hay suficientes líneas fiables. Se conservó la geometría de la foto preparada.")
    }
    const processed = new Uint8ClampedArray(output.data)
    if (options.normalizeLighting) {
      scope.postMessage({ progress: "Compensando sombras e iluminación…" })
      const background = mat(), small = mat(), smooth = mat()
      // The paper background is low frequency: estimate it at reduced resolution.
      // This avoids a huge Gaussian kernel over every full-resolution pixel on phones.
      const lightingScale = Math.min(1, 480 / Math.max(width, height))
      const smallWidth = Math.max(1, Math.round(width * lightingScale)), smallHeight = Math.max(1, Math.round(height * lightingScale))
      cv.resize(gray, small, new cv.Size(smallWidth, smallHeight))
      cv.GaussianBlur(small, smooth, new cv.Size(0, 0), Math.max(3, Math.min(smallWidth, smallHeight) / 40))
      cv.resize(smooth, background, new cv.Size(width, height))
      const paper = options.profile === "document" ? 245 : 235
      const backgroundPixels = background.data, grayPixels = gray.data
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        const offset = pixel * 4, gain = paper / Math.max(30, backgroundPixels[pixel]!)
        for (let channel = 0; channel < 3; channel += 1) {
          const value = options.profile === "photo" ? processed[offset + channel]! : grayPixels[pixel]!
          processed[offset + channel] = Math.min(255, Math.round(value * gain))
        }
        processed[offset + 3] = 255
      }
      metadata.lightingApplied = true
    } else if (options.profile !== "photo") {
      const grayPixels = gray.data
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        processed[pixel * 4] = processed[pixel * 4 + 1] = processed[pixel * 4 + 2] = grayPixels[pixel]!
      }
    }
    if (options.sharpen > 0) {
      scope.postMessage({ progress: "Aplicando nitidez suave…" })
      const clean = cv.matFromImageData(new ImageData(processed, width, height)); resources.push(clean)
      const blurred = mat(); cv.GaussianBlur(clean, blurred, new cv.Size(0, 0), 0.7)
      const blurredPixels = blurred.data
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          const offset = pixel * 4 + channel, value = processed[offset]!
          processed[offset] = Math.max(0, Math.min(255, value + options.sharpen * (value - blurredPixels[offset]!)))
        }
      }
    }
    metadata.elapsedMs = Math.round(performance.now() - started)
    scope.postMessage({ buffer: processed.buffer, width, height, metadata }, [processed.buffer])
  } finally { for (const resource of resources.reverse()) resource.delete() }
}
