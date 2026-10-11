export interface ScannerPoint { x: number; y: number }
/** Clockwise: bottom left, top left, top right, bottom right. Coordinates are normalized. */
export interface ScannerQuad { a: ScannerPoint; b: ScannerPoint; c: ScannerPoint; d: ScannerPoint }
export const scannerPointKeys = ["a", "b", "c", "d"] as const

export function validScannerQuad(quad: ScannerQuad): boolean {
  const points = scannerPointKeys.map((key) => quad[key])
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false
  const crosses = points.map((p, index) => {
    const q = points[(index + 1) % 4]!, r = points[(index + 2) % 4]!
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x)
  })
  const area = Math.abs(points.reduce((sum, p, index) => {
    const q = points[(index + 1) % 4]!
    return sum + p.x * q.y - p.y * q.x
  }, 0)) / 2
  return area >= 0.02 && (crosses.every((value) => value > 0) || crosses.every((value) => value < 0))
}
