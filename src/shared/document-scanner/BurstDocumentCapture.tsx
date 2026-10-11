import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import "./camera.css"
import { createDocumentCornerDetector, scannerPointKeys, type ScannerQuad } from "../../app/documentScanner.client"
import { combineBurst } from "./burst.client"
import { captureDocumentPhoto, requestDocumentFocus, waitForCamera, type FocusControl } from "./cameraCapture.client"
import { createLiveDocumentTracker, documentFramingGuidance, type FramingGuidance } from "./liveDocumentTracking"
import { captureFrameSignature, captureIsReady, measureCaptureQuality, type StabilitySample } from "./captureQuality"
export function BurstDocumentCapture(props: { disabled: boolean; onBusyChange(busy: boolean): void; onCombined(best: File, merged: File, message: string): void; onCaptured(file: File, message: string): void }) {
  const [camera, setCamera] = createSignal(false), [busy, setBusy] = createSignal(false)
  const tracker = createLiveDocumentTracker()
  const [framing, setFraming] = createSignal<FramingGuidance>({ kind: "searching", message: "Mostrá la hoja completa dentro de la cámara." })
  const [displayCorners, setDisplayCorners] = createSignal<ScannerQuad | null>(null)
  const [liveStatus, setLiveStatus] = createSignal("")
  const [focus, setFocus] = createSignal<FocusControl>({ mode: "device", pointRequested: false })
  const [ready, setReady] = createSignal(false), [waiting, setWaiting] = createSignal(false)
  let samples: StabilitySample[] = [], focusPoint: { x: number; y: number } | null = null, focusSettledAfter = 0
  const [dimensions, setDimensions] = createSignal({ width: 640, height: 480 })
  const [message, setMessage] = createSignal(""), [error, setError] = createSignal("")
  createEffect(() => props.onBusyChange(busy()))
  let fullscreenOwned = false
  let video!: HTMLVideoElement, stream: MediaStream | null = null, operation: AbortController | null = null
  let generation = 0, disposed = false, detectionTimer: ReturnType<typeof setTimeout> | undefined, previewTimer: ReturnType<typeof setTimeout> | undefined
  let detector: ReturnType<typeof createDocumentCornerDetector> | null = null, cornersCapturedAt = 0, previewVideoTime = -1
  function stopCamera() {
    if (fullscreenOwned) { fullscreenOwned = false; if (document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {}) }
    generation++; clearTimeout(detectionTimer); clearTimeout(previewTimer); detector?.dispose(); detector = null; cornersCapturedAt = 0; previewVideoTime = -1; tracker.reset(); setDisplayCorners(null); setFraming(documentFramingGuidance(tracker.current(performance.now()))); setLiveStatus(""); setReady(false); samples = []; focusPoint = null; stream?.getTracks().forEach(track => track.stop()); stream = null; setCamera(false) }
  onMount(() => {
    const exit = () => { if (fullscreenOwned && !document.fullscreenElement) { fullscreenOwned = false; operation?.abort(); stopCamera() } }
    document.addEventListener("fullscreenchange", exit)
    onCleanup(() => document.removeEventListener("fullscreenchange", exit))
  })
  createEffect(() => {
    if (!camera()) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    onCleanup(() => { document.body.style.overflow = previous })
  })
  onCleanup(() => { disposed = true; operation?.abort(); stopCamera() })
  function previewFrame(maxSide: number) {
    const canvas = document.createElement("canvas"), scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
    const context = canvas.getContext("2d")!
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return context.getImageData(0, 0, canvas.width, canvas.height)
  }
  // Fresh video frames determine detail and movement, independently of the slower border worker.
  function checkPreview(current: number) {
    if (disposed || current !== generation || !stream || !camera()) return
    try {
      if ((!busy() || waiting()) && video.videoWidth && video.readyState >= 2) {
        const at = performance.now(), track = tracker.current(at), corners = track.measurement
        setDisplayCorners(track.display); const guidance = documentFramingGuidance(track, dimensions().width / dimensions().height); setFraming(guidance)
        if (!corners || at < focusSettledAfter) { samples = []; setReady(false); return }
        if (at - cornersCapturedAt > 4000) { samples = []; setReady(false); setLiveStatus("La detección de bordes está demorando. Podés capturar y revisar las esquinas manualmente."); return }
        if (video.currentTime === previewVideoTime) { setReady(false); setLiveStatus("Esperando una nueva imagen de la cámara…"); return }
        previewVideoTime = video.currentTime
        const image = previewFrame(960), quality = measureCaptureQuality(image, corners)
        samples = [...samples.slice(-2), { quad: corners, quality, at, frame: captureFrameSignature(image, corners) }]
        const available = captureIsReady(samples)
        setReady(available)
        setLiveStatus(guidance.kind !== "good" ? "" : available ? "Hoja estable y con detalle. Lista para capturar." : quality.coverage < .25 ? "Acercá la hoja para que ocupe más del encuadre." : quality.contrast < 25 || quality.edgeSpread === null ? "No se distingue suficiente texto. Mejorá la luz y evitá reflejos." : !quality.detail ? "Esperando nitidez. Mejorá la luz y mantené el texto enfocado." : "Mantené el teléfono quieto. Comprobando estabilidad…")
      }
    } catch {
      samples = []; setReady(false); setLiveStatus("No se pudo comprobar la vista previa. Podés capturar y revisar la foto manualmente.")
    } finally {
      if (!disposed && current === generation && camera()) previewTimer = setTimeout(() => checkPreview(current), 500)
    }
  }
  async function detectLive(current: number) {
    if (disposed || current !== generation || !stream || !camera()) return
    try {
      if ((!busy() || waiting()) && video.videoWidth && video.readyState >= 2 && detector) {
        const frameWidth = video.videoWidth, frameHeight = video.videoHeight
        const image = previewFrame(640), capturedAt = performance.now()
        const corners = await detector.detect(image)
        if (disposed || current !== generation || (busy() && !waiting()) || video.videoWidth !== frameWidth || video.videoHeight !== frameHeight) return
        const timely = performance.now() - capturedAt <= 4000
        const track = tracker.update(timely ? corners : null, performance.now())
        setDisplayCorners(track.display); setFraming(documentFramingGuidance(track, dimensions().width / dimensions().height))
        if (!timely) { samples = []; setReady(false); setLiveStatus("La detección de bordes está demorando. Podés capturar y revisar las esquinas manualmente."); return }
        if (!track.confirmed || !corners) { samples = []; setReady(false); setLiveStatus(""); return }
        cornersCapturedAt = capturedAt
        const center = scannerPointKeys.reduce((point, key) => ({ x: point.x + corners[key].x / 4, y: point.y + corners[key].y / 4 }), { x: 0, y: 0 })
        if (!focusPoint || Math.hypot(center.x - focusPoint.x, center.y - focusPoint.y) > .08) {
          focusPoint = center; samples = []; setReady(false)
          // Stop preview acceptance while focus is being requested, including a slow camera response.
          focusSettledAfter = Infinity
          const requested = await requestDocumentFocus(stream!.getVideoTracks()[0]!, corners)
          if (disposed || current !== generation) return
          focusSettledAfter = performance.now() + 400
          setFocus(requested); setLiveStatus("Hoja detectada. Esperando enfoque y estabilidad…")
        }
      }
    } catch {
      if (!disposed && current === generation) { samples = []; setReady(false); const track = tracker.update(null, performance.now()); setDisplayCorners(track.display); setFraming(documentFramingGuidance(track)); setLiveStatus("No se pudieron detectar los bordes en vivo. Podés ajustar las esquinas después de capturar.") }
    } finally {
      if (!disposed && current === generation && camera()) detectionTimer = setTimeout(() => void detectLive(current), 500)
    }
  }
  async function openCamera() {
    if (busy() || camera()) return
    const current = ++generation; setBusy(true); setError(""); setMessage("Abriendo cámara…")
    // Request while the click still provides user activation. The viewport dialog is the fallback.
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        void document.documentElement.requestFullscreen({ navigationUI: "hide" }).then(() => {
          if (disposed || current !== generation) { if (document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {}) }
          else fullscreenOwned = true
        }).catch(() => {})
      } catch { /* Some browsers do not support fullscreen; the camera still fills the viewport. */ }
    }
    setCamera(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("La cámara no está disponible. Podés cargar una fotografía.")
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false })
      if (disposed || generation !== current) { opened.getTracks().forEach(track => track.stop()); return }
      stream = opened; detector = createDocumentCornerDetector(); focusSettledAfter = Infinity; video.srcObject = opened; await video.play()
      const requested = await requestDocumentFocus(opened.getVideoTracks()[0]!)
      if (disposed || generation !== current) return
      setFocus(requested); focusSettledAfter = performance.now() + 400
      if (!disposed && generation === current) { setDimensions({ width: video.videoWidth, height: video.videoHeight }); setLiveStatus("Buscando bordes de la hoja…"); detectionTimer = setTimeout(() => void detectLive(current), 100); previewTimer = setTimeout(() => checkPreview(current), 100); setMessage(`Cámara: ${video.videoWidth} × ${video.videoHeight} px. Acercá la hoja, esperá el enfoque y mantené el teléfono estable.`) }
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
  async function captureSingle() {
    if (busy() || props.disabled || !stream) return
    const controller = new AbortController(); operation = controller
    const current = generation, track = stream.getVideoTracks()[0]!
    setBusy(true); setWaiting(true); setError("")
    try {
      setMessage("Preparando la foto. Mantené el teléfono quieto…")
      // Preview quality is advice, not a shutter lock. Give autofocus a short opportunity,
      // then capture even if this device cannot confirm detail, stability, or borders.
      const deadline = performance.now() + 1500
      const confirmed = () => ready() && samples.length > 0 && performance.now() - samples[samples.length - 1]!.at <= 1500 && performance.now() - cornersCapturedAt <= 4000
      while (!confirmed() && performance.now() < deadline) await waitForCamera(100, controller.signal)
      const qualityConfirmed = confirmed()
      setWaiting(false); setMessage("Tomando una foto…")
      const file = await captureDocumentPhoto(track, video, controller.signal)
      if (disposed || generation !== current || controller.signal.aborted) return
      stopCamera()
      props.onCaptured(file, qualityConfirmed ? "Foto capturada con detalle y estabilidad comprobados en la vista previa. Revisá el texto y las esquinas." : "Foto capturada. Revisá que el texto se lea y ajustá las esquinas si hace falta.")
      setMessage("Foto capturada. Revisá las esquinas para preparar la hoja.")
    } catch (reason) {
      if (!disposed) { if (controller.signal.aborted) setMessage("Captura cancelada."); else setError(reason instanceof Error ? reason.message : "No se pudo capturar la foto.") }
    } finally { if (!disposed) { setWaiting(false); setBusy(false) }; if (operation === controller) operation = null }
  }
  return <section class="scanner-card scanner-form" aria-label="Captura con cámara">
    <h2>Captura con cámara</h2>
    <p class="muted">Tomá una foto con enfoque sobre la hoja. Las indicaciones de nitidez y estabilidad te ayudan a capturar; después podés revisar la imagen. También podés usar seis fotos para combinar una ráfaga. Todo se procesa en este dispositivo.</p>
    <div class="form-actions">
      <button type="button" disabled={busy() || props.disabled || camera()} onClick={() => void openCamera()}>Abrir cámara</button>
      <Show when={busy() && !camera()}><button type="button" class="secondary-button" onClick={() => { operation?.abort(); stopCamera() }}>Cancelar captura</button></Show>
    </div>
    <Show when={camera()}><Portal><dialog class="scanner-camera-dialog" aria-label="Cámara de documentos" ref={node => { queueMicrotask(() => { if (node.isConnected) node.showModal() }) }} onCancel={event => { event.preventDefault(); operation?.abort(); stopCamera() }}>
      {/* Match the video and outline to the entire uncropped frame, including after rotation. */}
      <div class="scanner-burst-preview scanner-camera-frame" style={{ "--camera-aspect": String(dimensions().width / dimensions().height) }}>
        <video ref={video} class="scanner-burst-video" style={{ display: "block", width: "100%", height: "100%", "max-width": "none", "max-height": "none", "object-fit": "contain" }} width={dimensions().width} height={dimensions().height} muted playsinline autoplay onResize={() => {
          if (!video.videoWidth || !video.videoHeight) return
          setDimensions({ width: video.videoWidth, height: video.videoHeight }); samples = []; setReady(false); tracker.reset(); setDisplayCorners(null); setFraming(documentFramingGuidance(tracker.current(performance.now()))); cornersCapturedAt = 0; focusPoint = null
        }} aria-label="Vista previa de la cámara" />
        <Show when={displayCorners()}>{corners => <svg class="scanner-burst-outline" style={{ position: "absolute", inset: "0", display: "block", width: "100%", height: "100%", "z-index": "1", "pointer-events": "none" }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Bordes detectados en cámara"><polygon data-framing={framing().kind} fill={framing().kind === "good" ? "rgb(0 210 180 / 8%)" : "rgb(255 200 87 / 6%)"} stroke={framing().kind === "good" ? "#00e5b8" : "#ffc857"} stroke-width="3" vector-effect="non-scaling-stroke" points={scannerPointKeys.map(key => `${corners()[key].x * 100},${corners()[key].y * 100}`).join(" ")} /></svg>}</Show>
      </div>
      <header class="scanner-camera-header">
        <div><strong>Capturar documento</strong><p class="scanner-camera-guidance" data-state={framing().kind} role="status">{framing().message}</p><p role="status">{busy() ? message() : liveStatus()}</p><p class="scanner-camera-focus">{focus().mode === "device" ? "La cámara administra el enfoque." : focus().pointRequested ? "Enfoque automático solicitado sobre el centro de la hoja." : "Enfoque automático solicitado. La cámara elige la zona."}</p></div>
        <button type="button" class="scanner-camera-close" aria-label="Cerrar cámara" onClick={() => { operation?.abort(); stopCamera() }}>×</button>
      </header>
      <footer class="scanner-camera-controls">
        <Show when={error()}><p class="error-message" role="alert">{error()}</p></Show>
        <div class="scanner-camera-actions"><button type="button" disabled={busy() || props.disabled} onClick={() => void captureSingle()}>Capturar una foto</button><button type="button" class="secondary-button" disabled={busy() || props.disabled} onClick={() => void run()}>Capturar 6 fotos</button><Show when={busy()}><button type="button" class="secondary-button" onClick={() => { operation?.abort(); stopCamera() }}>Cancelar captura</button></Show></div>
      </footer>
    </dialog></Portal></Show>
    <label>Cargar fotos de una ráfaga<input type="file" accept="image/*" multiple disabled={busy() || props.disabled} onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""
      if (files.length && files.every(file => file.type.startsWith("image/"))) void run(files)
      else if (files.length) setError("Elegí únicamente fotografías.")
    }} /></label>
    <Show when={message() && !camera()}><p class="notice-message" role="status">{message()}</p></Show>
    <Show when={error() && !camera()}><p class="error-message" role="alert">{error()}</p></Show>
  </section>
}
