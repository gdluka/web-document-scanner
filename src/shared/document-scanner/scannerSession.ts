import type { ScannerQuad } from '../../app/documentScanner.client'
import type { CurvedGuide } from './curvedTableGeometry'
import type { CornerDetection } from './neuralCorners'
export interface GeometryMetadata {
  version: 'curvature-v1'
  sourceWidth: number; sourceHeight: number; outputWidth: number; outputHeight: number
  homography: number[]; guides: CurvedGuide[]; curvatureRequested: boolean; curvatureApplied: boolean
  minimumVerticalStep: number | null; fallbackReason: string | null
}
export interface PreparationMetadata {
  rotation: number; originalWidth: number; originalHeight: number; workWidth: number; workHeight: number
  corners: ScannerQuad | null; crop: { x: number; y: number; width: number; height: number }
  enhance: boolean; geometry: GeometryMetadata | null
  detection?: CornerDetection | null
}
