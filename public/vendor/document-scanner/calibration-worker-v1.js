"use strict";
(() => {
  // src/shared/document-scanner/opencvRuntime.worker.ts
  var scope = globalThis;
  var initializing;
  function loadOpenCV() {
    return initializing ??= (async () => {
      scope.postMessage({ progress: "Cargando motor de imagen\u2026" });
      scope.importScripts(new URL("../opencv/opencv-5.0.0.js", globalThis.location.href).href);
      let cv = scope.cv;
      if (cv instanceof Promise) cv = await cv;
      if (!cv) throw new Error("No se pudo inicializar OpenCV.");
      await new Promise((resolve) => {
        if (cv.Mat) resolve();
        else if (cv.then) cv.then(() => resolve());
        else cv.onRuntimeInitialized = () => resolve();
      });
      delete cv.then;
      if (!cv.Mat || !cv.HoughLinesP || !cv.remap) throw new Error("El motor de imagen no est\xE1 disponible.");
      return cv;
    })();
  }

  // src/shared/document-scanner/cameraCalibration.ts
  var calibrationBoard = { columns: 5, rows: 7, squareMeters: 0.03, markerMeters: 0.021, corners: 24, dictionary: "DICT_4X4_50" };
  function bounds(view) {
    const x = view.points.map((p) => p.x / view.width), y = view.points.map((p) => p.y / view.height);
    return { left: Math.min(...x), right: Math.max(...x), top: Math.min(...y), bottom: Math.max(...y) };
  }
  function validateCalibrationView(view) {
    if (![view.width, view.height, view.sourceWidth, view.sourceHeight].every((v) => Number.isInteger(v) && v >= 200 && v <= 2e4)) throw new Error("La resoluci\xF3n de la foto no es v\xE1lida.");
    if (view.points.length !== calibrationBoard.corners || new Set(view.points.map((p) => p.id)).size !== calibrationBoard.corners) throw new Error("Debe verse el patr\xF3n completo: faltan esquinas ChArUco.");
    if (view.points.some((p) => !Number.isInteger(p.id) || p.id < 0 || p.id >= 24 || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x >= view.width || p.y < 0 || p.y >= view.height)) throw new Error("Las esquinas del patr\xF3n no son v\xE1lidas.");
    const b = bounds(view);
    if ((b.right - b.left) * (b.bottom - b.top) < 0.025) throw new Error("El patr\xF3n ocupa muy poco de la foto. Acercalo manteniendo todas sus esquinas visibles.");
  }
  function validateCalibrationViews(views) {
    if (views.length < 10 || views.length > 20) throw new Error("Necesit\xE1s entre 10 y 20 fotos v\xE1lidas del patr\xF3n.");
    for (const view of views) validateCalibrationView(view);
    const first = views[0];
    if (views.some((v) => v.width !== first.width || v.height !== first.height || v.sourceWidth !== first.sourceWidth || v.sourceHeight !== first.sourceHeight)) throw new Error("Us\xE1 la misma c\xE1mara, orientaci\xF3n, resoluci\xF3n y zoom en todas las fotos.");
    if (new Set(views.map((v) => v.digest)).size !== views.length) throw new Error("Hay fotos repetidas. Tom\xE1 capturas distintas del patr\xF3n.");
    const unique = [];
    for (const v of views) {
      if (!unique.some((other) => Math.sqrt(v.points.reduce((sum, p) => {
        const q = other.points.find((q2) => q2.id === p.id);
        return sum + ((p.x - q.x) / v.width) ** 2 + ((p.y - q.y) / v.height) ** 2;
      }, 0) / v.points.length) < 0.015)) unique.push(v);
    }
    if (unique.length < 8) throw new Error("Las posiciones son demasiado parecidas. Mov\xE9 e inclin\xE1 el patr\xF3n entre capturas.");
    const all = views.map(bounds);
    if (Math.max(...all.map((b) => b.right)) - Math.min(...all.map((b) => b.left)) < 0.5 || Math.max(...all.map((b) => b.bottom)) - Math.min(...all.map((b) => b.top)) < 0.5) throw new Error("Faltan fotos hacia los bordes de la imagen para medir la distorsi\xF3n del lente.");
    const tilted = views.filter((v) => {
      const point = (id) => v.points.find((p) => p.id === id);
      const a = point(0), b = point(3), c = point(23), d = point(20);
      const length = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
      const top = length(a, b), bottom = length(d, c), left = length(a, d), right = length(b, c);
      const skew = Math.abs((b.x - a.x) * (d.x - a.x) + (b.y - a.y) * (d.y - a.y)) / (top * left);
      return Math.max(top / bottom, bottom / top, left / right, right / left) > 1.08 || skew > 0.08;
    });
    if (tilted.length < 3) throw new Error("Inclu\xED al menos tres fotos inclinadas: solo las tomas frontales no permiten una calibraci\xF3n fiable.");
  }
  function validateCalibrationProfile(profile) {
    if (!profile || typeof profile !== "object" || typeof profile.name !== "string" || !Array.isArray(profile.cameraMatrix) || !Array.isArray(profile.distortion) || !Array.isArray(profile.perViewErrors) || !profile.board || Object.entries(calibrationBoard).some(([key, value]) => profile.board[key] !== value)) throw new Error("El archivo no contiene un perfil de calibraci\xF3n compatible.");
    const { cameraMatrix: k, distortion: d } = profile;
    if (profile.version !== 1 || ![profile.sourceWidth, profile.sourceHeight, profile.analysisWidth, profile.analysisHeight].every((v) => Number.isInteger(v) && v >= 200 && v <= 2e4)) throw new Error("El perfil de c\xE1mara no es v\xE1lido.");
    if (k.length !== 9 || d.length !== 5 || ![...k, ...d, profile.rms, ...profile.perViewErrors].every(Number.isFinite)) throw new Error("La calibraci\xF3n no produjo par\xE1metros v\xE1lidos.");
    if (profile.views < 10 || profile.perViewErrors.length !== profile.views || profile.rms < 0 || profile.rms > 0.8 || profile.perViewErrors.some((v) => v < 0 || v > 1.5)) throw new Error("El error de calibraci\xF3n es demasiado alto. Repet\xED las fotos menos n\xEDtidas y las inclinadas.");
    if (k[0] < 0.2 * profile.sourceWidth || k[0] > 5 * profile.sourceWidth || k[4] < 0.2 * profile.sourceHeight || k[4] > 5 * profile.sourceHeight || k[2] < 0.2 * profile.sourceWidth || k[2] > 0.8 * profile.sourceWidth || k[5] < 0.2 * profile.sourceHeight || k[5] > 0.8 * profile.sourceHeight || Math.abs(k[1]) > 1e-9 || k[3] !== 0 || k[6] !== 0 || k[7] !== 0 || k[8] !== 1 || d.some((v) => Math.abs(v) > 2)) throw new Error("Los par\xE1metros calculados no son fiables para esta c\xE1mara. Vari\xE1 la posici\xF3n e inclinaci\xF3n del patr\xF3n.");
    for (let row = 0; row <= 12; row++) for (let col = 0; col <= 12; col++) {
      const x = (col / 12 * (profile.sourceWidth - 1) - k[2]) / k[0], y = (row / 12 * (profile.sourceHeight - 1) - k[5]) / k[4];
      const r2 = x * x + y * y, radial = 1 + d[0] * r2 + d[1] * r2 * r2 + d[4] * r2 * r2 * r2;
      const derivative = 1 + 3 * d[0] * r2 + 5 * d[1] * r2 * r2 + 7 * d[4] * r2 * r2 * r2;
      if (radial < 0.5 || radial > 2 || derivative < 0.2 || derivative > 3) throw new Error("La correcci\xF3n estimada de los bordes no es segura. Necesit\xE1s m\xE1s posiciones del patr\xF3n cerca de los bordes.");
      const slope = d[0] + 2 * d[1] * r2 + 3 * d[4] * r2 * r2;
      const jxx = radial + 2 * x * x * slope + 2 * d[2] * y + 6 * d[3] * x;
      const jyy = radial + 2 * y * y * slope + 6 * d[2] * y + 2 * d[3] * x;
      const jxy = 2 * x * y * slope + 2 * d[2] * x + 2 * d[3] * y;
      const determinant = jxx * jyy - jxy * jxy;
      if (!Number.isFinite(determinant) || determinant < 0.1 || determinant > 9 || jxx < 0.2 || jyy < 0.2 || jxx > 3 || jyy > 3) throw new Error("El perfil produce una deformaci\xF3n excesiva. Repet\xED la calibraci\xF3n con el patr\xF3n m\xE1s repartido en la imagen.");
    }
  }
  function cameraMatrixAtSize(profile, width, height) {
    validateCalibrationProfile(profile);
    if (width < 1 || height < 1 || Math.abs(width / height - profile.sourceWidth / profile.sourceHeight) > 3e-3) throw new Error("La foto no corresponde a las proporciones de este perfil de c\xE1mara.");
    const sx = width / profile.sourceWidth, sy = height / profile.sourceHeight;
    return [profile.cameraMatrix[0] * sx, 0, profile.cameraMatrix[2] * sx, 0, profile.cameraMatrix[4] * sy, profile.cameraMatrix[5] * sy, 0, 0, 1];
  }

  // src/shared/document-scanner/calibration.worker.ts
  var scope2 = globalThis;
  scope2.onmessage = async ({ data: request }) => {
    const resources = [];
    let cv;
    const keep = (value) => {
      resources.push(value);
      return value;
    };
    try {
      cv = await loadOpenCV();
      if (request.command === "board" || request.command === "detect") {
        const dictionary = keep(cv.getPredefinedDictionary(cv.DICT_4X4_50)), ids = keep(new cv.Mat());
        const board = keep(new cv.aruco_CharucoBoard(new cv.Size(5, 7), 0.03, 0.021, dictionary, ids));
        if (request.command === "board") {
          const image = keep(new cv.Mat()), rgba = keep(new cv.Mat());
          board.generateImage(new cv.Size(1500, 2100), image, 0, 1);
          cv.cvtColor(image, rgba, cv.COLOR_GRAY2RGBA);
          const buffer = rgba.data.slice().buffer;
          scope2.postMessage({ id: request.id, result: { width: 1500, height: 2100, buffer } }, [buffer]);
        } else {
          const input = keep(cv.matFromImageData(new ImageData(new Uint8ClampedArray(request.buffer), request.width, request.height)));
          const gray = keep(new cv.Mat());
          cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
          const parameters = keep(new cv.aruco_CharucoParameters()), detectorParameters = keep(new cv.aruco_DetectorParameters()), refine = keep(new cv.aruco_RefineParameters(10, 3, true));
          const detector = keep(new cv.aruco_CharucoDetector(board, parameters, detectorParameters, refine));
          const corners = keep(new cv.Mat()), cornerIds = keep(new cv.Mat());
          detector.detectBoard(gray, corners, cornerIds);
          const found = Array.from(cornerIds.data32S), positions = Array.from(corners.data32F);
          scope2.postMessage({ id: request.id, result: found.map((id, index) => ({ id, x: positions[index * 2], y: positions[index * 2 + 1] })) });
        }
      } else if (request.command === "calibrate") {
        validateCalibrationViews(request.views);
        const objects = keep(new cv.MatVector()), images = keep(new cv.MatVector()), rotations = keep(new cv.MatVector()), translations = keep(new cv.MatVector());
        for (const view of request.views) {
          const objectPoints = view.points.flatMap((p) => [(p.id % 4 + 1) * 0.03, (Math.floor(p.id / 4) + 1) * 0.03, 0]);
          objects.push_back(keep(cv.matFromArray(view.points.length, 1, cv.CV_32FC3, objectPoints)));
          images.push_back(keep(cv.matFromArray(view.points.length, 1, cv.CV_32FC2, view.points.flatMap((p) => [p.x, p.y]))));
        }
        const first = request.views[0], camera = keep(new cv.Mat()), distortion = keep(new cv.Mat()), intrinsicStdDev = keep(new cv.Mat()), extrinsicStdDev = keep(new cv.Mat()), errors = keep(new cv.Mat());
        const rms = cv.calibrateCameraExtended(objects, images, new cv.Size(first.width, first.height), camera, distortion, rotations, translations, intrinsicStdDev, extrinsicStdDev, errors, 0, new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 100, 1e-8));
        const sx = first.sourceWidth / first.width, sy = first.sourceHeight / first.height, k = Array.from(camera.data64F);
        const profile = {
          version: 1,
          name: request.name.slice(0, 120),
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          sourceWidth: first.sourceWidth,
          sourceHeight: first.sourceHeight,
          analysisWidth: first.width,
          analysisHeight: first.height,
          cameraMatrix: [k[0] * sx, 0, k[2] * sx, 0, k[4] * sy, k[5] * sy, 0, 0, 1],
          distortion: Array.from(distortion.data64F).slice(0, 5),
          rms,
          perViewErrors: Array.from(errors.data64F),
          views: request.views.length,
          board: calibrationBoard
        };
        validateCalibrationProfile(profile);
        scope2.postMessage({ id: request.id, result: profile });
      } else {
        const k = cameraMatrixAtSize(request.profile, request.width, request.height);
        const input = keep(cv.matFromImageData(new ImageData(new Uint8ClampedArray(request.buffer), request.width, request.height))), output = keep(new cv.Mat());
        const camera = keep(cv.matFromArray(3, 3, cv.CV_64FC1, k)), distortion = keep(cv.matFromArray(1, 5, cv.CV_64FC1, request.profile.distortion));
        cv.undistort(input, output, camera, distortion, camera);
        const buffer = output.data.slice().buffer;
        scope2.postMessage({ id: request.id, result: { width: request.width, height: request.height, buffer } }, [buffer]);
      }
    } catch (error) {
      const message = typeof error === "number" && cv ? cv.exceptionFromPtr(error).msg : error instanceof Error ? error.message : "No se pudo ejecutar la calibraci\xF3n.";
      scope2.postMessage({ id: request.id, error: message });
    } finally {
      for (const resource of resources.reverse()) resource.delete();
    }
  };
})();
