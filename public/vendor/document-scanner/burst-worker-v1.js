"use strict";
(() => {
  // src/shared/document-scanner/burst.ts
  function gray(frame, maxWidth = 160) {
    const scale = Math.min(1, maxWidth / frame.width), width = Math.round(frame.width * scale), height = Math.round(frame.height * scale);
    const pixels = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (Math.min(frame.height - 1, Math.round(y / scale)) * frame.width + Math.min(frame.width - 1, Math.round(x / scale))) * 4;
      pixels[y * width + x] = frame.pixels[offset] * 0.299 + frame.pixels[offset + 1] * 0.587 + frame.pixels[offset + 2] * 0.114;
    }
    return { width, height, pixels, scale };
  }
  function burstSharpness(frame) {
    const { width, height, pixels } = gray(frame, 500);
    let sum = 0, count = 0;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x, value = 4 * pixels[i] - pixels[i - 1] - pixels[i + 1] - pixels[i - width] - pixels[i + width];
      sum += value * value;
      count++;
    }
    return sum / Math.max(1, count);
  }
  function alignBurstFrame(reference, frame) {
    if (frame.width !== reference.width || frame.height !== reference.height) return null;
    let dx = 0, dy = 0, error = Infinity;
    for (const resolution of [160, 640]) {
      const a = gray(reference, resolution), b = gray(frame, resolution);
      const centerX = Math.round(dx * a.scale), centerY = Math.round(dy * a.scale), radius = resolution === 160 ? 6 : 4;
      const margin = Math.max(12, Math.ceil(a.width * 0.1)), step = resolution === 160 ? 2 : 4;
      const score = (sx, sy) => {
        let sum = 0, count = 0;
        for (let y = margin; y < a.height - margin; y += step) for (let x = margin; x < a.width - margin; x += step) {
          const bx = x + sx, by = y + sy;
          if (bx < 1 || bx >= b.width - 1 || by < 1 || by >= b.height - 1) continue;
          const i = y * a.width + x, j = by * b.width + bx;
          const gx = a.pixels[i + 1] - a.pixels[i - 1] - (b.pixels[j + 1] - b.pixels[j - 1]);
          const gy = a.pixels[i + a.width] - a.pixels[i - a.width] - (b.pixels[j + b.width] - b.pixels[j - b.width]);
          sum += gx * gx + gy * gy;
          count++;
        }
        return sum / Math.max(1, count);
      };
      let bestX = centerX, bestY = centerY;
      error = Infinity;
      for (let sy = centerY - radius; sy <= centerY + radius; sy++) for (let sx = centerX - radius; sx <= centerX + radius; sx++) {
        const value = score(sx, sy);
        if (value < error) {
          error = value;
          bestX = sx;
          bestY = sy;
        }
      }
      if (resolution === 160 && (Math.abs(bestX) === radius || Math.abs(bestY) === radius)) return null;
      const refine = (minus, plus) => {
        const denominator = minus - 2 * error + plus;
        return denominator > 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (minus - plus) / denominator)) : 0;
      };
      dx = (bestX + refine(score(bestX - 1, bestY), score(bestX + 1, bestY))) / a.scale;
      dy = (bestY + refine(score(bestX, bestY - 1), score(bestX, bestY + 1))) / a.scale;
    }
    return { dx, dy, error };
  }
  function fuseBurst(frames) {
    if (frames.length < 2 || frames.length > 8) throw new Error("Eleg\xED entre 2 y 8 fotos de la misma hoja.");
    const scores = frames.map(burstSharpness), bestIndex = scores.indexOf(Math.max(...scores)), reference = frames[bestIndex];
    const accepted = frames.map((frame, index) => {
      if (scores[bestIndex] < 4 || index === bestIndex || scores[index] < scores[bestIndex] * 0.7) return null;
      const alignment = alignBurstFrame(reference, frame);
      return alignment && alignment.error < Math.max(16, scores[bestIndex] * 0.35) ? { frame, alignment } : null;
    }).filter((value) => value !== null);
    const pixels = new Uint8ClampedArray(reference.pixels), { width, height } = reference;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      let count = 1;
      const sum = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
      for (const { frame, alignment } of accepted) {
        const fx = x + alignment.dx, fy = y + alignment.dy, ix = Math.floor(fx), iy = Math.floor(fy);
        if (ix < 0 || iy < 0 || ix + 1 >= width || iy + 1 >= height) continue;
        const tx = fx - ix, ty = fy - iy, values = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const i = (iy * width + ix) * 4 + c;
          values[c] = (frame.pixels[i] * (1 - tx) + frame.pixels[i + 4] * tx) * (1 - ty) + (frame.pixels[i + width * 4] * (1 - tx) + frame.pixels[i + width * 4 + 4] * tx) * ty;
        }
        if (values.some((v, c) => Math.abs(v - reference.pixels[offset + c]) > 25)) continue;
        for (let c = 0; c < 3; c++) sum[c] += values[c];
        count++;
      }
      for (let c = 0; c < 3; c++) pixels[offset + c] = sum[c] / count;
    }
    return { pixels, width, height, bestIndex, accepted: accepted.length + 1, total: frames.length };
  }

  // src/shared/document-scanner/burst.worker.ts
  self.onmessage = (event) => {
    try {
      const result = fuseBurst(event.data);
      self.postMessage(result, { transfer: [result.pixels.buffer] });
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : "No se pudo combinar la r\xE1faga." });
    }
  };
})();
