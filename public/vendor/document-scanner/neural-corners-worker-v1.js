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

  // src/shared/document-scanner/neuralCorners.config.ts
  var neuralCornerModel = {
    id: "docaligner-lcnet100",
    file: "docaligner-lcnet100-f4117b78.onnx",
    size: 4767987,
    sha256: "f4117b786e3a18470f3865c93f3c2bd69d9b998edd60f385574a5c665e79594e",
    inputSize: 256
  };

  // src/shared/document-scanner/documentCorners.ts
  var scannerPointKeys = ["a", "b", "c", "d"];
  function validScannerQuad(quad) {
    const points = scannerPointKeys.map((key) => quad[key]);
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
    const crosses = points.map((p, index) => {
      const q = points[(index + 1) % 4], r = points[(index + 2) % 4];
      return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    });
    const area = Math.abs(points.reduce((sum, p, index) => {
      const q = points[(index + 1) % 4];
      return sum + p.x * q.y - p.y * q.x;
    }, 0)) / 2;
    return area >= 0.02 && (crosses.every((value) => value > 0) || crosses.every((value) => value < 0));
  }

  // src/shared/document-scanner/neuralCorners.ts
  function decodeDocumentHeatmaps(values, shape) {
    const [batch, channels, height, width] = shape;
    const rejected = (reason, confidence2 = 0) => ({ corners: null, confidence: confidence2, rejection: reason });
    if (shape.length !== 4 || batch !== 1 || channels !== 4 || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 512 || height > 512 || values.length !== channels * width * height) {
      return rejected("La salida del modelo no tiene el formato esperado.");
    }
    const plane = width * height, visited = new Uint8Array(plane), stack = new Int32Array(plane);
    const points = [];
    let confidence = 1;
    for (let channel = 0; channel < 4; channel++) {
      visited.fill(0);
      const base = channel * plane;
      let largest = 0, bestX = 0, bestY = 0, bestPeak = 0;
      for (let start = 0; start < plane; start++) {
        const value = values[base + start];
        if (!Number.isFinite(value) || value < 0 || value > 1.001) return rejected("El modelo devolvi\xF3 valores inv\xE1lidos.");
        if (value < 0.3 || visited[start]) continue;
        let top = 0, count = 0, mass = 0, sumX = 0, sumY = 0, peak = 0;
        stack[top++] = start;
        visited[start] = 1;
        while (top) {
          const index = stack[--top], x = index % width, y = Math.floor(index / width), weight = values[base + index];
          count++;
          mass += weight;
          sumX += (x + 0.5) * weight;
          sumY += (y + 0.5) * weight;
          peak = Math.max(peak, weight);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const neighbor = ny * width + nx;
            if (!visited[neighbor] && values[base + neighbor] >= 0.3) {
              visited[neighbor] = 1;
              stack[top++] = neighbor;
            }
          }
        }
        if (count > largest) {
          largest = count;
          bestX = sumX / mass / width;
          bestY = sumY / mass / height;
          bestPeak = peak;
        }
      }
      confidence = Math.min(confidence, bestPeak);
      if (!largest || bestPeak < 0.6 || largest / plane > 0.05) return rejected("No se distinguieron cuatro esquinas fiables.", confidence);
      points.push({ x: bestX, y: bestY });
    }
    const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
    points.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    let first = 0;
    for (let i = 1; i < 4; i++) if (points[i].x + points[i].y < points[first].x + points[first].y) first = i;
    const corners = { b: points[first], c: points[(first + 1) % 4], d: points[(first + 2) % 4], a: points[(first + 3) % 4] };
    if (!validScannerQuad(corners)) return rejected("Las esquinas propuestas no rodean una hoja v\xE1lida.", confidence);
    return { corners, confidence, rejection: null };
  }

  // src/shared/document-scanner/neuralCorners.worker.ts
  var scope2 = globalThis;
  var loading;
  async function loadDetector() {
    return loading ??= (async () => {
      const cv = await loadOpenCV();
      scope2.postMessage({ progress: "Preparando detecci\xF3n inteligente de bordes\u2026" });
      const url = new URL(`../docaligner/${neuralCornerModel.file}`, globalThis.location.href);
      const response = await fetch(url, { credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error("No se pudo cargar el detector.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== neuralCornerModel.size) throw new Error("El modelo est\xE1 incompleto.");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== neuralCornerModel.sha256) throw new Error("El modelo no coincide con la versi\xF3n esperada.");
      const name = "/document-corners.onnx";
      cv.FS_createDataFile("/", name.slice(1), bytes, true, false);
      try {
        return { cv, net: cv.readNetFromONNX(name) };
      } finally {
        cv.FS_unlink(name);
      }
    })();
  }
  scope2.onmessage = (event) => {
    void detect(event.data.msg.data).catch(() => scope2.postMessage({ error: "La detecci\xF3n inteligente no est\xE1 disponible." }));
  };
  async function detect(data) {
    const started = performance.now(), { cv, net } = await loadDetector(), resources = [];
    const keep = (value) => {
      resources.push(value);
      return value;
    };
    try {
      const source = keep(cv.matFromImageData(data)), bgr = keep(new cv.Mat());
      cv.cvtColor(source, bgr, cv.COLOR_RGBA2BGR);
      const blob = keep(cv.blobFromImage(bgr, 1 / 255, new cv.Size(neuralCornerModel.inputSize, neuralCornerModel.inputSize), new cv.Scalar(0, 0, 0, 0), false, false));
      net.setInput(blob);
      const output = keep(net.forward());
      const result = decodeDocumentHeatmaps(output.data32F, output.matSize);
      scope2.postMessage({ result: { ...result, elapsedMs: performance.now() - started } });
    } finally {
      for (const resource of resources.reverse()) resource.delete();
    }
  }
})();
