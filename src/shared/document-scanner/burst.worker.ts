import { fuseBurst, type BurstFrame } from "./burst"
self.onmessage = (event: MessageEvent<BurstFrame[]>) => {
  try { const result = fuseBurst(event.data); self.postMessage(result, { transfer: [result.pixels.buffer] }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "No se pudo combinar la ráfaga." }) }
}
