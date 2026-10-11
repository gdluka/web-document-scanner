export type ScannerProfile = "table" | "document" | "photo"
export type ScannerFormat = "image/jpeg" | "image/png" | "image/webp"
export interface ScannerOptions {
  profile: ScannerProfile
  alignTable: boolean
  normalizeLighting: boolean
  sharpen: number
  maxSize: number
  format: ScannerFormat
  quality: number
}
export interface ScannerMetadata {
  guides: number
  alignmentApplied: boolean
  lightingApplied: boolean
  warnings: string[]
  elapsedMs: number
}
export interface ScannerResult extends ScannerMetadata {
  blob: Blob
  width: number
  height: number
  format: ScannerFormat
}
export const defaultScannerOptions: ScannerOptions = {
  profile: "table", alignTable: false, normalizeLighting: true, sharpen: 0.2,
  maxSize: 2400, format: "image/png", quality: 0.95,
}
export function validateScannerOptions(options: ScannerOptions): void {
  if (!["table", "document", "photo"].includes(options.profile) ||
    !["image/jpeg", "image/png", "image/webp"].includes(options.format) ||
    !Number.isFinite(options.maxSize) || options.maxSize < 600 || options.maxSize > 3000 ||
    !Number.isFinite(options.quality) || options.quality < 0.5 || options.quality > 1 ||
    !Number.isFinite(options.sharpen) || options.sharpen < 0 || options.sharpen > 0.6 ||
    typeof options.alignTable !== "boolean" || typeof options.normalizeLighting !== "boolean") {
    throw new Error("La configuración del escáner no es válida.")
  }
}
