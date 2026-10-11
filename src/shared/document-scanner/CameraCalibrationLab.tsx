import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
import { CameraCalibrationSession, calibrationBlob, calibrationImage } from './cameraCalibration.client'
import { validateCalibrationView, validateCalibrationProfile, type CalibrationView, type CameraCalibrationProfile } from './cameraCalibration'
import { scannerAssetUrl } from '../../app/scannerAssets'
interface Sample { view: CalibrationView; thumbnail: string }
export function CameraCalibrationLab() {
  const [samples, setSamples] = createSignal<Sample[]>([]), [rejected, setRejected] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false), [status, setStatus] = createSignal(''), [error, setError] = createSignal('')
  const [name, setName] = createSignal('Cámara trasera · foto normal'), [profile, setProfile] = createSignal<CameraCalibrationProfile | null>(null)
  const [pattern, setPattern] = createSignal<Blob | null>(null), [patternUrl, setPatternUrl] = createSignal('')
  const [preview, setPreview] = createSignal<{ original: string; corrected: string } | null>(null)
  const session = new CameraCalibrationSession(message => setStatus(message))
  let operation: AbortController | null = null, disposed = false
  createEffect(on(pattern, blob => {
    const url = blob ? URL.createObjectURL(blob) : ''; setPatternUrl(url)
    onCleanup(() => { if (url) URL.revokeObjectURL(url) })
  }))
  function clearPreview() { const value = preview(); if (value) { URL.revokeObjectURL(value.original); URL.revokeObjectURL(value.corrected) }; setPreview(null) }
  onCleanup(() => { disposed = true; operation?.abort(); session.close(); for (const sample of samples()) URL.revokeObjectURL(sample.thumbnail); clearPreview() })
  async function action(run: (signal: AbortSignal) => Promise<void>) {
    if (busy()) return
    const current = new AbortController(); operation = current; setBusy(true); setError('')
    try { await run(current.signal) } catch (reason) { if (!disposed) { if (current.signal.aborted) setStatus('Prueba cancelada. Se conservan las fotos ya analizadas.'); else setError(reason instanceof Error ? reason.message : 'No se pudo ejecutar la prueba.') } }
    finally { if (!disposed) setBusy(false); if (operation === current) operation = null }
  }
  async function makePattern() {
    await action(async signal => {
      const image = await session.board(signal), png = await calibrationBlob(image)
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('No se pudo preparar el patrón.')); reader.readAsDataURL(png) })
      signal.throwIfAborted()
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="210mm" height="297mm" viewBox="0 0 210 297"><rect width="210" height="297" fill="white"/><text x="30" y="24" font-family="sans-serif" font-size="5">A Bob's Scan · calibración ChArUco</text><text x="30" y="33" font-family="sans-serif" font-size="3.5">Imprimir en A4 al 100%. Cuadrados de 30 mm.</text><image x="30" y="44" width="150" height="210" xlink:href="${data}"/><text x="30" y="270" font-family="sans-serif" font-size="3.5">5 × 7 cuadrados · DICT_4X4_50 · marcas de 21 mm</text><text x="30" y="278" font-family="sans-serif" font-size="3.5">Pegar sobre una superficie plana, sin dobleces.</text></svg>`
      setPattern(new Blob([svg], { type: 'image/svg+xml' })); setStatus('Patrón listo. Descargalo e imprimilo en A4 al 100%.')
    })
  }
  async function add(files: File[]) {
    await action(async signal => {
      setProfile(null); clearPreview()
      for (const file of files) {
        signal.throwIfAborted()
        if (samples().length >= 20) throw new Error('El máximo es 20 fotos válidas. Quitá alguna para reemplazarla.')
        setStatus(`Buscando el patrón en ${file.name}…`)
        try {
          if (!file.type.startsWith('image/')) throw new Error('Elegí una fotografía.')
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(v => v.toString(16).padStart(2, '0')).join('')
          if (samples().some(s => s.view.digest === digest)) throw new Error('Esta foto ya está cargada.')
          const { image, sourceWidth, sourceHeight } = await calibrationImage(file, signal)
          const copy = new ImageData(image.data.slice(), image.width, image.height)
          const points = await session.detect(image, signal)
          signal.throwIfAborted()
          const view: CalibrationView = { name: file.name, digest, width: copy.width, height: copy.height, sourceWidth, sourceHeight, points }
          validateCalibrationView(view)
          const first = samples()[0]?.view
          if (first && (sourceWidth !== first.sourceWidth || sourceHeight !== first.sourceHeight)) throw new Error('La resolución u orientación es distinta de las otras fotos.')
          const bitmap = await createImageBitmap(copy)
          let thumb: Blob
          try {
            const canvas = document.createElement('canvas'), scale = Math.min(1, 320 / copy.width)
            canvas.width = Math.round(copy.width * scale); canvas.height = Math.round(copy.height * scale)
            const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('No se pudo preparar la vista previa.')
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); ctx.fillStyle = '#00b7ab'
            for (const p of points) { ctx.beginPath(); ctx.arc(p.x * scale, p.y * scale, 2.5, 0, Math.PI * 2); ctx.fill() }
            thumb = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo exportar la vista previa.')), 'image/jpeg', .85))
          } finally { bitmap.close() }
          signal.throwIfAborted(); setSamples(previous => [...previous, { view, thumbnail: URL.createObjectURL(thumb) }])
        } catch (reason) {
          if (signal.aborted) throw reason
          setRejected(previous => [...previous, `${file.name}: ${reason instanceof Error ? reason.message : 'No se reconoció el patrón.'}`])
        }
      }
      setStatus(`${samples().length} fotos válidas. Necesitás al menos 10, variando posición e inclinación.`)
    })
  }
  function remove(index: number) {
    const sample = samples()[index]; if (sample) URL.revokeObjectURL(sample.thumbnail)
    setSamples(previous => previous.filter((_, i) => i !== index)); setProfile(null); clearPreview()
  }
  async function calculate() {
    await action(async signal => {
      setStatus('Calculando la distorsión del lente…')
      const value = await session.calibrate(samples().map(s => s.view), name(), signal)
      signal.throwIfAborted(); setProfile(value); setStatus('Perfil calculado. Compará una foto de esta misma cámara antes y después.')
    })
  }
  function downloadProfile() {
    const value = profile(); if (!value) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = document.createElement('a')
    link.href = url; link.download = 'perfil-calibracion-camara.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function compare(file: File | undefined) {
    if (!file || !profile()) return
    await action(async signal => {
      const value = profile()!, { image, sourceWidth, sourceHeight } = await calibrationImage(file, signal)
      if (sourceWidth !== value.sourceWidth || sourceHeight !== value.sourceHeight) throw new Error('Elegí una foto original con la misma resolución y orientación del perfil.')
      const copy = image.data.slice(), original = await calibrationBlob({ width: image.width, height: image.height, buffer: copy.buffer })
      const output = await session.preview(image, value, signal), corrected = await calibrationBlob(output)
      signal.throwIfAborted(); clearPreview(); setPreview({ original: URL.createObjectURL(original), corrected: URL.createObjectURL(corrected) }); setStatus('Comparación lista. La corrección óptica no corrige desenfoque ni dobleces del papel.')
    })
  }
  async function importProfile(file: File | undefined) {
    if (!file) return
    await action(async signal => { if (file.size > 65_536) throw new Error('El perfil JSON es demasiado grande. Elegí el archivo descargado de esta prueba.'); const value = JSON.parse(await file.text()) as CameraCalibrationProfile; validateCalibrationProfile(value); signal.throwIfAborted(); clearPreview(); setProfile(value); setName(value.name); setStatus('Perfil cargado. Usalo solamente con la misma cámara, resolución y modo de captura.') })
  }
  return <section class="scanner-card calibration-lab">
    <h2>Prueba de calibración óptica</h2>
    <p>La guía de distancia ayuda a encuadrar. Esta prueba mide cómo el lente curva las líneas. No corrige el enfoque ni cambia el procesamiento habitual del escáner.</p>
    <ol><li>Descargá el patrón e imprimilo en A4 al 100%, sobre una superficie plana.</li><li>Tomá entre 10 y 20 fotos con la misma cámara, orientación y zoom. Mové el patrón hacia el centro y los bordes; incliná algunas tomas. Mantené el patrón completo visible.</li><li>Calculá el perfil y compará una foto original de esa cámara. Si no mejora, conservá el original.</li></ol>
    <div class="form-actions"><a class="button-link" href={scannerAssetUrl('calibration-pattern-A4.pdf')} download="patron-calibracion-charuco-A4.pdf">Descargar patrón A4 en PDF</a><button type="button" class="secondary-button" onClick={makePattern} disabled={busy()}>Preparar patrón A4</button><Show when={patternUrl()}><a class="button-link secondary-button" href={patternUrl()} download="patron-calibracion-charuco-A4.svg">Descargar patrón A4</a></Show></div>
    <label>Nombre de cámara y modo<input value={name()} disabled={busy()} onInput={e => setName(e.currentTarget.value)} maxLength={120}/></label>
    <div class="scanner-lab-inputs"><label>Tomar foto del patrón<input type="file" accept="image/*" capture="environment" disabled={busy()} onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void add(files) }}/></label><label>Agregar fotos del patrón<input type="file" accept="image/*" multiple disabled={busy()} onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void add(files) }}/></label></div>
    <p>{samples().length} de 10 fotos mínimas · {samples()[0] ? `${samples()[0]!.view.sourceWidth} × ${samples()[0]!.view.sourceHeight} px` : 'Sin fotos cargadas'}</p>
    <Show when={samples().length}><div class="calibration-samples"><For each={samples()}>{(sample, index) => <figure><img src={sample.thumbnail} alt={`Patrón detectado en ${sample.view.name}`}/><figcaption>{sample.view.name} · 24 esquinas</figcaption><button type="button" class="secondary-button" disabled={busy()} onClick={() => remove(index())} aria-label={`Quitar foto ${index() + 1}`}>Quitar foto</button></figure>}</For></div></Show>
    <For each={rejected()}>{message => <p class="warning-message">{message}</p>}</For>
    <div class="form-actions"><button type="button" onClick={calculate} disabled={busy() || samples().length < 10}>Calcular perfil de cámara</button><Show when={busy()}><button type="button" class="secondary-button" onClick={() => operation?.abort()}>Cancelar prueba</button></Show><Show when={profile()}><button type="button" class="secondary-button" onClick={downloadProfile} disabled={busy()}>Descargar perfil JSON</button></Show></div>
    <label>Cargar perfil JSON<input type="file" accept="application/json,.json" disabled={busy()} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void importProfile(file) }}/></label>
    <Show when={profile()}>{value => <><p class="notice-message">{value().name} · error RMS {value().rms.toFixed(3)} px en el análisis de {value().analysisWidth} × {value().analysisHeight} px · {value().views} fotos. Un error pequeño indica ajuste geométrico, no mejora garantizada del OCR.</p><label>Foto para comparar la corrección óptica<input type="file" accept="image/*" disabled={busy()} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void compare(file) }}/></label></>}</Show>
    <Show when={preview()}>{value => <div class="scanner-lab-comparison"><figure><figcaption>Original, misma escala de vista previa</figcaption><img src={value().original} alt="Foto original para comparar calibración"/></figure><figure><figcaption>Corrección óptica experimental</figcaption><img src={value().corrected} alt="Foto con corrección óptica"/><a class="button-link secondary-button" href={value().corrected} download="prueba-correccion-optica.png">Descargar comparación corregida</a></figure></div>}</Show>
    <Show when={status()}><p class="notice-message" role="status">{status()}</p></Show><Show when={error()}><p class="error-message" role="alert">{error()}</p></Show>
    <p class="muted">Las fotos y el perfil se procesan localmente. Al cerrar esta prueba se libera el motor; descargá el perfil si querés conservarlo. El perfil depende de la cámara y del modo de foto, no solo del modelo de teléfono.</p>
  </section>
}
