import { build } from 'esbuild'
for (const [entry, name] of [['scanner', 'image-worker-v1'], ['burst', 'burst-worker-v1'], ['neuralCorners', 'neural-corners-worker-v1'], ['calibration', 'calibration-worker-v1']]) {
  await build({ entryPoints: [`src/shared/document-scanner/${entry}.worker.ts`], bundle: true, format: 'iife', platform: 'browser', outfile: `public/vendor/document-scanner/${name}.js` })
}
