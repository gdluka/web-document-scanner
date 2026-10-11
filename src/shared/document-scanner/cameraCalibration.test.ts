import { describe, it, expect } from 'vitest'
import { syntheticCalibrationViews } from '../../../tests/calibrationFixture'
import { calibrationBoard, validateCalibrationView, validateCalibrationViews, validateCalibrationProfile, cameraMatrixAtSize, type CameraCalibrationProfile } from './cameraCalibration'
const profile = (): CameraCalibrationProfile => ({ version: 1, name: 'Synthetic camera', createdAt: '2026-10-11T00:00:00Z', sourceWidth: 1280, sourceHeight: 960, analysisWidth: 1280, analysisHeight: 960,
  cameraMatrix: [1050,0,640,0,1040,480,0,0,1], distortion: [-.09,.02,.001,-.002,-.003], rms: .1, perViewErrors: Array(12).fill(.1), views: 12, board: calibrationBoard })
describe('optical calibration checks', () => {
  it('accepts varied known-camera projections', () => expect(() => validateCalibrationViews(syntheticCalibrationViews())).not.toThrow())
  it('requires a complete pattern with distinct IDs', () => {
    const view = syntheticCalibrationViews()[0]!
    expect(() => validateCalibrationView({ ...view, points: view.points.slice(1) })).toThrow(/completo/)
    expect(() => validateCalibrationView({ ...view, points: view.points.map(p => ({ ...p, id: 0 })) })).toThrow(/completo/)
  })
  it('rejects repeated photos and repeated poses with different filenames', () => {
    const views = syntheticCalibrationViews()
    expect(() => validateCalibrationViews(views.map(v => ({ ...v, digest: 'same' })))).toThrow(/repetidas/)
    expect(() => validateCalibrationViews(views.map(v => ({ ...views[0]!, digest: v.digest })))).toThrow(/parecidas/)
  })
  it('rejects mixed resolutions and insufficient views', () => {
    const views = syntheticCalibrationViews(); views[2] = { ...views[2]!, sourceWidth: 1920 }
    expect(() => validateCalibrationViews(views)).toThrow(/misma cámara/)
    expect(() => validateCalibrationViews(views.slice(0, 5))).toThrow(/10 y 20/)
  })
  it('rejects a set of translated but entirely frontal views', () => {
    const base = syntheticCalibrationViews()
    const views = base.map((v, i) => ({ ...v, points: Array.from({ length: 24 }, (_, id) => ({ id, x: 200 + (i % 4) * 170 + (id % 4)*80, y: 180 + Math.floor(i / 4)*160 + Math.floor(id / 4)*70 })) }))
    expect(() => validateCalibrationViews(views)).toThrow(/inclinadas/)
  })
  it('scales focal lengths and principal point without changing distortion', () => {
    const value = profile(); expect(cameraMatrixAtSize(value,640,480)).toEqual([525,0,320,0,520,240,0,0,1]); expect(value.distortion).toEqual([-.09,.02,.001,-.002,-.003])
    expect(() => cameraMatrixAtSize(value,480,640)).toThrow(/proporciones/)
  })
  it('rejects an invalid imported schema and non-finite parameters', () => {
    expect(() => validateCalibrationProfile(null as unknown as CameraCalibrationProfile)).toThrow(/compatible/)
    const value = profile(); value.cameraMatrix[0] = NaN; expect(() => validateCalibrationProfile(value)).toThrow(/válidos/)
  })
  it('rejects high residuals and maps that fold at the image borders', () => {
    expect(() => validateCalibrationProfile({ ...profile(), rms: 2 })).toThrow(/error/)
    expect(() => validateCalibrationProfile({ ...profile(), distortion: [-1.9,0,0,0,0] })).toThrow(/bordes/)
    expect(() => validateCalibrationProfile({ ...profile(), distortion: [0,0,1.8,0,0] })).toThrow(/deformación/)
  })
})
