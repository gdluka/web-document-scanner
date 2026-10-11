import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { detectDocumentCorners, scannerPointKeys, type ScannerQuad } from "../../app/documentScanner.client"
import { combineBurst } from "./burst.client"
import { captureDocumentPhoto, requestDocumentFocus, waitForCamera, type FocusControl } from "./cameraCapture.client"
import { captureIsReady, measureCaptureQuality, type StabilitySample } from "./captureQuality"
export function BurstDocumentCapture(props: { disabled: boolean; onBusyChange(busy: boolean): void; onCombined(best: File, merged: File, message: string): void; onCaptured(file: File, message: string): void }) {
  const [camera, setCamera] = createSignal(false), [busy, setBusy] = createSignal(false)
  const [liveCorners, setLiveCorners] = createSignal<ScannerQuad | null>(null)
  const [liveStatus, setLiveStatus] = createSignal("")
  const [focus, setFocus] = createSignal<FocusControl>({ mode: "device", pointRequested: false })
  const [ready, setReady] = createSignal(false), [waiting, setWaiting] = createSignal(false), [manualAllowed, setManualAllowed] = createSignal(false)
  let samples: StabilitySample[] = [], focusPoint: { x: number; y: number } | null = null, focusSettledAfter = 0
  const [dimensions, setDimensions] = createSignal({ width: 640, height: 480 })
  const [message, setMessage] = createSignal(""), [error, setError] = createSignal("")
  createEffect(() => props.onBusyChange(busy()))
  let video!: HTMLVideoElement, stream: MediaStream | null = null, operation: AbortController | null = null
  let generation = 0, disposed = false, detectionTimer: ReturnType<typeof setTimeout> | undefined
  function stopCamera() { generation++; clearTimeout(detectionTimer); setLiveCorners(null); setLiveStatus(""); setReady(false); samples = []; focusPoint = null; stream?.getTracks().forEach(track => track.stop()); stream = null; setCamera(false) }
  onCleanup(() => { disposed = true; operation?.abort(); stopCamera() })
  async function detectLive(current: number) {
    if (disposed || current !== generation || !stream || !camera()) return
    try {
      if ((!busy() || waiting()) && video.videoWidth && video.readyState >= 2) {
        const canvas = document.createElement("canvas"), scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
        const context = canvas.getContext("2d")!
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = context.getImageData(0, 0, canvas.width, canvas.height), capturedAt = performance.now()
        const small = document.createElement("canvas"), factor = Math.min(1, 640 / Math.max(canvas.width, canvas.height))
        small.width = Math.round(canvas.width * factor); small.height = Math.round(canvas.height * factor)
        const smallContext = small.getContext("2d")!
        smallContext.drawImage(canvas, 0, 0, small.width, small.height)
        const corners = await detectDocumentCorners(smallContext.getImageData(0, 0, small.width, small.height))
        if (disposed || current !== generation || (busy() && !waiting())) return
        setLiveCorners(corners)
        if (!corners) { samples = []; setReady(false); setLiveStatus("Buscando la hoja. Mostrá sus cuatro bordes y evitá reflejos."); return }
        const center = scannerPointKeys.reduce((point, key) => ({ x: point.x + corners[key].x / 4, y: point.y + corners[key].y / 4 }), { x: 0, y: 0 })
        if (!focusPoint || Math.hypot(center.x - focusPoint.x, center.y - focusPoint.y) > .08) {
          focusPoint = center; samples = []; setReady(false)
          const requested = await requestDocumentFocus(stream!.getVideoTracks()[0]!, corners)
          if (disposed || current !== generation) return
          focusSettledAfter = performance.now() + 400
          setFocus(requested); setLiveStatus("Hoja detectada. Esperando enfoque y estabilidad…")
          return
        }
        if (capturedAt < focusSettledAfter) return
        const quality = measureCaptureQuality(image, corners)
        samples = [...samples.slice(-2), { quad: corners, quality, at: capturedAt }]
        const available = captureIsReady(samples) && performance.now() - capturedAt < 1500
        setReady(available)
        setLiveStatus(available ? "Hoja estable y con detalle. Lista para capturar." : quality.coverage < .25 ? "Acercá la hoja para que ocupe más del encuadre." : !quality.detail ? "Esperando nitidez. Mejorá la luz y mantené el texto enfocado." : "Mantené el teléfono quieto. Comprobando estabilidad…")
      }
    } catch {
      if (!disposed && current === generation) { samples = []; setReady(false); setLiveCorners(null); setLiveStatus("No se pudieron detectar los bordes en vivo. Podés ajustar las esquinas después de capturar.") }
    } finally {
      if (!disposed && current === generation && camera()) detectionTimer = setTimeout(() => void detectLive(current), 500)
    }
  }
  async function openCamera() {
    if (busy() || camera()) return
    const current = ++generation; setBusy(true); setError(""); setManualAllowed(false)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("La cámara no está disponible. Podés cargar una fotografía.")
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false })
      if (disposed || generation !== current) { opened.getTracks().forEach(track => track.stop()); return }
      stream = opened; setCamera(true); video.srcObject = opened; await video.play()
      const requested = await requestDocumentFocus(opened.getVideoTracks()[0]!)
      if (disposed || generation !== current) return
      setFocus(requested)
      if (!disposed && generation === current) { setDimensions({ width: video.videoWidth, height: video.videoHeight }); setLiveStatus("Buscando bordes de la hoja…"); detectionTimer = setTimeout(() => void detectLive(current), 100); setMessage(`Cámara: ${video.videoWidth} × ${video.videoHeight} px. Acercá la hoja, esperá el enfoque y mantené el teléfono estable.`) }
    } catch (reason) { if (!disposed && generation === current) { stopCamera(); setError(reason instanceof Error ? reason.message : "No se pudo abrir la cámara.") } }
    finally { if (!disposed) setBusy(false) }
  }
  async function merge(files: File[], controller: AbortController) {
    setMessage("Seleccionando la foto más nítida y alineando la ráfaga…")
    const result = await combineBurst(files, controller.signal)
    if (disposed || controller.signal.aborted) return
    props.onCombined(files[result.bestIndex]!, new File([result.blob], "documento-rafaga.png", { type: "image/png" }),
      `Ráfaga: ${result.accepted} de ${result.total} fotos utilizadas · ${result.width} × ${result.height} px. ${result.accepted === 1 ? "No hubo otras fotos fiables: se conservó la mejor captura." : "Compará la combinación con la mejor foto antes de aplicar filtros."}`)
    setMessage(`${result.accepted} de ${result.total} fotos utilizadas. La combinación reduce ruido; esta primera prueba no aumenta la resolución.`)
  }
  async function run(files?: File[]) {
    if (busy() || props.disabled) return
    const controller = new AbortController(); operation = controller
    setBusy(true); setError("")
    try {
      if (files) { stopCamera(); await merge(files, controller); return }
      if (!stream || !video.videoWidth) throw new Error("Abrí la cámara y esperá el enfoque.")
      const captured: File[] = [], track = stream.getVideoTracks()[0]!
      for (let i = 0; i < 6; i++) {
        controller.signal.throwIfAborted(); setMessage(`Capturando foto ${i + 1} de 6…`)
        captured.push(await captureDocumentPhoto(track, video, controller.signal))
        if (i < 5) await waitForCamera(180, controller.signal)
      }
      stopCamera(); await merge(captured, controller)
    } catch (reason) { if (!disposed) { if (controller.signal.aborted) setMessage("Ráfaga cancelada."); else setError(reason instanceof Error ? reason.message : "No se pudo combinar la ráfaga.") } }
    finally { stopCamera(); if (!disposed) setBusy(false); if (operation === controller) operation = null }
  }
  async function captureSingle(manual = false) {
    if (busy() || props.disabled || !stream) return
    const controller = new AbortController(); operation = controller
    const current = generation, track = stream.getVideoTracks()[0]!
    setBusy(true); setWaiting(!manual); setError(""); setManualAllowed(false)
    try {
      if (!manual) {
        samples = []; setReady(false); setMessage("Enfocando la hoja y comprobando nitidez y estabilidad…")
        const requested = await requestDocumentFocus(track, liveCorners(), controller.signal)
        controller.signal.throwIfAborted()
        if (disposed || generation !== current) return
        setFocus(requested)
        focusSettledAfter = performance.now() + 400
        const deadline = performance.now() + 8000
        while (!ready() || !samples.length || performance.now() - samples[samples.length - 1]!.at > 1500) {
          if (performance.now() >= deadline) { setManualAllowed(true); setError("No se pudo confirmar la nitidez y estabilidad. Mejorá la luz, mantené la hoja quieta o elegí «Capturar de todos modos» para revisarla manualmente."); return }
          await waitForCamera(100, controller.signal)
        }
      }
      setWaiting(false); setMessage("Tomando una foto…")
      const file = await captureDocumentPhoto(track, video, controller.signal)
      if (disposed || generation !== current || controller.signal.aborted) return
      stopCamera()
      props.onCaptured(file, manual ? "Foto capturada sin comprobación de nitidez. Revisá el texto y las esquinas." : "Foto única capturada después de comprobar detalle y estabilidad. Revisá el texto y las esquinas.")
      setMessage("Foto capturada. Revisá las esquinas para preparar la hoja.")
    } catch (reason) {
      if (!disposed) { if (controller.signal.aborted) setMessage("Captura cancelada."); else setError(reason instanceof Error ? reason.message : "No se pudo capturar la foto.") }
    } finally { if (!disposed) { setWaiting(false); setBusy(false) }; if (operation === controller) operation = null }
  }
  return <section class="scanner-card scanner-form" aria-label="Captura con cámara">
    <h2>Captura con cámara</h2>
    <p class="muted">Tomá una foto con enfoque sobre la hoja y comprobación de nitidez y estabilidad. También podés usar seis fotos para combinar una ráfaga. Todo se procesa en este dispositivo.</p>
    <div class="form-actions">
      <button type="button" disabled={busy() || props.disabled || camera()} onClick={() => void openCamera()}>Abrir cámara</button>
      <Show when={camera()}><button type="button" disabled={busy() || props.disabled} onClick={() => void captureSingle()}>Capturar una foto</button><button type="button" class="secondary-button" disabled={busy() || props.disabled} onClick={() => void run()}>Capturar 6 fotos</button><Show when={manualAllowed()}><button type="button" class="secondary-button" disabled={busy() || props.disabled} onClick={() => void captureSingle(true)}>Capturar de todos modos</button></Show><button type="button" class="secondary-button" onClick={() => { operation?.abort(); stopCamera() }}>Cerrar cámara</button></Show>
      <Show when={busy()}><button type="button" class="secondary-button" onClick={() => { operation?.abort(); stopCamera() }}>Cancelar captura</button></Show>
    </div>
    {/* Keep the video and its outline in the same coordinate frame even if the global stylesheet is stale. */}
    <Show when={camera()}><div class="scanner-burst-preview" style={{ position: "relative", display: "inline-block", width: "fit-content", "max-width": "100%", overflow: "hidden", "line-height": "0" }}>
      <video ref={video} class="scanner-burst-video" style={{ display: "block", width: "auto", height: "auto", "max-width": "100%", "max-height": "65vh" }} width={dimensions().width} height={dimensions().height} muted playsinline autoplay aria-label="Vista previa de la cámara" />
      <Show when={liveCorners()}>{corners => <svg class="scanner-burst-outline" style={{ position: "absolute", inset: "0", display: "block", width: "100%", height: "100%", "z-index": "1", "pointer-events": "none" }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Bordes detectados en cámara"><polygon fill="rgb(0 210 180 / 12%)" stroke="#00e5b8" stroke-width="3" vector-effect="non-scaling-stroke" points={scannerPointKeys.map(key => `${corners()[key].x * 100},${corners()[key].y * 100}`).join(" ")} /></svg>}</Show>
    </div><p class="muted" role="status">{liveStatus()}</p><p class="muted">{focus().mode === "device" ? "La cámara administra el enfoque. No hay control de enfoque disponible." : focus().pointRequested ? "Enfoque automático solicitado sobre el centro de la hoja." : "Enfoque automático solicitado. La cámara elige la zona."} La comprobación de nitidez es orientativa; revisá las cifras después de capturar.</p></Show>
    <label>Cargar fotos de una ráfaga<input type="file" accept="image/*" multiple disabled={busy() || props.disabled} onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""
      if (files.length && files.every(file => file.type.startsWith("image/"))) void run(files)
      else if (files.length) setError("Elegí únicamente fotografías.")
    }} /></label>
    <Show when={message()}><p class="notice-message" role="status">{message()}</p></Show>
    <Show when={error()}><p class="error-message" role="alert">{error()}</p></Show>
  </section>
}
