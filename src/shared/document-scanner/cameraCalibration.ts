export const calibrationBoard = { columns: 5, rows: 7, squareMeters: .03, markerMeters: .021, corners: 24, dictionary: 'DICT_4X4_50' } as const
export interface CalibrationPoint { id: number; x: number; y: number }
export interface CalibrationView {
  name: string; digest: string; width: number; height: number; sourceWidth: number; sourceHeight: number
  points: CalibrationPoint[]
}
export interface CameraCalibrationProfile {
  version: 1; name: string; createdAt: string; sourceWidth: number; sourceHeight: number
  analysisWidth: number; analysisHeight: number; cameraMatrix: number[]; distortion: number[]
  rms: number; perViewErrors: number[]; views: number; board: typeof calibrationBoard
}
function bounds(view: CalibrationView) {
  const x = view.points.map(p => p.x / view.width), y = view.points.map(p => p.y / view.height)
  return { left: Math.min(...x), right: Math.max(...x), top: Math.min(...y), bottom: Math.max(...y) }
}
export function validateCalibrationView(view: CalibrationView): void {
  if (![view.width, view.height, view.sourceWidth, view.sourceHeight].every(v => Number.isInteger(v) && v >= 200 && v <= 20_000)) throw new Error('La resolución de la foto no es válida.')
  if (view.points.length !== calibrationBoard.corners || new Set(view.points.map(p => p.id)).size !== calibrationBoard.corners) throw new Error('Debe verse el patrón completo: faltan esquinas ChArUco.')
  if (view.points.some(p => !Number.isInteger(p.id) || p.id < 0 || p.id >= 24 || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x >= view.width || p.y < 0 || p.y >= view.height)) throw new Error('Las esquinas del patrón no son válidas.')
  const b = bounds(view)
  if ((b.right - b.left) * (b.bottom - b.top) < .025) throw new Error('El patrón ocupa muy poco de la foto. Acercalo manteniendo todas sus esquinas visibles.')
}
export function validateCalibrationViews(views: CalibrationView[]): void {
  if (views.length < 10 || views.length > 20) throw new Error('Necesitás entre 10 y 20 fotos válidas del patrón.')
  for (const view of views) validateCalibrationView(view)
  const first = views[0]!
  if (views.some(v => v.width !== first.width || v.height !== first.height || v.sourceWidth !== first.sourceWidth || v.sourceHeight !== first.sourceHeight)) throw new Error('Usá la misma cámara, orientación, resolución y zoom en todas las fotos.')
  if (new Set(views.map(v => v.digest)).size !== views.length) throw new Error('Hay fotos repetidas. Tomá capturas distintas del patrón.')
  const unique: CalibrationView[] = []
  for (const v of views) {
    if (!unique.some(other => Math.sqrt(v.points.reduce((sum, p) => {
      const q = other.points.find(q => q.id === p.id)!
      return sum + ((p.x - q.x) / v.width) ** 2 + ((p.y - q.y) / v.height) ** 2
    }, 0) / v.points.length) < .015)) unique.push(v)
  }
  if (unique.length < 8) throw new Error('Las posiciones son demasiado parecidas. Mové e incliná el patrón entre capturas.')
  const all = views.map(bounds)
  if (Math.max(...all.map(b => b.right)) - Math.min(...all.map(b => b.left)) < .5 || Math.max(...all.map(b => b.bottom)) - Math.min(...all.map(b => b.top)) < .5) throw new Error('Faltan fotos hacia los bordes de la imagen para medir la distorsión del lente.')
  const tilted = views.filter(v => {
    const point = (id: number) => v.points.find(p => p.id === id)!
    const a = point(0), b = point(3), c = point(23), d = point(20)
    const length = (p: CalibrationPoint, q: CalibrationPoint) => Math.hypot(p.x - q.x, p.y - q.y)
    const top = length(a, b), bottom = length(d, c), left = length(a, d), right = length(b, c)
    const skew = Math.abs((b.x - a.x) * (d.x - a.x) + (b.y - a.y) * (d.y - a.y)) / (top * left)
    return Math.max(top / bottom, bottom / top, left / right, right / left) > 1.08 || skew > .08
  })
  if (tilted.length < 3) throw new Error('Incluí al menos tres fotos inclinadas: solo las tomas frontales no permiten una calibración fiable.')
}
export function validateCalibrationProfile(profile: CameraCalibrationProfile): void {
  if (!profile || typeof profile !== 'object' || typeof profile.name !== 'string' || !Array.isArray(profile.cameraMatrix) || !Array.isArray(profile.distortion) || !Array.isArray(profile.perViewErrors) || !profile.board || Object.entries(calibrationBoard).some(([key, value]) => profile.board[key as keyof typeof calibrationBoard] !== value)) throw new Error('El archivo no contiene un perfil de calibración compatible.')
  const { cameraMatrix: k, distortion: d } = profile
  if (profile.version !== 1 || ![profile.sourceWidth, profile.sourceHeight, profile.analysisWidth, profile.analysisHeight].every(v => Number.isInteger(v) && v >= 200 && v <= 20_000)) throw new Error('El perfil de cámara no es válido.')
  if (k.length !== 9 || d.length !== 5 || ![...k, ...d, profile.rms, ...profile.perViewErrors].every(Number.isFinite)) throw new Error('La calibración no produjo parámetros válidos.')
  if (profile.views < 10 || profile.perViewErrors.length !== profile.views || profile.rms < 0 || profile.rms > .8 || profile.perViewErrors.some(v => v < 0 || v > 1.5)) throw new Error('El error de calibración es demasiado alto. Repetí las fotos menos nítidas y las inclinadas.')
  if (k[0]! < .2 * profile.sourceWidth || k[0]! > 5 * profile.sourceWidth || k[4]! < .2 * profile.sourceHeight || k[4]! > 5 * profile.sourceHeight || k[2]! < .2 * profile.sourceWidth || k[2]! > .8 * profile.sourceWidth || k[5]! < .2 * profile.sourceHeight || k[5]! > .8 * profile.sourceHeight || Math.abs(k[1]!) > 1e-9 || k[3] !== 0 || k[6] !== 0 || k[7] !== 0 || k[8] !== 1 || d.some(v => Math.abs(v) > 2)) throw new Error('Los parámetros calculados no son fiables para esta cámara. Variá la posición e inclinación del patrón.')
  // Reject folds and extreme magnification when extrapolating beyond the observed pattern.
  for (let row = 0; row <= 12; row++) for (let col = 0; col <= 12; col++) {
    const x = (col / 12 * (profile.sourceWidth - 1) - k[2]!) / k[0]!, y = (row / 12 * (profile.sourceHeight - 1) - k[5]!) / k[4]!
    const r2 = x*x + y*y, radial = 1 + d[0]! * r2 + d[1]! * r2*r2 + d[4]! * r2*r2*r2
    const derivative = 1 + 3*d[0]!*r2 + 5*d[1]!*r2*r2 + 7*d[4]!*r2*r2*r2
    if (radial < .5 || radial > 2 || derivative < .2 || derivative > 3) throw new Error('La corrección estimada de los bordes no es segura. Necesitás más posiciones del patrón cerca de los bordes.')
    const slope = d[0]! + 2*d[1]!*r2 + 3*d[4]!*r2*r2
    const jxx = radial + 2*x*x*slope + 2*d[2]!*y + 6*d[3]!*x
    const jyy = radial + 2*y*y*slope + 6*d[2]!*y + 2*d[3]!*x
    const jxy = 2*x*y*slope + 2*d[2]!*x + 2*d[3]!*y
    const determinant = jxx*jyy-jxy*jxy
    if (!Number.isFinite(determinant) || determinant < .1 || determinant > 9 || jxx < .2 || jyy < .2 || jxx > 3 || jyy > 3) throw new Error('El perfil produce una deformación excesiva. Repetí la calibración con el patrón más repartido en la imagen.')
  }
}
export function cameraMatrixAtSize(profile: CameraCalibrationProfile, width: number, height: number): number[] {
  validateCalibrationProfile(profile)
  if (width < 1 || height < 1 || Math.abs(width / height - profile.sourceWidth / profile.sourceHeight) > .003) throw new Error('La foto no corresponde a las proporciones de este perfil de cámara.')
  const sx = width / profile.sourceWidth, sy = height / profile.sourceHeight
  return [profile.cameraMatrix[0]! * sx, 0, profile.cameraMatrix[2]! * sx, 0, profile.cameraMatrix[4]! * sy, profile.cameraMatrix[5]! * sy, 0, 0, 1]
}
