import { For, Show, createEffect, createSignal, on, onCleanup, lazy } from "solid-js"
import { BurstDocumentCapture } from "./BurstDocumentCapture"
import { prepareScannerOffline, processPreparedDocument } from "./scanner.client"
import { defaultScannerOptions, type ScannerFormat, type ScannerOptions, type ScannerProfile, type ScannerResult } from "./scanner.types"
import type { PreparationMetadata } from "./scannerSession"
import "../../styles/app.css"

const DocumentImageEditor = lazy(async () => ({ default: (await import("../ui/DocumentImageEditor")).DocumentImageEditor }))

export default function DocumentScannerApp() {
  const [correctCurvature, setCorrectCurvature] = createSignal(true)
  const [intelligentCorners, setIntelligentCorners] = createSignal(false)
  const [preparationMetadata, setPreparationMetadata] = createSignal<PreparationMetadata | null>(null)
  const [burstSource, setBurstSource] = createSignal<File | null>(null)
  const [burstBusy, setBurstBusy] = createSignal(false)
  const [burst, setBurst] = createSignal(false)
  const [original, setOriginal] = createSignal<File | null>(null)
  const [editing, setEditing] = createSignal(false)
  const [prepared, setPrepared] = createSignal<Blob | null>(null)
  const [result, setResult] = createSignal<ScannerResult | null>(null)
  const [options, setOptions] = createSignal<ScannerOptions>({ ...defaultScannerOptions })
  const [burstUrl, setBurstUrl] = createSignal("")
  const [originalUrl, setOriginalUrl] = createSignal("")
  const [preparedUrl, setPreparedUrl] = createSignal("")
  const [resultUrl, setResultUrl] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [status, setStatus] = createSignal("")
  const [error, setError] = createSignal("")
  const [offlineBusy, setOfflineBusy] = createSignal(false)
  const [usedOptions, setUsedOptions] = createSignal<ScannerOptions | null>(null)
  let operation: AbortController | null = null
  let disposed = false
  onCleanup(() => { disposed = true; operation?.abort() })
  function downloadMetadata() {
    const value = result(), configuration = usedOptions()
    const metadata = { schemaVersion: 1, source: burstSource() ? "combined" : "single", preparation: preparationMetadata(),
      processing: value && configuration ? { options: configuration, width: value.width, height: value.height,
        metadata: { guides: value.guides, alignmentApplied: value.alignmentApplied, lightingApplied: value.lightingApplied, elapsedMs: value.elapsedMs, warnings: value.warnings } } : null }
    const url = URL.createObjectURL(new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url; link.download = "documento-metadatos.json"; document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  createEffect(on(burstSource, (file) => {
    const url = file ? URL.createObjectURL(file) : ""; setBurstUrl(url)
    onCleanup(() => { if (url) URL.revokeObjectURL(url) })
  }))
  createEffect(on(original, (file) => {
    const url = file ? URL.createObjectURL(file) : ""; setOriginalUrl(url)
    onCleanup(() => { if (url) URL.revokeObjectURL(url) })
  }))
  createEffect(on(prepared, (file) => {
    const url = file ? URL.createObjectURL(file) : ""; setPreparedUrl(url)
    onCleanup(() => { if (url) URL.revokeObjectURL(url) })
  }))
  createEffect(on(result, (value) => {
    const url = value ? URL.createObjectURL(value.blob) : ""; setResultUrl(url)
    onCleanup(() => { if (url) URL.revokeObjectURL(url) })
  }))
  function select(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/")) { setError("Elegí una fotografía JPG, PNG o WebP."); return }
    operation?.abort(); setBurst(false); setBurstSource(null); setOriginal(file); setPrepared(null); setPreparationMetadata(null); setResult(null); setEditing(true); setError(""); setStatus("")
  }
  async function process(fileOverride?: Blob) {
    const file = fileOverride ?? prepared()
    if (!file || busy() || burstBusy()) return
    const current = new AbortController(); operation = current
    const configuration = { ...options() }
    setBusy(true); setError("")
    try {
      const value = await processPreparedDocument(file, configuration, current.signal, message => { if (!disposed) setStatus(message) })
      if (!disposed && !current.signal.aborted) { setResult(value); setUsedOptions(configuration); setStatus("Imagen preparada. Compará los códigos y precios antes de utilizarla.") }
    } catch (reason) {
      if (!disposed) {
        if (current.signal.aborted) setStatus("Procesamiento cancelado. Se conservó la imagen anterior.")
        else setError(reason instanceof Error ? reason.message : "No se pudo procesar la imagen.")
      }
    } finally { if (!disposed) setBusy(false); if (operation === current) operation = null }
  }
  async function offline() {
    setOfflineBusy(true); setError("")
    try { await DocumentImageEditor.preload(); await prepareScannerOffline(); if (!disposed) setStatus("Motores descargados. Para verificar el modo offline, reabrí esta página sin conexión desde la PWA.") }
    catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : "No se pudo preparar el modo offline.") }
    finally { if (!disposed) setOfflineBusy(false) }
  }
  return <main class="scanner-shell scanner-lab">
    <header class="scanner-header"><div><p class="eyebrow">Escáner web · Código abierto</p><h1>A Bob's Scan</h1><p class="muted">Procesá la foto en este dispositivo y compará el resultado antes de usarlo.</p></div><a class="button-link secondary-button" href="https://github.com/gdluka/web-document-scanner" target="_blank" rel="noreferrer">Código en GitHub</a></header>
    <BurstDocumentCapture disabled={busy()} onBusyChange={setBurstBusy} onCaptured={(file, message) => { select(file); setStatus(message) }} onCombined={(best, merged, message) => { operation?.abort(); setBurst(true); setBurstSource(merged); setOriginal(best); setPrepared(null); setPreparationMetadata(null); setResult(null); setEditing(true); setError(""); setStatus(`${message} Revisá los bordes y confirmá para recortar, enderezar y mejorar la hoja.`) }} />
    <section class="scanner-card scanner-form">
      <div class="scanner-lab-inputs">
        <label>Cargar fotografía<input type="file" accept="image/*" disabled={busy() || burstBusy()} onChange={event => select(event.currentTarget.files?.[0])} /></label>
        <label>Tomar foto<input type="file" accept="image/*" capture="environment" disabled={busy() || burstBusy()} onChange={event => select(event.currentTarget.files?.[0])} /></label>
      </div>
      <p class="muted">Las fotos se procesan en este dispositivo y no se suben a ningún servidor. Usá la captura original, sin comprimirla por WhatsApp. Descargá el resultado para compartirlo o pasarlo a tu herramienta de OCR.</p>
      <label class="checkbox-field"><input type="checkbox" checked={intelligentCorners()} disabled={busy() || burstBusy()} onChange={event => setIntelligentCorners(event.currentTarget.checked)} />Detección inteligente de bordes — experimental</label>
      <Show when={import.meta.env.PROD}><button type="button" class="secondary-button" disabled={offlineBusy() || busy() || burstBusy()} onClick={() => void offline()}>{offlineBusy() ? "Descargando motores…" : "Preparar para usar sin conexión"}</button></Show>
      <Show when={editing() && original()}><label class="checkbox-field"><input type="checkbox" checked={correctCurvature()} disabled={busy()} onChange={event=>setCorrectCurvature(event.currentTarget.checked)} />Corregir curvatura de la tabla — experimental</label></Show>
      <Show when={editing() && original()}><DocumentImageEditor file={burstSource() ?? original()!} intelligentCorners={intelligentCorners()} precisePerspective correctCurvature={correctCurvature()} initialEnhance={false} outputFormat="image/png" confirmLabel={burst() ? "Confirmar bordes y mejorar" : "Usar foto preparada"}
        onPrepared={(file, metadata) => { setPreparationMetadata(metadata ?? null); if (metadata?.geometry?.curvatureApplied) setOptions(current => ({ ...current, alignTable: false })); setPrepared(file); setResult(null); setEditing(false); if (burst()) void process(file); else setStatus("Perspectiva preparada. Ahora podés aplicar la corrección de tabla y los filtros.") }}
        onCancel={() => setEditing(false)} /></Show>
      <Show when={original() && !editing()}><div class="form-actions">
        <button type="button" class="secondary-button" disabled={busy() || burstBusy()} onClick={() => setEditing(true)}>Ajustar perspectiva</button>
        <button type="button" class="secondary-button" disabled={busy() || burstBusy()} onClick={() => { setBurst(false); setBurstSource(null); setPrepared(original()); setPreparationMetadata(null); setResult(null); setStatus("Se usará la foto original completa, sin recortar.") }}>Usar original sin recorte</button>
      </div></Show>
    </section>
    <Show when={prepared() && !editing()}><section class="scanner-card scanner-form">
      <div class="scanner-lab-controls">
        <label>Perfil<select aria-label="Perfil" value={options().profile} disabled={busy() || burstBusy()} onChange={event => {
          const profile = event.currentTarget.value as ScannerProfile
          setOptions(current => ({ ...current, profile, alignTable: false, sharpen: profile === "photo" ? 0.1 : 0.2 }))
        }}><option value="table">Tabla / lista de precios</option><option value="document">Documento</option><option value="photo">Fotografía / sellos en color</option></select></label>
        <label>Resolución máxima<select aria-label="Resolución máxima" value={options().maxSize} disabled={busy() || burstBusy()} onChange={event => setOptions(current => ({ ...current, maxSize: Number(event.currentTarget.value) }))}><option value="1200">1200 px</option><option value="2000">2000 px</option><option value="2400">2400 px</option></select></label>
        <label>Formato<select aria-label="Formato" value={options().format} disabled={busy() || burstBusy()} onChange={event => setOptions(current => ({ ...current, format: event.currentTarget.value as ScannerFormat }))}><option value="image/png">PNG — sin pérdida</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label>
        <label>Nitidez suave: {options().sharpen.toFixed(1)}<input type="range" min="0" max="0.6" step="0.1" value={options().sharpen} disabled={busy() || burstBusy()} onInput={event => setOptions(current => ({ ...current, sharpen: Number(event.currentTarget.value) }))} /></label>
        <label>Calidad JPEG / WebP<input type="number" min="0.5" max="1" step="0.05" value={options().quality} disabled={busy() || burstBusy() || options().format === "image/png"} onChange={event => setOptions(current => ({ ...current, quality: Number(event.currentTarget.value) }))} /></label>
        <label class="checkbox-field"><input type="checkbox" checked={options().alignTable} disabled={busy() || burstBusy() || !!preparationMetadata()?.geometry?.curvatureApplied} onChange={event => setOptions(current => ({ ...current, alignTable: event.currentTarget.checked }))} />Enderezar filas con líneas fiables</label>
        <label class="checkbox-field"><input type="checkbox" checked={options().normalizeLighting} disabled={busy() || burstBusy()} onChange={event => setOptions(current => ({ ...current, normalizeLighting: event.currentTarget.checked }))} />Compensar sombras e iluminación</label>
      </div>
      <div class="form-actions"><button type="button" disabled={busy() || burstBusy()} onClick={() => void process()}>Procesar imagen</button><Show when={busy()}><button type="button" class="secondary-button" onClick={() => operation?.abort()}>Cancelar procesamiento</button></Show></div>
    </section></Show>
    <Show when={preparationMetadata()?.geometry}>{geometry => <p class="notice-message" role="status">{geometry().curvatureApplied ? `Curvatura corregida con ${geometry().guides.length} guías y una sola transformación geométrica.` : geometry().fallbackReason ?? "Perspectiva preparada sin corrección de curvatura."}</p>}</Show>
    <Show when={error()}><p class="error-message" role="alert">{error()}</p></Show>
    <Show when={status()}><p class="notice-message" role="status">{status()}</p></Show>
    <Show when={prepared() && !editing()}><div class="form-actions"><button type="button" class="secondary-button" disabled={busy() || burstBusy()} onClick={downloadMetadata}>Descargar metadatos</button></div></Show>
    <Show when={original()}><section class="scanner-lab-comparison">
      <figure class="scanner-card"><figcaption>{burst() ? "Mejor foto de la ráfaga" : "Foto original"}</figcaption><img src={originalUrl()} alt="Foto original del documento" /><Show when={burst()}><a class="button-link secondary-button" href={originalUrl()} download={original()?.name}>Descargar mejor foto</a></Show></figure>
      <Show when={burstSource()}><figure class="scanner-card"><figcaption>Combinación de la ráfaga</figcaption><img src={burstUrl()} alt="Ráfaga combinada antes de recortar" /><a class="button-link" href={burstUrl()} download="documento-rafaga.png">Descargar ráfaga combinada</a></figure></Show>
      <Show when={prepared()}><figure class="scanner-card"><figcaption>{burst() ? "Hoja preparada desde la ráfaga" : "Perspectiva preparada"}</figcaption><img src={preparedUrl()} alt="Documento con perspectiva preparada" /><Show when={burst()}><a class="button-link secondary-button" href={preparedUrl()} download="documento-rafaga-recortada.png">Descargar hoja preparada</a></Show></figure></Show>
      <Show when={result()}>{value => <figure class="scanner-card"><figcaption>Resultado · perfil {usedOptions()?.profile}</figcaption><img src={resultUrl()} alt="Documento procesado" />
        <p>{value().width} × {value().height} px · {(value().blob.size / 1024).toFixed(0)} KB · {(value().elapsedMs / 1000).toFixed(1)} s de procesamiento</p>
        <p>{value().guides} líneas de referencia · {value().alignmentApplied ? "Filas corregidas" : "Sin corrección de filas"} · {value().lightingApplied ? "Iluminación compensada" : "Iluminación original"}</p>
        <For each={value().warnings}>{warning => <p class="warning-message">{warning}</p>}</For>
        <a class="button-link" href={resultUrl()} download={`documento-${usedOptions()?.profile ?? "table"}.${value().format === "image/png" ? "png" : value().format === "image/webp" ? "webp" : "jpg"}`}>Descargar resultado</a>
      </figure>}</Show>
    </section></Show>
  </main>
}
