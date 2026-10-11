import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { detectDocumentCorners, scannerPointKeys, type ScannerQuad } from "../../app/documentScanner.client"
import { combineBurst } from "./burst.client"
export function BurstDocumentCapture(props: { disabled: boolean; onBusyChange(busy: boolean): void; onCombined(best: File, merged: File, message: string): void }) {
  const [camera, setCamera] = createSignal(false), [busy, setBusy] = createSignal(false)
  const [liveCorners, setLiveCorners] = createSignal<ScannerQuad | null>(null)
  const [liveStatus, setLiveStatus] = createSignal("")
  const [dimensions, setDimensions] = createSignal({ width: 640, height: 480 })
  const [message, setMessage] = createSignal(""), [error, setError] = createSignal("")
  createEffect(() => props.onBusyChange(busy()))
  let video!: HTMLVideoElement, stream: MediaStream | null = null, operation: AbortController | null = null
  let generation = 0, disposed = false, detectionTimer: ReturnType<typeof setTimeout> | undefined
  function stopCamera() { generation++; clearTimeout(detectionTimer); setLiveCorners(null); setLiveStatus(""); stream?.getTracks().forEach(track => track.stop()); stream = null; setCamera(false) }
  onCleanup(() => { disposed = true; operation?.abort(); stopCamera() })
  async function detectLive(current: number) {
    if (disposed || current !== generation || !stream || !camera()) return
    try {
      if (!busy() && video.videoWidth && video.readyState >= 2) {
        const canvas = document.createElement("canvas"), scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
        const context = canvas.getContext("2d")!
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const corners = await detectDocumentCorners(context.getImageData(0, 0, canvas.width, canvas.height))
        if (!disposed && current === generation && !busy()) {
          setLiveCorners(corners)
          setLiveStatus(corners ? "Hoja detectada. Revisá el contorno antes de capturar." : "Buscando la hoja. Mostrá sus cuatro bordes y evitá reflejos.")
        }
      }
    } catch {
      if (!disposed && current === generation) { setLiveCorners(null); setLiveStatus("No se pudieron detectar los bordes en vivo. Podés ajustarlos después de la ráfaga.") }
    } finally {
      if (!disposed && current === generation && camera()) detectionTimer = setTimeout(() => void detectLive(current), 700)
    }
  }
  async function openCamera() {
    if (busy() || camera()) return
    const current = ++generation; setBusy(true); setError("")
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("La cámara no está disponible. Podés cargar las fotos de una ráfaga.")
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false })
      if (disposed || generation !== current) { opened.getTracks().forEach(track => track.stop()); return }
      stream = opened; setCamera(true); video.srcObject = opened; await video.play()
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
      const Capture = (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture
      let photo: { takePhoto(): Promise<Blob> } | null = null
      if (Capture) { try { photo = new Capture(track) } catch { /* Fall back to frames from the camera stream. */ } }
      for (let i = 0; i < 6; i++) {
        controller.signal.throwIfAborted(); setMessage(`Capturando foto ${i + 1} de 6…`)
        let blob: Blob | null = null
        if (photo) { try { blob = await photo.takePhoto() } catch { photo = null } }
        if (!blob) {
          const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight
          canvas.getContext("2d")!.drawImage(video, 0, 0)
          blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No se pudo capturar la foto.")), "image/png"))
        }
        captured.push(new File([blob], `rafaga-${i + 1}.${blob.type === "image/png" ? "png" : "jpg"}`, { type: blob.type }))
        if (i < 5) await new Promise<void>((resolve, reject) => {
          const done = () => { controller.signal.removeEventListener("abort", abort); resolve() }
          const timer = setTimeout(done, 180)
          const abort = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); reject(new DOMException("Cancelado", "AbortError")) }
          controller.signal.addEventListener("abort", abort, { once: true })
          if (controller.signal.aborted) abort()
        })
      }
      stopCamera(); await merge(captured, controller)
    } catch (reason) { if (!disposed) { if (controller.signal.aborted) setMessage("Ráfaga cancelada."); else setError(reason instanceof Error ? reason.message : "No se pudo combinar la ráfaga.") } }
    finally { stopCamera(); if (!disposed) setBusy(false); if (operation === controller) operation = null }
  }
  return <section class="scanner-card scanner-form" aria-label="Captura en ráfaga">
    <h2>Captura en ráfaga</h2>
    <p class="muted">Tomá seis fotos de la misma hoja. Se elige la más nítida y se combinan únicamente las capturas que se pueden alinear. Todo se procesa en este dispositivo.</p>
    <div class="form-actions">
      <button type="button" disabled={busy() || props.disabled || camera()} onClick={() => void openCamera()}>Abrir cámara para ráfaga</button>
      <Show when={camera()}><button type="button" disabled={busy() || props.disabled} onClick={() => void run()}>Capturar 6 fotos</button><button type="button" class="secondary-button" onClick={() => { operation?.abort(); stopCamera() }}>Cerrar cámara</button></Show>
      <Show when={busy()}><button type="button" class="secondary-button" onClick={() => { operation?.abort(); stopCamera() }}>Cancelar ráfaga</button></Show>
    </div>
    {/* Keep the video and its outline in the same coordinate frame even if the global stylesheet is stale. */}
    <Show when={camera()}><div class="scanner-burst-preview" style={{ position: "relative", display: "inline-block", width: "fit-content", "max-width": "100%", overflow: "hidden", "line-height": "0" }}>
      <video ref={video} class="scanner-burst-video" style={{ display: "block", width: "auto", height: "auto", "max-width": "100%", "max-height": "65vh" }} width={dimensions().width} height={dimensions().height} muted playsinline autoplay aria-label="Vista previa de la cámara" />
      <Show when={liveCorners()}>{corners => <svg class="scanner-burst-outline" style={{ position: "absolute", inset: "0", display: "block", width: "100%", height: "100%", "z-index": "1", "pointer-events": "none" }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Bordes detectados en cámara"><polygon fill="rgb(0 210 180 / 12%)" stroke="#00e5b8" stroke-width="3" vector-effect="non-scaling-stroke" points={scannerPointKeys.map(key => `${corners()[key].x * 100},${corners()[key].y * 100}`).join(" ")} /></svg>}</Show>
    </div><p class="muted" role="status">{liveStatus()}</p></Show>
    <label>Cargar fotos de una ráfaga<input type="file" accept="image/*" multiple disabled={busy() || props.disabled} onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""
      if (files.length && files.every(file => file.type.startsWith("image/"))) void run(files)
      else if (files.length) setError("Elegí únicamente fotografías.")
    }} /></label>
    <Show when={message()}><p class="notice-message" role="status">{message()}</p></Show>
    <Show when={error()}><p class="error-message" role="alert">{error()}</p></Show>
  </section>
}
