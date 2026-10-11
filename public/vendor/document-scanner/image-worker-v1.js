"use strict";
(() => {
  // src/shared/document-scanner/curvedTableGeometry.ts
  var evaluate = (c, x) => ((c[3] * x + c[2]) * x + c[1]) * x + c[0];
  var median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? Infinity;
  function fitCubicQR(xs, ys) {
    if (xs.length !== ys.length || xs.length < 4 || [...xs, ...ys].some((v) => !Number.isFinite(v))) return null;
    const q = [], r = Array.from({ length: 4 }, () => Array(4).fill(0));
    for (let j = 0; j < 4; j++) {
      const column = xs.map((x) => x ** j);
      for (let pass = 0; pass < 2; pass++) for (let k = 0; k < j; k++) {
        const dot = column.reduce((sum, value, i) => sum + value * q[k][i], 0);
        r[k][j] += dot;
        for (let i = 0; i < column.length; i++) column[i] -= dot * q[k][i];
      }
      const length = Math.hypot(...column);
      if (length < 1e-9) return null;
      r[j][j] = length;
      q.push(column.map((v) => v / length));
    }
    const coefficients = Array(4).fill(0);
    for (let j = 3; j >= 0; j--) {
      let value = q[j].reduce((sum, v, i) => sum + v * ys[i], 0);
      for (let k = j + 1; k < 4; k++) value -= r[j][k] * coefficients[k];
      coefficients[j] = value / r[j][j];
    }
    return coefficients.every(Number.isFinite) ? coefficients : null;
  }
  function detectCurvedGuides(rules, width, height) {
    if (rules.length !== width * height) return [];
    const xs = Array.from({ length: 45 }, (_, i) => Math.round(width * (0.045 + 0.92 * i / 44)));
    const peaks = xs.map((x) => {
      const found = [];
      let start = -1;
      const lo = Math.max(0, x - 12), hi = Math.min(width, x + 13);
      for (let y = 0; y <= height; y++) {
        let sum = 0;
        if (y < height) for (let j = lo; j < hi; j++) sum += rules[y * width + j] / 255;
        if (y < height && sum / (hi - lo) > 0.45) {
          if (start < 0) start = y;
        } else if (start >= 0) {
          if (y - start <= 7) found.push((start + y - 1) / 2);
          start = -1;
        }
      }
      return found;
    });
    const middle = 22, guides = [];
    for (const seed of peaks[middle]) {
      if (seed < 40 || seed > height - 40) continue;
      const ys = xs.map(() => null);
      ys[middle] = seed;
      for (const direction of [-1, 1]) {
        let previous2 = seed, slope = 0;
        for (let j = middle + direction; j >= 0 && j < xs.length; j += direction) {
          const predicted = previous2 + slope;
          const near = peaks[j].filter((y) => Math.abs(y - predicted) < Math.max(7, height * 4e-3)).sort((a, b) => Math.abs(a - predicted) - Math.abs(b - predicted));
          if (near.length) {
            const value = near[0];
            ys[j] = value;
            slope = 0.5 * slope + 0.5 * (value - previous2);
            previous2 = value;
          } else previous2 = predicted;
        }
      }
      const samples = xs.flatMap((x, i) => ys[i] === null ? [] : [{ x: x / width, y: ys[i] }]);
      if (samples.length < xs.length * 0.8) continue;
      const coefficients = fitCubicQR(samples.map((p) => p.x), samples.map((p) => p.y));
      if (!coefficients || median(samples.map((p) => Math.abs(evaluate(coefficients, p.x) - p.y))) > 2.5) continue;
      const previous = guides.at(-1);
      let valid = true;
      for (let x = 0; x < width; x++) {
        const y = evaluate(coefficients, x / width);
        if (!Number.isFinite(y) || y < 2 || y > height - 3 || previous && y - evaluate(previous.coefficients, x / width) < 8) {
          valid = false;
          break;
        }
      }
      if (valid) guides.push({ coefficients, targetY: evaluate(coefficients, Math.floor(width / 2) / width) });
    }
    return guides;
  }
  function inverseHomography(m) {
    if (m.length !== 9 || !m.every(Number.isFinite)) return null;
    const [a, b, c, d, e, f, g, h, i] = m;
    const adj = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
    const determinant = a * adj[0] + b * adj[3] + c * adj[6];
    return Math.abs(determinant) > 1e-12 ? adj.map((v) => v / determinant) : null;
  }
  function fillCombinedCurvatureMaps(guides, width, height, homography, mapX, mapY) {
    const inverse = inverseHomography(homography);
    if (!inverse || guides.length < 4 || guides.length > 200 || width < 2 || height < 2 || mapX.length !== width * height || mapY.length !== mapX.length) return null;
    const anchors = [{ coefficients: [0, 0, 0, 0], targetY: 0 }, ...guides, { coefficients: [height - 1, 0, 0, 0], targetY: height - 1 }];
    if (anchors.some((g, i) => g.coefficients.length !== 4 || !g.coefficients.every(Number.isFinite) || !Number.isFinite(g.targetY) || i > 0 && g.targetY <= anchors[i - 1].targetY)) return null;
    const positions = new Float64Array(anchors.length * width);
    for (let j = 0; j < anchors.length; j++) for (let x = 0; x < width; x++) positions[j * width + x] = evaluate(anchors[j].coefficients, x / width);
    let minimumStep = Infinity;
    for (let j = 1; j < anchors.length; j++) for (let x = 0; x < width; x++) {
      const step = (positions[j * width + x] - positions[(j - 1) * width + x]) / (anchors[j].targetY - anchors[j - 1].targetY);
      if (!Number.isFinite(step) || step < 0.2 || step > 5) return null;
      minimumStep = Math.min(minimumStep, step);
    }
    let segment = 0;
    for (let y = 0; y < height; y++) {
      while (segment < anchors.length - 2 && y > anchors[segment + 1].targetY) segment++;
      const fraction = (y - anchors[segment].targetY) / (anchors[segment + 1].targetY - anchors[segment].targetY);
      const lowerOffset = segment * width, upperOffset = (segment + 1) * width, rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const curvedY = positions[lowerOffset + x] + fraction * (positions[upperOffset + x] - positions[lowerOffset + x]);
        const denominator = inverse[6] * x + inverse[7] * curvedY + inverse[8];
        if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return null;
        const sourceX = (inverse[0] * x + inverse[1] * curvedY + inverse[2]) / denominator;
        const sourceY = (inverse[3] * x + inverse[4] * curvedY + inverse[5]) / denominator;
        if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return null;
        const index = rowOffset + x;
        mapX[index] = sourceX;
        mapY[index] = sourceY;
      }
    }
    return minimumStep;
  }

  // src/shared/document-scanner/tableGeometry.ts
  function selectTableGuides(segments, width, height) {
    const candidates = [];
    for (let i = 0; i + 3 < segments.length; i += 4) {
      const x1 = segments[i], y1 = segments[i + 1], x2 = segments[i + 2], y2 = segments[i + 3];
      if (x2 === x1) continue;
      const slope = (y2 - y1) / (x2 - x1), intercept = y1 - slope * x1;
      const y = slope * width / 2 + intercept;
      if (Math.abs(slope) <= 0.12 && Math.abs(x2 - x1) >= width * 0.45 && Math.min(x1, x2) < width * 0.35 && Math.max(x1, x2) > width * 0.75 && y > 10 && y < height - 10) {
        candidates.push({ y, slope, intercept, length: Math.abs(x2 - x1) });
      }
    }
    candidates.sort((a, b) => a.y - b.y);
    const grouped = [];
    for (const guide of candidates) {
      const previous = grouped.at(-1);
      if (previous && guide.y - previous.y < Math.max(5, height / 240)) {
        if (guide.length > previous.length) grouped[grouped.length - 1] = guide;
      } else grouped.push(guide);
    }
    const valid = [];
    for (const guide of grouped) {
      const previous = valid.at(-1);
      if ([0, width - 1].every((x) => guide.slope * x + guide.intercept > 2 && guide.slope * x + guide.intercept < height - 3 && (!previous || guide.slope * x + guide.intercept > previous.slope * x + previous.intercept + 5))) valid.push(guide);
    }
    return valid;
  }
  function fillTableMaps(guides, width, height, mapX, mapY) {
    const anchors = [
      { y: 0, slope: 0, intercept: 0, length: width },
      ...guides,
      { y: height - 1, slope: 0, intercept: height - 1, length: width }
    ];
    let segment = 0;
    for (let y = 0; y < height; y += 1) {
      while (segment < anchors.length - 2 && y > anchors[segment + 1].y) segment += 1;
      const a = anchors[segment], b = anchors[segment + 1], ratio = (y - a.y) / (b.y - a.y);
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        mapX[index] = x;
        mapY[index] = (1 - ratio) * (a.slope * x + a.intercept) + ratio * (b.slope * x + b.intercept);
      }
    }
  }

  // src/shared/document-scanner/scanner.worker.ts
  var scope = globalThis;
  var initializing;
  function loadOpenCV() {
    return initializing ??= (async () => {
      scope.postMessage({ progress: "Cargando motor de imagen\u2026" });
      scope.importScripts(new URL("../opencv/opencv-4.12.0.js", globalThis.location.href).href);
      const cv = scope.cv;
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
  scope.onmessage = (event) => {
    void ("msg" in event.data ? perspective(event.data) : process(event.data)).catch(() => scope.postMessage({ error: "No se pudo procesar la imagen. Prob\xE1 reducir la resoluci\xF3n o usar la foto original." }));
  };
  async function perspective({ msg }) {
    const cv = await loadOpenCV(), resources = [];
    const keep = (value) => {
      resources.push(value);
      return value;
    };
    try {
      const source = keep(cv.matFromImageData(msg.data)), output = keep(new cv.Mat());
      const points = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [msg.region.b.x, msg.region.b.y, msg.region.c.x, msg.region.c.y, msg.region.d.x, msg.region.d.y, msg.region.a.x, msg.region.a.y]));
      const target = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, msg.targetWidth - 1, 0, msg.targetWidth - 1, msg.targetHeight - 1, 0, msg.targetHeight - 1]));
      const matrix = keep(cv.getPerspectiveTransform(points, target));
      const width = msg.targetWidth, height = msg.targetHeight;
      const homography = Array.from(matrix.data64F);
      const geometry = {
        version: "curvature-v1",
        sourceWidth: msg.data.width,
        sourceHeight: msg.data.height,
        outputWidth: width,
        outputHeight: height,
        homography,
        guides: [],
        curvatureRequested: !!msg.correctCurvature,
        curvatureApplied: false,
        minimumVerticalStep: null,
        fallbackReason: null
      };
      if (msg.correctCurvature) {
        try {
          scope.postMessage({ progress: "Buscando curvas de la tabla\u2026" });
          const preview = keep(new cv.Mat()), gray = keep(new cv.Mat()), binary = keep(new cv.Mat()), rules = keep(new cv.Mat());
          cv.warpPerspective(source, preview, matrix, new cv.Size(width, height), cv.INTER_LANCZOS4, cv.BORDER_REPLICATE);
          cv.cvtColor(preview, gray, cv.COLOR_RGBA2GRAY);
          cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 41, 10);
          const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(15, Math.floor(width / 80)), 1)));
          cv.morphologyEx(binary, rules, cv.MORPH_OPEN, kernel);
          geometry.guides = detectCurvedGuides(rules.data, width, height);
          if (geometry.guides.length >= 4) {
            const mapX = keep(new cv.Mat(height, width, cv.CV_32FC1)), mapY = keep(new cv.Mat(height, width, cv.CV_32FC1));
            const minimum = fillCombinedCurvatureMaps(geometry.guides, width, height, homography, mapX.data32F, mapY.data32F);
            if (minimum !== null) {
              cv.remap(source, output, mapX, mapY, cv.INTER_LANCZOS4, cv.BORDER_REPLICATE);
              geometry.curvatureApplied = true;
              geometry.minimumVerticalStep = minimum;
            } else geometry.fallbackReason = "El mapa de curvas no es fiable. Se aplic\xF3 solo perspectiva.";
          } else geometry.fallbackReason = "No hay suficientes curvas fiables. Se aplic\xF3 solo perspectiva.";
        } catch {
          geometry.curvatureApplied = false;
          geometry.minimumVerticalStep = null;
          geometry.fallbackReason = "No se pudo corregir la curvatura. Se aplic\xF3 solo perspectiva.";
        }
      }
      if (!geometry.curvatureApplied) cv.warpPerspective(source, output, matrix, new cv.Size(width, height), cv.INTER_LANCZOS4, cv.BORDER_REPLICATE);
      const data = new ImageData(new Uint8ClampedArray(output.data), width, height);
      scope.postMessage({ result: msg.returnMetadata ? { image: data, geometry } : data }, [data.data.buffer]);
    } finally {
      for (const resource of resources.reverse()) resource.delete();
    }
  }
  async function process(request) {
    const cv = await loadOpenCV(), { width, height, options } = request;
    const started = performance.now(), resources = [];
    const mat = (rows, cols, type) => {
      const result = rows === void 0 ? new cv.Mat() : new cv.Mat(rows, cols, type);
      resources.push(result);
      return result;
    };
    try {
      const source = cv.matFromImageData(new ImageData(new Uint8ClampedArray(request.buffer), width, height));
      resources.push(source);
      let output = source;
      const gray = mat();
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      const metadata = { guides: 0, alignmentApplied: false, lightingApplied: false, elapsedMs: 0, warnings: [] };
      if (options.alignTable) {
        scope.postMessage({ progress: "Buscando l\xEDneas de la tabla\u2026" });
        const edges = mat(), segments = mat(), preview = mat();
        const detectionScale = Math.min(1, 900 / Math.max(width, height));
        const previewWidth = Math.max(1, Math.round(width * detectionScale)), previewHeight = Math.max(1, Math.round(height * detectionScale));
        cv.resize(gray, preview, new cv.Size(previewWidth, previewHeight));
        cv.Canny(preview, edges, 60, 160);
        cv.HoughLinesP(edges, segments, 1, Math.PI / 720, Math.max(30, Math.round(previewWidth * 0.085)), previewWidth * 0.45, previewWidth * 0.05);
        const scaledSegments = Int32Array.from(segments.data32S, (coordinate) => Math.round(coordinate / detectionScale));
        const guides = selectTableGuides(scaledSegments, width, height);
        metadata.guides = guides.length;
        if (guides.length >= 4) {
          scope.postMessage({ progress: "Enderezando las filas\u2026" });
          const mapX = mat(height, width, cv.CV_32FC1), mapY = mat(height, width, cv.CV_32FC1), aligned = mat();
          fillTableMaps(guides, width, height, mapX.data32F, mapY.data32F);
          cv.remap(source, aligned, mapX, mapY, cv.INTER_CUBIC, cv.BORDER_REPLICATE);
          output = aligned;
          metadata.alignmentApplied = true;
          cv.cvtColor(output, gray, cv.COLOR_RGBA2GRAY);
        } else metadata.warnings.push("No hay suficientes l\xEDneas fiables. Se conserv\xF3 la geometr\xEDa de la foto preparada.");
      }
      const processed = new Uint8ClampedArray(output.data);
      if (options.normalizeLighting) {
        scope.postMessage({ progress: "Compensando sombras e iluminaci\xF3n\u2026" });
        const background = mat(), small = mat(), smooth = mat();
        const lightingScale = Math.min(1, 480 / Math.max(width, height));
        const smallWidth = Math.max(1, Math.round(width * lightingScale)), smallHeight = Math.max(1, Math.round(height * lightingScale));
        cv.resize(gray, small, new cv.Size(smallWidth, smallHeight));
        cv.GaussianBlur(small, smooth, new cv.Size(0, 0), Math.max(3, Math.min(smallWidth, smallHeight) / 40));
        cv.resize(smooth, background, new cv.Size(width, height));
        const paper = options.profile === "document" ? 245 : 235;
        const backgroundPixels = background.data, grayPixels = gray.data;
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          const offset = pixel * 4, gain = paper / Math.max(30, backgroundPixels[pixel]);
          for (let channel = 0; channel < 3; channel += 1) {
            const value = options.profile === "photo" ? processed[offset + channel] : grayPixels[pixel];
            processed[offset + channel] = Math.min(255, Math.round(value * gain));
          }
          processed[offset + 3] = 255;
        }
        metadata.lightingApplied = true;
      } else if (options.profile !== "photo") {
        const grayPixels = gray.data;
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          processed[pixel * 4] = processed[pixel * 4 + 1] = processed[pixel * 4 + 2] = grayPixels[pixel];
        }
      }
      if (options.sharpen > 0) {
        scope.postMessage({ progress: "Aplicando nitidez suave\u2026" });
        const clean = cv.matFromImageData(new ImageData(processed, width, height));
        resources.push(clean);
        const blurred = mat();
        cv.GaussianBlur(clean, blurred, new cv.Size(0, 0), 0.7);
        const blurredPixels = blurred.data;
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            const offset = pixel * 4 + channel, value = processed[offset];
            processed[offset] = Math.max(0, Math.min(255, value + options.sharpen * (value - blurredPixels[offset])));
          }
        }
      }
      metadata.elapsedMs = Math.round(performance.now() - started);
      scope.postMessage({ buffer: processed.buffer, width, height, metadata }, [processed.buffer]);
    } finally {
      for (const resource of resources.reverse()) resource.delete();
    }
  }
})();
