import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocumentCornerDetector, detectDocumentCornersWithModel } from './documentScanner.client'
const corners = { a: { x: 10, y: 90 }, b: { x: 10, y: 10 }, c: { x: 90, y: 10 }, d: { x: 90, y: 90 } }
const image = { width: 100, height: 100, data: new Uint8ClampedArray(40_000) } as ImageData
class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  requests: Array<{ id: number }> = []
  terminated = false
  constructor() { TestWorker.instances.push(this) }
  postMessage(message: { id: number }) { this.requests.push(message) }
  terminate() { this.terminated = true }
  reply(result: unknown = corners, id = this.requests.at(-1)!.id) { this.onmessage?.({ data: { id, result } }) }
}
beforeEach(() => { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker); vi.stubGlobal('window', globalThis) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('camera corner detector', () => {
  it('reuses the worker, normalizes coordinates, and ignores replies from older frames', async () => {
    const detector = createDocumentCornerDetector(), first = detector.detect(image), worker = TestWorker.instances[0]!
    worker.reply(); expect((await first)?.b).toEqual({ x: .1, y: .1 })
    const second = detector.detect(image)
    expect(TestWorker.instances).toHaveLength(1)
    worker.reply(undefined, 1); expect(worker.onmessage).not.toBeNull()
    worker.reply(); expect((await second)?.c).toEqual({ x: .9, y: .1 })
    detector.dispose(); expect(worker.terminated).toBe(true)
  })
  it('cancels pending work immediately when the camera closes', async () => {
    const detector = createDocumentCornerDetector(), pending = detector.detect(image)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    detector.dispose(); await rejected
    expect(TestWorker.instances[0]!.terminated).toBe(true)
  })
  it('discards failed workers and can retry without a hanging operation', async () => {
    vi.useFakeTimers()
    const detector = createDocumentCornerDetector(), pending = detector.detect(image)
    const rejected = expect(pending).rejects.toThrow('demoró demasiado')
    await vi.advanceTimersByTimeAsync(15_000); await rejected
    expect(TestWorker.instances[0]!.terminated).toBe(true)
    const retry = detector.detect(image); TestWorker.instances[1]!.reply(null)
    expect(await retry).toBeNull(); detector.dispose()
  })
  it('recycles older WASM bindings periodically to bound native allocations', async () => {
    const detector = createDocumentCornerDetector()
    for (let i = 0; i < 31; i++) {
      const pending = detector.detect(image)
      TestWorker.instances.at(-1)!.reply(); await pending
    }
    expect(TestWorker.instances).toHaveLength(2)
    expect(TestWorker.instances[0]!.terminated).toBe(true)
    detector.dispose()
  })
})

describe('optional intelligent still detector', () => {
  const normalized = { a: { x: .1, y: .9 }, b: { x: .1, y: .1 }, c: { x: .9, y: .1 }, d: { x: .9, y: .9 } }
  async function neuralWorker() {
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(2))
    return TestWorker.instances[1]!
  }
  it('accepts a validated neural refinement and terminates both workers', async () => {
    const pending = detectDocumentCornersWithModel(image)
    TestWorker.instances[0]!.reply()
    const worker = await neuralWorker()
    worker.reply({ corners: normalized, confidence: .9, rejection: null })
    expect(await pending).toMatchObject({ method: 'neural', corners: normalized, fallbackReason: null })
    expect(TestWorker.instances.every(worker => worker.terminated)).toBe(true)
  })
  it('retains the existing contour on uncertain predictions and records the detector', async () => {
    const pending = detectDocumentCornersWithModel(image)
    TestWorker.instances[0]!.reply()
    ;(await neuralWorker()).reply({ corners: null, confidence: .2, rejection: 'Esquinas inciertas.' })
    expect(await pending).toMatchObject({ method: 'classic', confidence: .2, fallbackReason: 'Esquinas inciertas.', corners: { b: { x: .1, y: .1 } } })
    expect(TestWorker.instances.every(worker => worker.terminated)).toBe(true)
  })
  it('does not crop to an internal text block even when the model reports high activation', async () => {
    const pending = detectDocumentCornersWithModel(image)
    TestWorker.instances[0]!.reply()
    ;(await neuralWorker()).reply({ corners: { a: { x: .3, y: .6 }, b: { x: .3, y: .3 }, c: { x: .6, y: .3 }, d: { x: .6, y: .6 } }, confidence: .95, rejection: null })
    expect(await pending).toMatchObject({ method: 'classic', corners: normalized, confidence: .95, fallbackReason: expect.stringContaining('difiere demasiado') })
  })
  it('can use a neural proposal when the classic engine finds no sheet', async () => {
    const pending = detectDocumentCornersWithModel(image)
    TestWorker.instances[0]!.reply(null)
    ;(await neuralWorker()).reply({ corners: normalized, confidence: .9, rejection: null })
    expect(await pending).toMatchObject({ method: 'neural', corners: normalized })
  })
  it('preserves manual adjustment when both engines are unavailable', async () => {
    const pending = detectDocumentCornersWithModel(image)
    TestWorker.instances[0]!.onerror?.()
    ;(await neuralWorker()).onerror?.()
    expect(await pending).toMatchObject({ method: 'manual', corners: null })
  })
  it('cancels model work without starting more work for a discarded photograph', async () => {
    const controller = new AbortController(), pending = detectDocumentCornersWithModel(image, controller.signal)
    TestWorker.instances[0]!.reply()
    await neuralWorker()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(TestWorker.instances).toHaveLength(2); expect(TestWorker.instances.every(worker => worker.terminated)).toBe(true)
  })
})
