import { describe, expect, it } from 'vitest'
import { createLiveDocumentTracker, documentFramingGuidance } from './liveDocumentTracking'
import type { ScannerQuad } from '../../app/documentScanner.client'
const quad: ScannerQuad = { a: {x:.1,y:.9}, b: {x:.1,y:.1}, c: {x:.9,y:.1}, d: {x:.9,y:.9} }
function move(x: number, y: number): ScannerQuad {
  return Object.fromEntries(Object.entries(quad).map(([key,p]) => [key,{x:p.x+x,y:p.y+y}])) as unknown as ScannerQuad
}
describe('live document contour and framing', () => {
  it('holds tiny jitter and smooths small changes without altering measurements', () => {
    const tracker = createLiveDocumentTracker(); tracker.update(quad, 0)
    const jitter = move(.002, -.001), tiny = tracker.update(jitter, 500)
    expect(tiny.display).toEqual(quad); expect(tiny.measurement).toEqual(jitter)
    const slight = tracker.update(move(.012, 0), 1000)
    expect(slight.display!.b.x).toBeGreaterThan(.1); expect(slight.display!.b.x).toBeLessThan(.108)
    expect(slight.stable).toBe(true)
  })
  it('rejects a single misshapen corner but accepts a repeatedly detected new shape', () => {
    const tracker = createLiveDocumentTracker(); tracker.update(quad, 0)
    const changed = {...quad, b:{x:.3,y:.12}}
    const first = tracker.update(changed, 500)
    expect(first.display).toEqual(quad); expect(first.confirmed).toBe(false); expect(first.measurement).toBeNull()
    const next = tracker.update(changed, 1000)
    expect(next.display).toEqual(changed); expect(next.confirmed).toBe(true); expect(next.stable).toBe(false)
  })
  it('follows genuine translation and gradually follows zoom instead of freezing the contour', () => {
    const tracker = createLiveDocumentTracker(); tracker.update(quad, 0)
    const shifted = move(.07,0)
    expect(tracker.update(shifted,500).display).toEqual(shifted)
    const zoom = {a:{x:.16,y:.88},b:{x:.16,y:.12},c:{x:.96,y:.12},d:{x:.96,y:.88}}
    expect(tracker.update(zoom,1000).confirmed).toBe(true)
  })
  it('holds a missing contour briefly with an amber state, then removes it', () => {
    const tracker = createLiveDocumentTracker(); tracker.update(quad,0); tracker.update(quad,500)
    expect(documentFramingGuidance(tracker.current(500)).kind).toBe('good')
    const missing = tracker.update(null,1000)
    expect(missing.display).toEqual(quad); expect(documentFramingGuidance(missing).kind).toBe('checking')
    expect(tracker.current(2600).display).toBeNull()
    tracker.reset(); expect(tracker.current(0).display).toBeNull()
  })
  it('never invents a contour before a real valid detection', () => {
    const tracker = createLiveDocumentTracker()
    expect(documentFramingGuidance(tracker.update(null,0)).kind).toBe('searching')
    expect(tracker.update({...quad,b:quad.d},500).display).toBeNull()
  })
  it('indicates apparent distance and position without blocking capture', () => {
    const guidance = (q: ScannerQuad) => { const t=createLiveDocumentTracker();t.update(q,0);return documentFramingGuidance(t.update(q,500)) }
    expect(guidance({a:{x:.3,y:.7},b:{x:.3,y:.3},c:{x:.7,y:.3},d:{x:.7,y:.7}}).kind).toBe('far')
    expect(guidance({...quad,b:{x:.01,y:.1}}).kind).toBe('near')
    expect(guidance({a:{x:.3,y:.8},b:{x:.3,y:.05},c:{x:.95,y:.05},d:{x:.95,y:.8}}).kind).toBe('center')
    expect(guidance({a:{x:.08,y:.92},b:{x:.3,y:.08},c:{x:.7,y:.08},d:{x:.92,y:.92}}).kind).toBe('tilt')
    expect(guidance(quad).kind).toBe('good')
  })
})
