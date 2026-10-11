import { describe, expect, it } from "vitest"
import { fillTableMaps, selectTableGuides } from "./tableGeometry"
import { defaultScannerOptions, validateScannerOptions } from "./scanner.types"
describe("table rectification", () => {
  it("uses long lines across the table and ignores text fragments and vertical edges", () => {
    const segments = new Int32Array([0, 20, 99, 24, 0, 21, 99, 25, 0, 50, 99, 52, 20, 30, 25, 30, 10, 0, 10, 90])
    const guides = selectTableGuides(segments, 100, 100)
    expect(guides).toHaveLength(2)
    expect(guides[0]!.slope).toBeCloseTo(4 / 99)
  })
  it("rejects crossing guides so the image never folds", () => {
    const guides = selectTableGuides(new Int32Array([0, 40, 999, 140, 0, 120, 999, 20]), 1000, 200)
    expect(guides).toHaveLength(1)
  })
  it("keeps both image boundaries and maps each tilted guide to a horizontal target", () => {
    const width = 100, height = 100, x = new Float32Array(width * height), y = new Float32Array(width * height)
    fillTableMaps([{y:50,slope:0.1,intercept:45,length:99}], width, height, x, y)
    expect(y[0]).toBe(0); expect(y.at(-1)).toBe(99)
    expect(y[50 * width]).toBe(45); expect(y[50 * width + 99]).toBeCloseTo(54.9)
    for(let column=0;column<width;column++) for(let row=1;row<height;row++) expect(y[row*width+column]).toBeGreaterThan(y[(row-1)*width+column]!)
  })
  it("validates finite, bounded settings before allocating image memory", () => {
    expect(() => validateScannerOptions(defaultScannerOptions)).not.toThrow()
    for(const invalid of [{maxSize:10000},{maxSize:NaN},{sharpen:5},{quality:Infinity},{profile:"other"}]) {
      expect(() => validateScannerOptions({...defaultScannerOptions,...invalid} as typeof defaultScannerOptions)).toThrow()
    }
  })
})
