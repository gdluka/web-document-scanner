import { loadOpenCV, type Mat, type OpenCV } from "./opencvRuntime.worker"
import { neuralCornerModel } from "./neuralCorners.config"
import { decodeDocumentHeatmaps, type DecodedCorners } from "./neuralCorners"

const scope = globalThis as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<{ msg: { data: ImageData } }>) => void) | null
}
type Net = ReturnType<OpenCV["readNetFromONNX"]>
let loading: Promise<{ cv: OpenCV; net: Net }> | undefined
async function loadDetector() {
  return loading ??= (async () => {
    const cv = await loadOpenCV()
    scope.postMessage({ progress: "Preparando detección inteligente de bordes…" })
    const url = new URL(`../docaligner/${neuralCornerModel.file}`, globalThis.location.href)
    const response = await fetch(url, { credentials: "omit", redirect: "error" })
    if (!response.ok) throw new Error("No se pudo cargar el detector.")
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length !== neuralCornerModel.size) throw new Error("El modelo está incompleto.")
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("")
    if (digest !== neuralCornerModel.sha256) throw new Error("El modelo no coincide con la versión esperada.")
    const name = "/document-corners.onnx"
    cv.FS_createDataFile("/", name.slice(1), bytes, true, false)
    try { return { cv, net: cv.readNetFromONNX(name) } }
    finally { cv.FS_unlink(name) }
  })()
}
scope.onmessage = event => { void detect(event.data.msg.data).catch(() => scope.postMessage({ error: "La detección inteligente no está disponible." })) }
async function detect(data: ImageData) {
  const started = performance.now(), { cv, net } = await loadDetector(), resources: Mat[] = []
  const keep = (value: Mat) => { resources.push(value); return value }
  try {
    const source = keep(cv.matFromImageData(data)), bgr = keep(new cv.Mat())
    // Matches DocAligner's reference: BGR / 255, NCHW, resize without letterboxing.
    cv.cvtColor(source, bgr, cv.COLOR_RGBA2BGR)
    const blob = keep(cv.blobFromImage(bgr, 1 / 255, new cv.Size(neuralCornerModel.inputSize, neuralCornerModel.inputSize), new cv.Scalar(0, 0, 0, 0), false, false))
    net.setInput(blob)
    const output = keep(net.forward())
    const result: DecodedCorners = decodeDocumentHeatmaps(output.data32F, output.matSize)
    scope.postMessage({ result: { ...result, elapsedMs: performance.now() - started } })
  } finally { for (const resource of resources.reverse()) resource.delete() }
}
