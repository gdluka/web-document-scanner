import { describe, expect, it } from "vitest"
import { captureFrameSignature, captureIsReady, measureCaptureQuality, type StabilitySample } from "./captureQuality"
import type { ScannerQuad } from "../../app/documentScanner.client"
const quad: ScannerQuad = { a: { x: .1, y: .9 }, b: { x: .1, y: .1 }, c: { x: .9, y: .1 }, d: { x: .9, y: .9 } }
function paper(blur = 0, background = false) {
  const width = 240, height = 300, data = new Uint8ClampedArray(width * height * 4)
  const ink = (x: number, y: number) => x > 50 && x < 190 && y > 50 && y < 250 && x % 20 < 7 && y % 30 < 14
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = 235
    if (!background || x < 24 || x > 216) {
      let sum = 0, count = 0
      for (let dy = -blur; dy <= blur; dy++) for (let dx = -blur; dx <= blur; dx++) { sum += ink(x + dx, y + dy) ? 35 : 235; count++ }
      value = sum / count
      if (background && (x < 24 || x > 216)) value = (x + y) % 4 < 2 ? 35 : 235
    }
    const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255
  }
  return { width, height, data }
}
describe("single-photo preview readiness", () => {
  it("finds detail in a sharp document and rejects simulated blur", () => {
    const sharp = measureCaptureQuality(paper(), quad), blurry = measureCaptureQuality(paper(4), quad)
    expect(sharp.detail).toBe(true); expect(blurry.detail).toBe(false)
    expect(blurry.edgeSpread!).toBeGreaterThan(sharp.edgeSpread!)
  })
  it("does not count a sharp background as a focused blank page", () => {
    expect(measureCaptureQuality(paper(0, true), quad).detail).toBe(false)
  })
  it("requires recent, stable corners and detail for at least 900ms", () => {
    const quality = measureCaptureQuality(paper(), quad)
    const samples: StabilitySample[] = [0, 500, 1000].map(at => ({ at, quad, quality }))
    expect(captureIsReady(samples)).toBe(true)
    expect(captureIsReady(samples.slice(1))).toBe(false)
    expect(captureIsReady(samples.map((s, i) => ({ ...s, at: i * 100 })))).toBe(false)
    expect(captureIsReady(samples.map((s, i) => ({ ...s, at: i * 2500 })))).toBe(false)
    expect(captureIsReady(samples.map((s, i) => i === 2 ? { ...s, quad: { ...quad, b: { x: .2, y: .1 } } } : s))).toBe(false)
    expect(captureIsReady(samples.map((s, i) => i === 1 ? { ...s, quality: { ...quality, detail: false } } : s))).toBe(false)
  })
  it("rejects movement in the text while the slow detector still reports the same corners", () => {
    const image = paper(), quality = measureCaptureQuality(image, quad)
    const frame = captureFrameSignature(image, quad)
    const moved = { ...image, data: new Uint8ClampedArray(image.data) }
    for (let y = 0; y < image.height; y++) for (let x = 4; x < image.width; x++) {
      const offset = (y * image.width + x) * 4
      moved.data.set(image.data.subarray(offset - 16, offset - 12), offset)
    }
    const samples = [0, 500, 1000].map(at => ({ at, quad, quality, frame }))
    expect(captureIsReady(samples)).toBe(true)
    expect(captureIsReady([samples[0]!, samples[1]!, { ...samples[2]!, frame: captureFrameSignature(moved, quad) }])).toBe(false)
    // Automatic exposure alone is not geometric movement.
    expect(captureIsReady([samples[0]!, samples[1]!, { ...samples[2]!, frame: frame.map(value => value + 8) }])).toBe(true)
  })

})
