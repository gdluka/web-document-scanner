import { scannerPointKeys, type ScannerQuad } from "../../app/documentScanner.client"

export interface CaptureQuality { contrast: number; edgeSpread: number | null; coverage: number; detail: boolean }
function percentile(histogram: Uint32Array, count: number, fraction: number) {
  let total = 0
  for (let i = 0; i < histogram.length; i++) { total += histogram[i]!; if (total >= count * fraction) return i }
  return histogram.length - 1
}
/** Preview-only heuristic. Excludes the paper boundary and background; never filters the photo. */
export function measureCaptureQuality(image: Pick<ImageData, "width" | "height" | "data">, quad: ScannerQuad): CaptureQuality {
  const { width, height, data } = image
  const center = scannerPointKeys.reduce((p, key) => ({ x: p.x + quad[key].x / 4, y: p.y + quad[key].y / 4 }), { x: 0, y: 0 })
  const points = scannerPointKeys.map(key => ({ x: (center.x + (quad[key].x - center.x) * .8) * width, y: (center.y + (quad[key].y - center.y) * .8) * height }))
  const area = Math.abs(scannerPointKeys.reduce((sum, key, index) => { const next = quad[scannerPointKeys[(index + 1) % 4]!]!; return sum + quad[key].x * next.y - quad[key].y * next.x }, 0)) / 2
  const left = Math.max(1, Math.floor(Math.min(...points.map(p => p.x)))), right = Math.min(width - 2, Math.ceil(Math.max(...points.map(p => p.x))))
  const top = Math.max(1, Math.floor(Math.min(...points.map(p => p.y)))), bottom = Math.min(height - 2, Math.ceil(Math.max(...points.map(p => p.y))))
  const gray = new Uint8Array(width * height), mask = new Uint8Array(width * height), histogram = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(data[i * 4]! * .299 + data[i * 4 + 1]! * .587 + data[i * 4 + 2]! * .114)
  let count = 0
  for (let y = top; y <= bottom; y += 2) for (let x = left; x <= right; x += 2) {
    let positive = false, negative = false
    for (let j = 0; j < 4; j++) { const p = points[j]!, q = points[(j + 1) % 4]!, cross = (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x); positive ||= cross > 0; negative ||= cross < 0 }
    if (positive && negative) continue
    mask[y * width + x] = 1; histogram[gray[y * width + x]!]!++; count++
  }
  if (!count) return { contrast: 0, edgeSpread: null, coverage: area, detail: false }
  const contrast = percentile(histogram, count, .95) - percentile(histogram, count, .03)
  const gradients = [new Uint32Array(256), new Uint32Array(256)], samples = [0, 0]
  for (let y = top; y <= bottom; y += 2) for (let x = left; x <= right; x += 2) {
    const i = y * width + x
    if (!mask[i]) continue
    const gx = (gray[i - width + 1]! + 2 * gray[i + 1]! + gray[i + width + 1]! - gray[i - width - 1]! - 2 * gray[i - 1]! - gray[i + width - 1]!) / 8
    const gy = (gray[i + width - 1]! + 2 * gray[i + width]! + gray[i + width + 1]! - gray[i - width - 1]! - 2 * gray[i - width]! - gray[i - width + 1]!) / 8
    const magnitude = Math.hypot(gx, gy)
    if (magnitude < Math.max(3, contrast * .05)) continue
    const direction = Math.abs(gx) > Math.abs(gy) ? 0 : 1
    gradients[direction]![Math.min(255, Math.round(magnitude))]!++; samples[direction]!++
  }
  const spreads = gradients.map((hist, index) => samples[index]! >= 40 ? contrast / Math.max(1, percentile(hist, samples[index]!, .9)) : null).filter((value): value is number => value !== null)
  const edgeSpread = spreads.length ? Math.max(...spreads) : null
  return { contrast, edgeSpread, coverage: area, detail: area >= .25 && contrast >= 25 && edgeSpread !== null && edgeSpread <= 4.5 }
}

export interface StabilitySample { quad: ScannerQuad; quality: CaptureQuality; at: number }
export function captureIsReady(samples: StabilitySample[]): boolean {
  const recent = samples.slice(-3)
  if (recent.length < 3 || recent[2]!.at - recent[0]!.at < 900 || recent[2]!.at - recent[0]!.at > 4000 || recent.some(s => !s.quality.detail)) return false
  const anchor = recent[0]!
  return recent.every(sample => scannerPointKeys.every(key => Math.hypot(sample.quad[key].x - anchor.quad[key].x, sample.quad[key].y - anchor.quad[key].y) <= .012)
    && Math.abs(sample.quality.edgeSpread! - anchor.quality.edgeSpread!) <= Math.max(.5, anchor.quality.edgeSpread! * .2))
}
