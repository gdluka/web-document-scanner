import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureDocumentPhoto, requestDocumentFocus, waitForCamera } from "./cameraCapture.client"
import type { ScannerQuad } from "../../app/documentScanner.client"
const quad: ScannerQuad = { a: { x: .1, y: .9 }, b: { x: .1, y: .1 }, c: { x: .9, y: .1 }, d: { x: .9, y: .9 } }
const track = (modes = ["continuous"]) => ({ getCapabilities: () => ({ focusMode: modes }), getConstraints: () => ({ width: { ideal: 2560 }, focusMode: "manual", focusDistance: .5, advanced: [{ focusMode: "continuous", pointsOfInterest: [{ x: .1, y: .1 }] }, { zoom: 1 }] }), applyConstraints: vi.fn().mockResolvedValue(undefined) })
beforeEach(() => { vi.stubGlobal("navigator", { mediaDevices: { getSupportedConstraints: () => ({ pointsOfInterest: true }) } }) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe("document camera focus and capture", () => {
  it("requests the page center, replaces the previous focus point and preserves video constraints", async () => {
    const camera = track()
    expect(await requestDocumentFocus(camera as unknown as MediaStreamTrack, quad)).toEqual({ mode: "continuous", pointRequested: true })
    expect(camera.applyConstraints.mock.calls[0]![0]).toEqual({ width: { ideal: 2560 }, advanced: [{ zoom: 1 }, { focusMode: "continuous", pointsOfInterest: [{ x: .5, y: .5 }] }] })
  })
  it("uses one-shot focus when continuous autofocus is unavailable", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getSupportedConstraints: () => ({ pointsOfInterest: false }) } })
    const camera = track(["single-shot"])
    expect(await requestDocumentFocus(camera as unknown as MediaStreamTrack, quad)).toEqual({ mode: "single-shot", pointRequested: false })
  })
  it("leaves the device in control when manual focus is the only exposed mode", async () => {
    const camera = track(["manual"])
    expect((await requestDocumentFocus(camera as unknown as MediaStreamTrack, quad)).mode).toBe("device")
    expect(camera.applyConstraints).not.toHaveBeenCalled()
  })
  it("retries autofocus without a rejected point of interest", async () => {
    const camera = track(); camera.applyConstraints.mockRejectedValueOnce(new Error("unsupported point"))
    expect(await requestDocumentFocus(camera as unknown as MediaStreamTrack, quad)).toEqual({ mode: "continuous", pointRequested: false })
    expect(camera.applyConstraints.mock.calls[1]![0].advanced.at(-1)).toEqual({ focusMode: "continuous" })
  })
  it("handles missing or rejected controls and bounds an unresponsive camera", async () => {
    expect((await requestDocumentFocus({} as MediaStreamTrack)).mode).toBe("device")
    const camera = track(); camera.applyConstraints.mockRejectedValue(new Error("unsupported"))
    expect((await requestDocumentFocus(camera as unknown as MediaStreamTrack)).mode).toBe("device")
    vi.useFakeTimers(); camera.applyConstraints.mockImplementation(() => new Promise(() => {}))
    const pending = requestDocumentFocus(camera as unknown as MediaStreamTrack)
    await vi.advanceTimersByTimeAsync(2500)
    expect((await pending).mode).toBe("device")
  })
  it("requests the maximum still-photo dimensions and retries default settings", async () => {
    const takePhoto = vi.fn().mockRejectedValueOnce(new Error("dimensions unsupported")).mockResolvedValue(new Blob(["photo"], { type: "image/jpeg" }))
    vi.stubGlobal("ImageCapture", class { getPhotoCapabilities() { return Promise.resolve({ imageWidth: { max: 4000 }, imageHeight: { max: 3000 } }) }; takePhoto = takePhoto })
    const file = await captureDocumentPhoto({} as MediaStreamTrack, {} as HTMLVideoElement, new AbortController().signal)
    expect(takePhoto.mock.calls).toEqual([[{ imageWidth: 4000, imageHeight: 3000 }], []])
    expect(file.type).toBe("image/jpeg"); expect(await file.text()).toBe("photo")
  })
  it("discards an outstanding photo when the user cancels", async () => {
    let finish!: (value: Blob) => void
    vi.stubGlobal("ImageCapture", class { takePhoto() { return new Promise<Blob>(resolve => { finish = resolve }) } })
    const controller = new AbortController(), pending = captureDocumentPhoto({} as MediaStreamTrack, {} as HTMLVideoElement, controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    controller.abort(); finish(new Blob(["late photo"], { type: "image/jpeg" })); await rejected
  })
  it("cancels focus and settling waits without leaving timers pending", async () => {
    vi.useFakeTimers(); const controller = new AbortController(), camera = track()
    camera.applyConstraints.mockImplementation(() => new Promise(() => {}))
    const focusing = expect(requestDocumentFocus(camera as unknown as MediaStreamTrack, quad, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    const settling = expect(waitForCamera(8000, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    controller.abort(); await Promise.all([focusing, settling]); expect(vi.getTimerCount()).toBe(0)
  })
})
