import { scannerPointKeys, validScannerQuad, type ScannerQuad } from "../../app/documentScanner.client"

function distance(a: ScannerQuad, b: ScannerQuad) {
  return Math.max(...scannerPointKeys.map(key => Math.hypot(a[key].x - b[key].x, a[key].y - b[key].y)))
}
function center(quad: ScannerQuad) {
  return scannerPointKeys.reduce((p, key) => ({ x: p.x + quad[key].x / 4, y: p.y + quad[key].y / 4 }), { x: 0, y: 0 })
}
function area(quad: ScannerQuad) {
  return Math.abs(scannerPointKeys.reduce((sum, key, index) => {
    const next = quad[scannerPointKeys[(index + 1) % 4]!]!
    return sum + quad[key].x * next.y - quad[key].y * next.x
  }, 0)) / 2
}
function blend(from: ScannerQuad, to: ScannerQuad, amount: number): ScannerQuad {
  return Object.fromEntries(scannerPointKeys.map(key => [key, {
    x: from[key].x + (to[key].x - from[key].x) * amount,
    y: from[key].y + (to[key].y - from[key].y) * amount,
  }])) as unknown as ScannerQuad
}

export interface LiveDocumentTrack { display: ScannerQuad | null; measurement: ScannerQuad | null; stable: boolean; confirmed: boolean }
/** Smooth display coordinates only. Actual measurements stay untouched for focus and quality checks. */
export function createLiveDocumentTracker() {
  let display: ScannerQuad | null = null, measurement: ScannerQuad | null = null, pending: ScannerQuad | null = null
  let acceptedAt = -Infinity, stableCount = 0, confirmed = false
  const reset = () => { display = measurement = pending = null; acceptedAt = -Infinity; stableCount = 0; confirmed = false }
  function current(at: number): LiveDocumentTrack {
    if (at - acceptedAt > 2000) return { display: null, measurement: null, stable: false, confirmed: false }
    return { display, measurement: confirmed ? measurement : null, stable: confirmed && stableCount >= 2, confirmed }
  }
  return {
    reset, current,
    update(next: ScannerQuad | null, at: number): LiveDocumentTrack {
      if (at - acceptedAt > 2000) reset()
      confirmed = false
      if (!next || !validScannerQuad(next)) { pending = null; stableCount = 0; return current(at) }
      if (!measurement || !display) {
        display = measurement = blend(next, next, 1); acceptedAt = at; stableCount = 1; confirmed = true
        return current(at)
      }
      const shift = distance(measurement, next), previousCenter = center(measurement), nextCenter = center(next)
      const dx = nextCenter.x - previousCenter.x, dy = nextCenter.y - previousCenter.y
      const residual = Math.max(...scannerPointKeys.map(key => Math.hypot(next[key].x - measurement![key].x - dx, next[key].y - measurement![key].y - dy)))
      const ratio = area(next) / area(measurement)
      // One bad corner or a sudden different rectangle must recur before replacing the sheet.
      const shapeJump = shift > .06 && residual > .025 || ratio < .72 || ratio > 1.38
      if (shapeJump && (!pending || distance(pending, next) > .025)) {
        pending = blend(next, next, 1); stableCount = 0
        return current(at)
      }
      const replacing = shapeJump && pending !== null
      pending = null
      stableCount = shift <= .018 ? stableCount + 1 : 1
      // Tiny detector noise stays in a dead band; genuine translation follows promptly.
      if (replacing || shift > .06 && residual <= .025) display = blend(next, next, 1)
      else {
        const visualShift = distance(display, next)
        if (visualShift > .004) display = blend(display, next, visualShift <= .02 ? .22 : .6)
      }
      measurement = blend(next, next, 1); acceptedAt = at; confirmed = true
      return current(at)
    },
  }
}

export interface FramingGuidance { kind: "searching" | "checking" | "far" | "near" | "center" | "tilt" | "good"; message: string }
/** Distance guidance means apparent size in the image, never a measurement in centimetres. */
export function documentFramingGuidance(track: LiveDocumentTrack, aspect = 1): FramingGuidance {
  const quad = track.measurement
  if (!track.display) return { kind: "searching", message: "Mostrá la hoja completa dentro de la cámara." }
  if (!quad || !track.confirmed) return { kind: "checking", message: "Confirmando el contorno de la hoja…" }
  const points = scannerPointKeys.map(key => quad[key])
  const margin = Math.min(...points.flatMap(p => [p.x, p.y, 1 - p.x, 1 - p.y]))
  if (margin < .025 || area(quad) > .88) return { kind: "near", message: "Alejá un poco el teléfono para ver los cuatro bordes." }
  if (area(quad) < .35) return { kind: "far", message: "Acercá el teléfono para que la hoja ocupe más del encuadre." }
  const middle = center(quad)
  if (Math.abs(middle.x - .5) > .12 || Math.abs(middle.y - .5) > .12) return { kind: "center", message: "Centrá la hoja en el encuadre." }
  const edge = (i: number) => {
    const p = points[i]!, q = points[(i + 1) % 4]!
    return { x: (q.x - p.x) * aspect, y: q.y - p.y }
  }
  const lengths = points.map((_, i) => { const e = edge(i); return Math.hypot(e.x, e.y) })
  const distortion = Math.max(lengths[0]! / lengths[2]!, lengths[2]! / lengths[0]!, lengths[1]! / lengths[3]!, lengths[3]! / lengths[1]!)
  const skew = Math.max(...points.map((_, i) => { const a = edge(i), b = edge((i + 1) % 4); return Math.abs(a.x * b.x + a.y * b.y) / (lengths[i]! * lengths[(i + 1) % 4]!) }))
  if (distortion > 1.45 || skew > .4) return { kind: "tilt", message: "Poné el teléfono más paralelo a la hoja." }
  if (!track.stable) return { kind: "checking", message: "Mantené el teléfono quieto para confirmar la ubicación." }
  return { kind: "good", message: "Distancia y ubicación adecuadas." }
}
