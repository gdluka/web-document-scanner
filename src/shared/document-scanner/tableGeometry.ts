export interface TableGuide { y: number; slope: number; intercept: number; length: number }
/** Only long, near-horizontal lines supported across the table; never reconstruct missing content. */
export function selectTableGuides(segments: Int32Array, width: number, height: number): TableGuide[] {
  const candidates: TableGuide[] = []
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const x1 = segments[i]!, y1 = segments[i + 1]!, x2 = segments[i + 2]!, y2 = segments[i + 3]!
    if (x2 === x1) continue
    const slope = (y2 - y1) / (x2 - x1), intercept = y1 - slope * x1
    const y = slope * width / 2 + intercept
    if (Math.abs(slope) <= 0.12 && Math.abs(x2 - x1) >= width * 0.45 &&
      Math.min(x1, x2) < width * 0.35 && Math.max(x1, x2) > width * 0.75 && y > 10 && y < height - 10) {
      candidates.push({ y, slope, intercept, length: Math.abs(x2 - x1) })
    }
  }
  candidates.sort((a, b) => a.y - b.y)
  const grouped: TableGuide[] = []
  for (const guide of candidates) {
    const previous = grouped.at(-1)
    if (previous && guide.y - previous.y < Math.max(5, height / 240)) {
      if (guide.length > previous.length) grouped[grouped.length - 1] = guide
    } else grouped.push(guide)
  }
  const valid: TableGuide[] = []
  for (const guide of grouped) {
    const previous = valid.at(-1)
    if ([0, width - 1].every((x) => guide.slope * x + guide.intercept > 2 &&
      guide.slope * x + guide.intercept < height - 3 &&
      (!previous || guide.slope * x + guide.intercept > previous.slope * x + previous.intercept + 5))) valid.push(guide)
  }
  return valid
}
/** Inverse piecewise map keeps all pixels and rejects crossing guides upstream. */
export function fillTableMaps(guides: TableGuide[], width: number, height: number, mapX: Float32Array, mapY: Float32Array): void {
  const anchors = [{ y: 0, slope: 0, intercept: 0, length: width }, ...guides,
    { y: height - 1, slope: 0, intercept: height - 1, length: width }]
  let segment = 0
  for (let y = 0; y < height; y += 1) {
    while (segment < anchors.length - 2 && y > anchors[segment + 1]!.y) segment += 1
    const a = anchors[segment]!, b = anchors[segment + 1]!, ratio = (y - a.y) / (b.y - a.y)
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      mapX[index] = x
      mapY[index] = (1 - ratio) * (a.slope * x + a.intercept) + ratio * (b.slope * x + b.intercept)
    }
  }
}
