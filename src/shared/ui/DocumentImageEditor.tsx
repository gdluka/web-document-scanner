import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import { detectDocumentCorners, improveDocumentContrast, prepareDocumentGeometry, scannerPointKeys, validScannerQuad, type ScannerQuad } from "../../app/documentScanner.client"

import type { PreparationMetadata } from "../document-scanner/scannerSession"

interface Crop { x: number; y: number; width: number; height: number }

/** Document preparation stays in the browser until the user saves the file. */
export function DocumentImageEditor(props: {
  file: File
  onPrepared(file: File, metadata?: PreparationMetadata): void
  onCancel(): void
  confirmLabel?: string
  precisePerspective?: boolean
  correctCurvature?: boolean
  initialEnhance?: boolean
  outputFormat?: "image/jpeg" | "image/png"
}) {
  const [loaded, setLoaded] = createSignal<HTMLImageElement | null>(null)
  const [rotation, setRotation] = createSignal(0)
  const [enhance, setEnhance] = createSignal(props.initialEnhance ?? true)
  const [crop, setCrop] = createSignal<Crop | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const [corners, setCorners] = createSignal<ScannerQuad | null>(null)
  const [detecting, setDetecting] = createSignal(false)
  const [scanMessage, setScanMessage] = createSignal("")
  let cornerDrag: keyof ScannerQuad | null = null
  let detectionVersion = 0
  let canvas!: HTMLCanvasElement
  let start: { x: number; y: number } | null = null
  let activePointer: number | null = null
  let disposed = false
  onCleanup(() => { disposed = true; detectionVersion += 1 })

  createEffect(() => {
    const url = URL.createObjectURL(props.file)
    const photo = new Image()
    let cancelled = false
    detectionVersion += 1
    setLoaded(null); setCrop(null); setCorners(null); setRotation(0); setEnhance(props.initialEnhance ?? true); setError(""); setScanMessage(""); setDetecting(false)
    photo.onload = () => { if (!cancelled) setLoaded(photo) }
    photo.onerror = () => { if (!cancelled) setError("No se pudo abrir la foto. Probá con una imagen JPG o PNG.") }
    photo.src = url
    onCleanup(() => { cancelled = true; URL.revokeObjectURL(url) })
  })

  function render(target: HTMLCanvasElement, maximumSize: number) {
    const photo = loaded()
    if (!photo) return
    const angle = rotation()
    const sideways = angle % 180 !== 0
    const width = sideways ? photo.naturalHeight : photo.naturalWidth
    const height = sideways ? photo.naturalWidth : photo.naturalHeight
    const scale = Math.min(1, maximumSize / Math.max(width, height))
    target.width = Math.max(1, Math.round(width * scale))
    target.height = Math.max(1, Math.round(height * scale))
    const context = target.getContext("2d")
    if (!context) throw new Error("No se pudo preparar la foto.")
    context.fillStyle = "white"
    context.fillRect(0, 0, target.width, target.height)
    context.save()
    context.translate(target.width / 2, target.height / 2)
    context.rotate(angle * Math.PI / 180)
    context.filter = "none"
    context.drawImage(photo, -photo.naturalWidth * scale / 2, -photo.naturalHeight * scale / 2,
      photo.naturalWidth * scale, photo.naturalHeight * scale)
    context.restore()
  }

  createEffect(() => {
    if (!loaded() || !canvas) return
    rotation(); enhance()
    render(canvas, 1800)
  })

  createEffect(on(loaded, (photo) => { if (photo && canvas) void detectCorners() }))

  async function detectCorners() {
    if (!loaded()) return
    const version = ++detectionVersion
    setDetecting(true); setError(""); setCrop(null)
    const source = document.createElement("canvas")
    render(source, 1800)
    const context = source.getContext("2d")
    if (!context) { setDetecting(false); return }
    try {
      const detected = await detectDocumentCorners(context.getImageData(0, 0, source.width, source.height))
      if (disposed || version !== detectionVersion) return
      setCorners(detected ?? { a: { x: 0.02, y: 0.98 }, b: { x: 0.02, y: 0.02 }, c: { x: 0.98, y: 0.02 }, d: { x: 0.98, y: 0.98 } })
      setScanMessage(detected ? "Bordes detectados. Revisá que las cuatro esquinas incluyan toda la hoja." : "No se detectaron los bordes. Mové las cuatro esquinas para rodear la hoja.")
    } catch {
      if (!disposed && version === detectionVersion) {
        setCorners({ a: { x: 0.02, y: 0.98 }, b: { x: 0.02, y: 0.02 }, c: { x: 0.98, y: 0.02 }, d: { x: 0.98, y: 0.98 } })
        setScanMessage("Mové las cuatro esquinas para rodear la hoja.")
      }
    } finally { if (!disposed && version === detectionVersion) setDetecting(false) }
  }

  function position(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  function move(event: PointerEvent) {
    if (activePointer !== event.pointerId) return
    const end = position(event)
    if (cornerDrag && corners()) {
      const key = cornerDrag
      setCorners((current) => current ? { ...current, [key]: end } : current)
      return
    }
    if (!start) return
    setCrop({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) })
  }

  function finish(event: PointerEvent) {
    if (activePointer !== event.pointerId) return
    move(event)
    start = null; activePointer = null; cornerDrag = null
    if ((crop()?.width ?? 0) < 0.01 || (crop()?.height ?? 0) < 0.01) setCrop(null)
  }

  async function prepare() {
    if (!loaded() || saving() || detecting()) return
    setSaving(true); setError("")
    try {
      const original = document.createElement("canvas")
      render(original, 2400)
      const region = crop() ?? { x: 0, y: 0, width: 1, height: 1 }
      const output = document.createElement("canvas")
      const quad = corners()
      const geometryResult = quad ? await prepareDocumentGeometry(original.getContext("2d")!.getImageData(0, 0, original.width, original.height), quad, props.precisePerspective ?? false, props.correctCurvature ?? false) : null
      const corrected = geometryResult?.image
      const preparation: PreparationMetadata = { rotation: rotation(), originalWidth: loaded()!.naturalWidth, originalHeight: loaded()!.naturalHeight,
        workWidth: original.width, workHeight: original.height, corners: quad, crop: region, enhance: enhance(), geometry: geometryResult?.geometry ?? null }
      output.width = corrected?.width ?? Math.max(1, Math.round(original.width * region.width))
      output.height = corrected?.height ?? Math.max(1, Math.round(original.height * region.height))
      const context = output.getContext("2d")
      if (!context) throw new Error("No se pudo recortar la foto.")
      if (corrected) context.putImageData(corrected, 0, 0)
      else context.drawImage(original, region.x * original.width, region.y * original.height,
        region.width * original.width, region.height * original.height, 0, 0, output.width, output.height)
      if (enhance()) context.putImageData(improveDocumentContrast(context.getImageData(0, 0, output.width, output.height)), 0, 0)
      const outputFormat = props.outputFormat ?? "image/jpeg"
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(
        (value) => value ? resolve(value) : reject(new Error("No se pudo guardar la foto.")), outputFormat, 0.95,
      ))
      if (!disposed) props.onPrepared(new File([blob], `${props.file.name.replace(/\.[^.]+$/u, "")}-preparada.${blob.type === "image/png" ? "png" : "jpg"}`,
        { type: blob.type }), preparation)
    } catch (reason) {
      if (!disposed) setError(reason instanceof Error ? reason.message : "No se pudo preparar la foto.")
    } finally { if (!disposed) setSaving(false) }
  }

  return <section class="document-image-editor summary-wide" aria-label="Preparar foto del documento">
    <h3>Escanear documento</h3>
    <p class="muted">Mové los puntos para incluir toda la hoja. Al guardar, se recorta y endereza la foto para reconocer el texto.</p>
    <Show when={detecting()}><p class="notice-message" role="status">Detectando los bordes de la hoja…</p></Show>
    <Show when={scanMessage()}><p class="muted" role="status">{scanMessage()}</p></Show>
    <Show when={corners() && !validScannerQuad(corners()!)}><p class="error-message" role="alert">Las esquinas deben rodear toda la hoja sin cruzarse.</p></Show>
    <Show when={error()}><p class="error-message" role="alert">{error()}</p></Show>
    <div class="document-image-preview" style={{ display: loaded() ? "inline-block" : "none" }}>
      <canvas ref={canvas} aria-label="Vista previa; arrastrá para seleccionar el recorte"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || detecting() || saving()) return
          if (corners()) {
            const point = position(event)
            const quad = corners()!
            cornerDrag = scannerPointKeys.reduce((nearest, key) => {
              const distance = (candidate: keyof ScannerQuad) => Math.hypot((quad[candidate].x - point.x) * canvas.clientWidth, (quad[candidate].y - point.y) * canvas.clientHeight)
              return distance(key) < distance(nearest) ? key : nearest
            }, "a" as keyof ScannerQuad)
          }
          start = position(event); activePointer = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerMove={move} onPointerUp={finish}
        onPointerCancel={() => { start = null; activePointer = null; cornerDrag = null; setCrop(null) }} />
      <Show when={corners()}>{(quad) => <>
        <svg class="document-scanner-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={scannerPointKeys.map((key) => `${quad()[key].x * 100},${quad()[key].y * 100}`).join(" ")} /></svg>
        <For each={[...scannerPointKeys]}>{(key, index) => <button type="button" class="document-scanner-corner" aria-label={`Esquina ${index() + 1} de la hoja`} disabled={saving() || detecting()}
          style={{ left: `clamp(21px, ${quad()[key].x * 100}%, calc(100% - 21px))`, top: `clamp(21px, ${quad()[key].y * 100}%, calc(100% - 21px))` }}
          onPointerDown={(event) => { if (!event.isPrimary || event.button !== 0) return; cornerDrag = key; activePointer = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
          onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { activePointer = null; cornerDrag = null }}
          onKeyDown={(event) => {
            const deltas: Record<string, [number, number]> = { ArrowLeft: [-0.005, 0], ArrowRight: [0.005, 0], ArrowUp: [0, -0.005], ArrowDown: [0, 0.005] }
            const delta = deltas[event.key]; if (!delta) return
            event.preventDefault(); setCorners((current) => current ? { ...current, [key]: { x: Math.max(0, Math.min(1, current[key].x + delta[0])), y: Math.max(0, Math.min(1, current[key].y + delta[1])) } } : current)
          }}>{index() + 1}</button>}</For>
      </>}</Show>
      <Show when={crop()}>{(region) => <div class="document-image-crop" style={{
        left: `${region().x * 100}%`, top: `${region().y * 100}%`,
        width: `${region().width * 100}%`, height: `${region().height * 100}%`,
      }} />}</Show>
    </div>
    <div class="form-actions">
      <button type="button" class="secondary-button" disabled={!loaded() || saving() || detecting()}
        onClick={() => { setRotation((angle) => (angle + 90) % 360); setCrop(null); setCorners(null); void detectCorners() }}>Girar 90°</button>
      <button type="button" class="secondary-button" disabled={!loaded() || saving() || detecting()} onClick={() => void detectCorners()}>Detectar bordes</button>
      <button type="button" class="secondary-button" disabled={!loaded() || saving() || detecting()} onClick={() => { setCorners(null); setCrop(null); setScanMessage("Arrastrá sobre la foto para seleccionar un recorte rectangular.") }}>Recorte rectangular</button>
      <button type="button" class="secondary-button" disabled={!crop() || saving()}
        onClick={() => setCrop(null)}>Quitar recorte</button>
      <label class="checkbox-field"><input type="checkbox" checked={enhance()} disabled={saving()}
        onChange={(event) => setEnhance(event.currentTarget.checked)} />Mejorar iluminación y contraste al guardar</label>
    </div>
    <div class="form-actions">
      <button type="button" disabled={!loaded() || saving() || detecting() || Boolean(corners() && !validScannerQuad(corners()!))} onClick={() => void prepare()}>
        {saving() ? "Enderezando…" : props.confirmLabel ?? "Usar foto preparada"}</button>
      <button type="button" class="secondary-button" disabled={saving()}
        onClick={() => props.onPrepared(props.file)}>Usar original</button>
      <button type="button" class="secondary-button" disabled={saving()} onClick={() => props.onCancel()}>Cancelar foto</button>
    </div>
  </section>
}
