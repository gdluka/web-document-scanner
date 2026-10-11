/** Cubic fits use normalized x and QR, avoiding normal-equation inversion. */
export interface CurvedGuide { coefficients: number[]; targetY: number }
const evaluate = (c: number[], x: number) => ((c[3]! * x + c[2]!) * x + c[1]!) * x + c[0]!
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? Infinity
export function fitCubicQR(xs: number[], ys: number[]): number[] | null {
  if (xs.length !== ys.length || xs.length < 4 || [...xs, ...ys].some(v => !Number.isFinite(v))) return null
  const q: number[][] = [], r = Array.from({ length: 4 }, () => Array<number>(4).fill(0))
  for (let j = 0; j < 4; j++) {
    const column = xs.map(x => x ** j)
    // Two modified Gram-Schmidt passes keep the tiny QR fit stable.
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < j; k++) {
      const dot = column.reduce((sum, value, i) => sum + value * q[k]![i]!, 0)
      r[k]![j]! += dot
      for (let i = 0; i < column.length; i++) column[i]! -= dot * q[k]![i]!
    }
    const length = Math.hypot(...column)
    if (length < 1e-9) return null
    r[j]![j] = length; q.push(column.map(v => v / length))
  }
  const coefficients = Array<number>(4).fill(0)
  for (let j = 3; j >= 0; j--) {
    let value = q[j]!.reduce((sum, v, i) => sum + v * ys[i]!, 0)
    for (let k = j + 1; k < 4; k++) value -= r[j]![k]! * coefficients[k]!
    coefficients[j] = value / r[j]![j]!
  }
  return coefficients.every(Number.isFinite) ? coefficients : null
}
/** Short horizontal rules are sampled locally, rather than requiring a globally straight line. */
export function detectCurvedGuides(rules: Uint8Array, width: number, height: number): CurvedGuide[] {
  if (rules.length !== width * height) return []
  const xs = Array.from({ length: 45 }, (_, i) => Math.round(width * (.045 + .92 * i / 44)))
  const peaks = xs.map(x => {
    const found: number[] = []; let start = -1
    const lo = Math.max(0, x - 12), hi = Math.min(width, x + 13)
    for (let y = 0; y <= height; y++) {
      let sum = 0
      if (y < height) for (let j = lo; j < hi; j++) sum += rules[y * width + j]! / 255
      if (y < height && sum / (hi - lo) > .45) { if (start < 0) start = y }
      else if (start >= 0) { if (y - start <= 7) found.push((start + y - 1) / 2); start = -1 }
    }
    return found
  })
  const middle = 22, guides: CurvedGuide[] = []
  for (const seed of peaks[middle]!) {
    if (seed < 40 || seed > height - 40) continue
    const ys: Array<number | null> = xs.map(() => null); ys[middle] = seed
    for (const direction of [-1, 1]) {
      let previous = seed, slope = 0
      for (let j = middle + direction; j >= 0 && j < xs.length; j += direction) {
        const predicted = previous + slope
        const near = peaks[j]!.filter(y => Math.abs(y - predicted) < Math.max(7, height * .004))
          .sort((a, b) => Math.abs(a - predicted) - Math.abs(b - predicted))
        if (near.length) { const value = near[0]!; ys[j] = value; slope = .5 * slope + .5 * (value - previous); previous = value }
        else previous = predicted
      }
    }
    const samples = xs.flatMap((x, i) => ys[i] === null ? [] : [{ x: x / width, y: ys[i]! }])
    if (samples.length < xs.length * .8) continue
    const coefficients = fitCubicQR(samples.map(p => p.x), samples.map(p => p.y))
    if (!coefficients || median(samples.map(p => Math.abs(evaluate(coefficients, p.x) - p.y))) > 2.5) continue
    const previous = guides.at(-1)
    let valid = true
    for (let x = 0; x < width; x++) {
      const y = evaluate(coefficients, x / width)
      if (!Number.isFinite(y) || y < 2 || y > height - 3 || previous && y - evaluate(previous.coefficients, x / width) < 8) { valid = false; break }
    }
    if (valid) guides.push({ coefficients, targetY: evaluate(coefficients, Math.floor(width / 2) / width) })
  }
  return guides
}
export function inverseHomography(m: number[]): number[] | null {
  if (m.length !== 9 || !m.every(Number.isFinite)) return null
  const [a,b,c,d,e,f,g,h,i] = m as [number,number,number,number,number,number,number,number,number]
  const adj = [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d]
  const determinant = a * adj[0]! + b * adj[3]! + c * adj[6]!
  return Math.abs(determinant) > 1e-12 ? adj.map(v => v / determinant) : null
}
/** Returns null on any unsafe map; caller must use pure perspective on the original source. */
export function fillCombinedCurvatureMaps(guides: CurvedGuide[], width: number, height: number, homography: number[], mapX: Float32Array, mapY: Float32Array): number | null {
  const inverse = inverseHomography(homography)
  if (!inverse || guides.length < 4 || guides.length > 200 || width < 2 || height < 2 || mapX.length !== width * height || mapY.length !== mapX.length) return null
  const anchors = [{ coefficients: [0,0,0,0], targetY: 0 }, ...guides, { coefficients: [height-1,0,0,0], targetY: height-1 }]
  if (anchors.some((g, i) => g.coefficients.length !== 4 || !g.coefficients.every(Number.isFinite) || !Number.isFinite(g.targetY) || i > 0 && g.targetY <= anchors[i-1]!.targetY)) return null
  // Cache guide positions in flat contiguous rows. No arrays or objects are allocated per pixel.
  const positions = new Float64Array(anchors.length * width)
  for (let j = 0; j < anchors.length; j++) for (let x = 0; x < width; x++) positions[j * width + x] = evaluate(anchors[j]!.coefficients, x / width)
  let minimumStep = Infinity
  for (let j = 1; j < anchors.length; j++) for (let x = 0; x < width; x++) {
    const step = (positions[j * width + x]! - positions[(j-1) * width + x]!) / (anchors[j]!.targetY - anchors[j-1]!.targetY)
    // This includes x=0 and x=width-1, beyond the sampled central region.
    if (!Number.isFinite(step) || step < .2 || step > 5) return null
    minimumStep = Math.min(minimumStep, step)
  }
  let segment = 0
  for (let y = 0; y < height; y++) {
    while (segment < anchors.length - 2 && y > anchors[segment+1]!.targetY) segment++
    const fraction = (y-anchors[segment]!.targetY)/(anchors[segment+1]!.targetY-anchors[segment]!.targetY)
    const lowerOffset = segment * width, upperOffset = (segment+1) * width, rowOffset = y * width
    // Output maps are filled in row-major order, matching OpenCV's contiguous layout.
    for (let x = 0; x < width; x++) {
      const curvedY = positions[lowerOffset+x]! + fraction * (positions[upperOffset+x]! - positions[lowerOffset+x]!)
      const denominator = inverse[6]! * x + inverse[7]! * curvedY + inverse[8]!
      if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null
      const sourceX = (inverse[0]! * x + inverse[1]! * curvedY + inverse[2]!) / denominator
      const sourceY = (inverse[3]! * x + inverse[4]! * curvedY + inverse[5]!) / denominator
      if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return null
      const index = rowOffset + x; mapX[index] = sourceX; mapY[index] = sourceY
    }
  }
  return minimumStep
}
