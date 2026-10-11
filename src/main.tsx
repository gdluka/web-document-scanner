import { render } from 'solid-js/web'
import DocumentScannerApp from './shared/document-scanner/DocumentScannerApp'
render(() => <DocumentScannerApp />, document.getElementById('root')!)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => { /* Offline support is optional. */ })
  })
}
