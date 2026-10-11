import { createHash } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'

// Official model location from DocsaidLab/DocAligner, heatmap_reg/infer.py.
const url = 'https://drive.usercontent.google.com/download?id=1IlbLPkCv-TdaBLOPh_4J97P1_KHYYJ7a&export=download&confirm=t'
const expected = 'f4117b786e3a18470f3865c93f3c2bd69d9b998edd60f385574a5c665e79594e'
const directory = new URL('../public/vendor/docaligner/', import.meta.url)
const destination = new URL('docaligner-lcnet100-f4117b78.onnx', directory)
const temporary = new URL('model-download.tmp', directory)
const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Official model download unavailable.')
const bytes = Buffer.from(await response.arrayBuffer())
if (bytes.length !== 4767987 || createHash('sha256').update(bytes).digest('hex') !== expected) {
  throw new Error('Model checksum or size mismatch. The existing model was not changed.')
}
await mkdir(directory, { recursive: true })
await writeFile(temporary, bytes)
await rename(temporary, destination)
console.log('DocAligner LCNet100 downloaded and SHA256 verified (4767987 bytes).')
