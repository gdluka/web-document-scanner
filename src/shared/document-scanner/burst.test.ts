import { describe, expect, it } from "vitest"
import { alignBurstFrame, burstSharpness, fuseBurst, type BurstFrame } from "./burst"
function frame(dx = 0, dy = 0, noise = 0, seed = 1): BurstFrame {
  const width = 160, height = 200, pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x - dx, sy = y - dy
    const ink = sx > 15 && sx < 145 && sy > 20 && sy < 180 && ((sy % 27 < 2) || (sx % 23 < 5 && sy % 27 > 8 && sy % 27 < 20))
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const value = (ink ? 50 : 220) + (seed / 0xffffffff - .5) * noise, offset = (y * width + x) * 4
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value; pixels[offset + 3] = 255
  }
  return { width, height, pixels }
}
describe("burst fusion", () => {
  it("aligns translated text rather than averaging displaced letters", () => {
    const alignment = alignBurstFrame(frame(), frame(3, -2))!
    expect(alignment.dx).toBeCloseTo(3, 0); expect(alignment.dy).toBeCloseTo(-2, 0)
    const fused = fuseBurst([frame(), frame(3, -2), frame(-2, 1)])
    expect(fused.accepted).toBe(3)
    let error = 0
    const clean = frame()
    for (let i = 0; i < fused.pixels.length; i += 4) error += Math.abs(fused.pixels[i]! - clean.pixels[i]!)
    expect(error / (160 * 200)).toBeLessThan(1)
  })
  it("reduces independent noise without changing dimensions", () => {
    const clean = frame(), inputs = [frame(0, 0, 12, 10), frame(0, 0, 12, 20), frame(0, 0, 12, 30)]
    const fused = fuseBurst(inputs), best = inputs[fused.bestIndex]!
    const mse = (pixels: Uint8ClampedArray) => pixels.reduce((sum, value, index) => sum + (value - clean.pixels[index]!) ** 2, 0) / pixels.length
    expect(fused.accepted).toBe(3); expect(mse(fused.pixels)).toBeLessThan(mse(best.pixels))
    expect([fused.width, fused.height]).toEqual([160, 200])
  })
  it("preserves the reference when another frame has an incompatible size", () => {
    const sharp = frame(), other = { width: 1, height: 1, pixels: new Uint8ClampedArray([255, 255, 255, 255]) }
    const fused = fuseBurst([sharp, other])
    expect(fused.accepted).toBe(1); expect(fused.pixels).toEqual(sharp.pixels)
    expect(burstSharpness(sharp)).toBeGreaterThan(burstSharpness(other))
  })
  it("rejects excessive movement and invalid burst counts", () => {
    expect(alignBurstFrame(frame(), frame(30, 20))).toBeNull()
    expect(() => fuseBurst([frame()])).toThrow()
  })
})
