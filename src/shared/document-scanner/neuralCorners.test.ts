import { describe, expect, it } from "vitest"
import { compatibleCornerProposal, decodeDocumentHeatmaps } from "./neuralCorners"

const shape = [1, 4, 32, 32]
function heatmaps() {
  const values = new Float32Array(4 * 32 * 32)
  for (const [channel, x, y] of [[0, 5, 4], [1, 26, 4], [2, 26, 27], [3, 5, 27]]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) values[channel * 1024 + (y + dy) * 32 + x + dx] = dx || dy ? .5 : .9
  }
  return values
}
describe("document heatmap decoding", () => {
  it("returns subpixel normalized corners in scanner order, independent of photo dimensions", () => {
    const decoded = decodeDocumentHeatmaps(heatmaps(), shape)
    expect(decoded.rejection).toBeNull()
    expect(decoded.corners?.b).toEqual({ x: 5.5 / 32, y: 4.5 / 32 })
    expect(decoded.corners?.a).toEqual({ x: 5.5 / 32, y: 27.5 / 32 })
    expect(decoded.confidence).toBeCloseTo(.9)
  })
  it("uses the largest region rather than a stronger isolated false corner", () => {
    const values = heatmaps(); values[16 * 32 + 16] = .99
    expect(decodeDocumentHeatmaps(values, shape).corners?.b).toEqual({ x: 5.5 / 32, y: 4.5 / 32 })
  })
  it("rejects missing, weak, or diffuse corner predictions", () => {
    const missing = heatmaps(); missing.fill(0, 3 * 1024)
    expect(decodeDocumentHeatmaps(missing, shape).corners).toBeNull()
    const weak = heatmaps(); for (let i = 0; i < weak.length; i++) weak[i] = Math.min(weak[i], .55)
    expect(decodeDocumentHeatmaps(weak, shape).corners).toBeNull()
    const diffuse = heatmaps(); diffuse.fill(.8, 0, 1024)
    expect(decodeDocumentHeatmaps(diffuse, shape).corners).toBeNull()
  })
  it("rejects unexpected layouts and non-finite or non-probability values", () => {
    expect(decodeDocumentHeatmaps(heatmaps(), [1, 32, 32, 4]).corners).toBeNull()
    expect(decodeDocumentHeatmaps(new Float32Array(2), shape).corners).toBeNull()
    for (const value of [NaN, Infinity, -1, 2]) {
      const broken = heatmaps(); broken[0] = value
      expect(decodeDocumentHeatmaps(broken, shape).corners).toBeNull()
    }
  })
  it("rejects four activations that collapse into one corner", () => {
    const repeated = heatmaps(); for (let i = 1; i < 4; i++) repeated.copyWithin(i * 1024, 0, 1024)
    expect(decodeDocumentHeatmaps(repeated, shape).corners).toBeNull()
  })
  it("permits small corner refinements but rejects inner text blocks and large jumps", () => {
    const corners = decodeDocumentHeatmaps(heatmaps(), shape).corners!
    expect(compatibleCornerProposal(corners, { ...corners, b: { x: corners.b.x + .01, y: corners.b.y } })).toBe(true)
    const block = { a: { x: .3, y: .6 }, b: { x: .3, y: .3 }, c: { x: .6, y: .3 }, d: { x: .6, y: .6 } }
    expect(compatibleCornerProposal(corners, block)).toBe(false)
    expect(compatibleCornerProposal(corners, { ...corners, b: { x: .35, y: .3 } })).toBe(false)
  })
})
