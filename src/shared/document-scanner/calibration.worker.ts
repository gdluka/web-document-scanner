import { loadOpenCV, type OpenCV, type Mat } from './opencvRuntime.worker'
import { calibrationBoard, cameraMatrixAtSize, validateCalibrationViews, validateCalibrationProfile, type CalibrationView, type CameraCalibrationProfile } from './cameraCalibration'
interface Resource { delete(): void }
interface Board extends Resource { generateImage(size: object, output: Mat, margin: number, border: number): void }
interface CalibrationCV extends OpenCV {
  getPredefinedDictionary(id: number): Resource; DICT_4X4_50: number
  aruco_CharucoBoard: new (size: object, square: number, marker: number, dictionary: Resource, ids: Mat) => Board
  aruco_CharucoParameters: new () => Resource; aruco_DetectorParameters: new () => Resource
  aruco_RefineParameters: new (distance: number, correction: number, checkOrder: boolean) => Resource
  aruco_CharucoDetector: new (board: Board, parameters: Resource, detector: Resource, refine: Resource) => Resource & { detectBoard(image: Mat, corners: Mat, ids: Mat): void }
  MatVector: new () => Resource & { push_back(mat: Mat): void }
  CV_32FC2: number; CV_32FC3: number; CV_64FC1: number
  TermCriteria: new (kind: number, iterations: number, epsilon: number) => object; TermCriteria_COUNT: number; TermCriteria_EPS: number
  calibrateCameraExtended(objects: object, images: object, size: object, camera: Mat, distortion: Mat, rotations: object, translations: object, intrinsicStdDev: Mat, extrinsicStdDev: Mat, errors: Mat, flags: number, criteria: object): number
  undistort(source: Mat, output: Mat, camera: Mat, distortion: Mat, newCamera: Mat): void
  exceptionFromPtr(pointer: number): { msg: string }
}
type Request = { id: number; command: 'board' } | { id: number; command: 'detect'; buffer: ArrayBuffer; width: number; height: number } | { id: number; command: 'calibrate'; views: CalibrationView[]; name: string } | { id: number; command: 'preview'; buffer: ArrayBuffer; width: number; height: number; profile: CameraCalibrationProfile }
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(value: unknown, transfer?: Transferable[]): void }
scope.onmessage = async ({ data: request }) => {
  const resources: Resource[] = []; let cv: CalibrationCV | undefined
  const keep = <T extends Resource>(value: T): T => { resources.push(value); return value }
  try {
    cv = await loadOpenCV() as CalibrationCV
    if (request.command === 'board' || request.command === 'detect') {
      const dictionary = keep(cv.getPredefinedDictionary(cv.DICT_4X4_50)), ids = keep(new cv.Mat())
      const board = keep(new cv.aruco_CharucoBoard(new cv.Size(5, 7), .03, .021, dictionary, ids))
      if (request.command === 'board') {
        const image = keep(new cv.Mat()), rgba = keep(new cv.Mat())
        board.generateImage(new cv.Size(1500, 2100), image, 0, 1)
        cv.cvtColor(image, rgba, cv.COLOR_GRAY2RGBA)
        const buffer = rgba.data.slice().buffer
        scope.postMessage({ id: request.id, result: { width: 1500, height: 2100, buffer } }, [buffer])
      } else {
        const input = keep(cv.matFromImageData(new ImageData(new Uint8ClampedArray(request.buffer), request.width, request.height)))
        const gray = keep(new cv.Mat()); cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY)
        const parameters = keep(new cv.aruco_CharucoParameters()), detectorParameters = keep(new cv.aruco_DetectorParameters()), refine = keep(new cv.aruco_RefineParameters(10, 3, true))
        const detector = keep(new cv.aruco_CharucoDetector(board, parameters, detectorParameters, refine))
        const corners = keep(new cv.Mat()), cornerIds = keep(new cv.Mat())
        detector.detectBoard(gray, corners, cornerIds)
        const found = Array.from(cornerIds.data32S), positions = Array.from(corners.data32F)
        scope.postMessage({ id: request.id, result: found.map((id, index) => ({ id, x: positions[index * 2], y: positions[index * 2 + 1] })) })
      }
    } else if (request.command === 'calibrate') {
      validateCalibrationViews(request.views)
      const objects = keep(new cv.MatVector()), images = keep(new cv.MatVector()), rotations = keep(new cv.MatVector()), translations = keep(new cv.MatVector())
      for (const view of request.views) {
        const objectPoints = view.points.flatMap(p => [(p.id % 4 + 1) * .03, (Math.floor(p.id / 4) + 1) * .03, 0])
        objects.push_back(keep(cv.matFromArray(view.points.length, 1, cv.CV_32FC3, objectPoints)))
        images.push_back(keep(cv.matFromArray(view.points.length, 1, cv.CV_32FC2, view.points.flatMap(p => [p.x, p.y]))))
      }
      const first = request.views[0]!, camera = keep(new cv.Mat()), distortion = keep(new cv.Mat()), intrinsicStdDev = keep(new cv.Mat()), extrinsicStdDev = keep(new cv.Mat()), errors = keep(new cv.Mat())
      const rms = cv.calibrateCameraExtended(objects, images, new cv.Size(first.width, first.height), camera, distortion, rotations, translations, intrinsicStdDev, extrinsicStdDev, errors, 0, new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 100, 1e-8))
      const sx = first.sourceWidth / first.width, sy = first.sourceHeight / first.height, k = Array.from(camera.data64F)
      const profile: CameraCalibrationProfile = { version: 1, name: request.name.slice(0, 120), createdAt: new Date().toISOString(), sourceWidth: first.sourceWidth, sourceHeight: first.sourceHeight, analysisWidth: first.width, analysisHeight: first.height,
        cameraMatrix: [k[0]! * sx, 0, k[2]! * sx, 0, k[4]! * sy, k[5]! * sy, 0, 0, 1], distortion: Array.from(distortion.data64F).slice(0, 5), rms, perViewErrors: Array.from(errors.data64F), views: request.views.length, board: calibrationBoard }
      validateCalibrationProfile(profile)
      scope.postMessage({ id: request.id, result: profile })
    } else {
      const k = cameraMatrixAtSize(request.profile, request.width, request.height)
      const input = keep(cv.matFromImageData(new ImageData(new Uint8ClampedArray(request.buffer), request.width, request.height))), output = keep(new cv.Mat())
      const camera = keep(cv.matFromArray(3, 3, cv.CV_64FC1, k)), distortion = keep(cv.matFromArray(1, 5, cv.CV_64FC1, request.profile.distortion))
      cv.undistort(input, output, camera, distortion, camera)
      const buffer = output.data.slice().buffer
      scope.postMessage({ id: request.id, result: { width: request.width, height: request.height, buffer } }, [buffer])
    }
  } catch (error) {
    const message = typeof error === 'number' && cv ? cv.exceptionFromPtr(error).msg : error instanceof Error ? error.message : 'No se pudo ejecutar la calibración.'
    scope.postMessage({ id: request.id, error: message })
  } finally { for (const resource of resources.reverse()) resource.delete() }
}
