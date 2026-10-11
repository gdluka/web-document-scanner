import type { CalibrationView } from '../src/shared/document-scanner/cameraCalibration'
/** Independent pinhole projection with known radial/tangential distortion. */
export function syntheticCalibrationViews(distortion = true): CalibrationView[] {
  const poses = [[-.25,-.25,0,-.10,-.075,.45],[.25,-.2,.08,.10,-.08,.43],[-.2,.25,-.05,-.1,.08,.42],[.28,.22,.02,.1,.08,.43],[0,.33,-.06,0,0,.35],[.32,0,-.08,0,.03,.37],[-.3,0,.12,-.075,0,.39],[0,-.32,.13,.075,0,.38],[.16,-.16,-.14,0,-.075,.5],[-.18,.22,.18,0,.075,.5],[.22,.12,0,-.1,-.02,.52],[-.22,-.12,.02,.1,.02,.52]]
  return poses.map(([rx, ry, rz, tx, ty, tz], index) => ({ name: `synthetic-${index}`, digest: `synthetic-${index}`, width: 1280, height: 960, sourceWidth: 1280, sourceHeight: 960,
    points: Array.from({ length: 24 }, (_, id) => {
      let x = (id % 4 + 1) * .03 - .075, y = (Math.floor(id / 4) + 1) * .03 - .105, z = 0
      ;[y, z] = [Math.cos(rx) * y - Math.sin(rx) * z, Math.sin(rx) * y + Math.cos(rx) * z]
      ;[x, z] = [Math.cos(ry) * x + Math.sin(ry) * z, -Math.sin(ry) * x + Math.cos(ry) * z]
      ;[x, y] = [Math.cos(rz) * x - Math.sin(rz) * y, Math.sin(rz) * x + Math.cos(rz) * y]
      x = (x + tx) / (z + tz); y = (y + ty) / (z + tz)
      const r2 = x*x + y*y, radial = distortion ? 1 - .09*r2 + .02*r2*r2 - .003*r2*r2*r2 : 1, p1 = distortion ? .001 : 0, p2 = distortion ? -.002 : 0
      return { id, x: 1050 * (x*radial + 2*p1*x*y + p2*(r2+2*x*x)) + 640, y: 1040 * (y*radial + p1*(r2+2*y*y) + 2*p2*x*y) + 480 }
    }) }))
}
