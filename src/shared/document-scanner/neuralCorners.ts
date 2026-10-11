import { scannerPointKeys, validScannerQuad, type ScannerPoint, type ScannerQuad } from "./documentCorners"

export interface CornerDetection {
  method: "neural" | "classic" | "manual"
  model: string | null
  confidence: number | null
  elapsedMs: number
  fallbackReason: string | null
  corners: ScannerQuad | null
  neuralCorners?: ScannerQuad | null
}
export interface DecodedCorners { corners: ScannerQuad | null; confidence: number; rejection: string | null }

/** Prevent an opt-in model from replacing a detected sheet with its inner text block. */
export function compatibleCornerProposal(current: ScannerQuad, proposed: ScannerQuad): boolean {
  const area = (quad: ScannerQuad) => Math.abs(scannerPointKeys.reduce((sum, key, index) => {
    const point = quad[key], next = quad[scannerPointKeys[(index + 1) % 4]]
    return sum + point.x * next.y - point.y * next.x
  }, 0)) / 2
  const ratio = area(proposed) / area(current)
  return validScannerQuad(current) && validScannerQuad(proposed) && ratio >= .8 && ratio <= 1.25 &&
    scannerPointKeys.every(key => Math.hypot(current[key].x - proposed[key].x, current[key].y - proposed[key].y) <= .08)
}

/** DocAligner heatmaps are probabilities, not logits. Never apply a second sigmoid. */
export function decodeDocumentHeatmaps(values: Float32Array, shape: readonly number[]): DecodedCorners {
  const [batch, channels, height, width] = shape
  const rejected = (reason: string, confidence = 0): DecodedCorners => ({ corners: null, confidence, rejection: reason })
  if (shape.length !== 4 || batch !== 1 || channels !== 4 || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 2 || height < 2 || width > 512 || height > 512 || values.length !== channels * width * height) {
    return rejected("La salida del modelo no tiene el formato esperado.")
  }
  const plane = width * height, visited = new Uint8Array(plane), stack = new Int32Array(plane)
  const points: ScannerPoint[] = []
  let confidence = 1
  for (let channel = 0; channel < 4; channel++) {
    visited.fill(0)
    const base = channel * plane
    let largest = 0, bestX = 0, bestY = 0, bestPeak = 0
    for (let start = 0; start < plane; start++) {
      const value = values[base + start]
      if (!Number.isFinite(value) || value < 0 || value > 1.001) return rejected("El modelo devolvió valores inválidos.")
      if (value < .3 || visited[start]) continue
      let top = 0, count = 0, mass = 0, sumX = 0, sumY = 0, peak = 0
      stack[top++] = start; visited[start] = 1
      while (top) {
        const index = stack[--top], x = index % width, y = Math.floor(index / width), weight = values[base + index]
        count++; mass += weight; sumX += (x + .5) * weight; sumY += (y + .5) * weight; peak = Math.max(peak, weight)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const neighbor = ny * width + nx
          if (!visited[neighbor] && values[base + neighbor] >= .3) {
            visited[neighbor] = 1; stack[top++] = neighbor
          }
        }
      }
      // Area, rather than the highest isolated activation, chooses the corner region.
      if (count > largest) { largest = count; bestX = sumX / mass / width; bestY = sumY / mass / height; bestPeak = peak }
    }
    confidence = Math.min(confidence, bestPeak)
    if (!largest || bestPeak < .6 || largest / plane > .05) return rejected("No se distinguieron cuatro esquinas fiables.", confidence)
    points.push({ x: bestX, y: bestY })
  }
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 })
  points.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x))
  let first = 0
  for (let i = 1; i < 4; i++) if (points[i].x + points[i].y < points[first].x + points[first].y) first = i
  const corners: ScannerQuad = { b: points[first], c: points[(first + 1) % 4], d: points[(first + 2) % 4], a: points[(first + 3) % 4] }
  if (!validScannerQuad(corners)) return rejected("Las esquinas propuestas no rodean una hoja válida.", confidence)
  return { corners, confidence, rejection: null }
}
