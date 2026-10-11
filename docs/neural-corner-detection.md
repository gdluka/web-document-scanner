# Detección neuronal opcional de la hoja

Experimento del 11 de octubre de 2026, en la rama `experiment/opencv-5`.

El detector habitual sigue siendo el predeterminado y el que se usa en la cámara en vivo. La opción **Detección inteligente de bordes — experimental** permite comparar otro detector sobre una foto cargada o recién capturada. Se ejecuta en el dispositivo; las fotos no se envían a un servidor.

## Cómo probarlo

Desde este checkout: `npm install`, `npm run dev`. Abrir la dirección local que imprime Vite. La cámara requiere HTTPS o localhost; para comparar los detectores basta cargar una foto.

1. Cargar una foto con la casilla experimental desactivada y revisar las cuatro esquinas.
2. Activar la casilla. Se repite la detección de la misma imagen con el modelo.
3. Comparar si conserva toda la hoja, especialmente encabezados y márgenes. Las esquinas siguen siendo editables.
4. Confirmar la foto y descargar metadatos para conservar el detector elegido, la propuesta neuronal aunque sea descartada, la activación mínima, el tiempo y las esquinas finales.

No se reemplaza automáticamente un resultado del detector habitual. Si se elige el modelo, primero se conserva la propuesta habitual. Se rechaza la neuronal cuando no puede cargar, no propone cuatro esquinas válidas o difiere demasiado de esa propuesta: distancia euclídea mayor a 0,08 entre coordenadas normalizadas por esquina, o área fuera de 80–125% de la habitual. Son controles conservadores experimentales, no una demostración de que el detector habitual siempre sea correcto. Si este también falla, se permite ajustar manualmente. Cambiar de foto, cerrar el editor o desactivar la opción cancela el Worker pendiente.

## Modelo y procesamiento

- [DocAligner](https://github.com/DocsaidLab/DocAligner), variante LCNet100, licencia Apache 2.0. Pesos originales sin modificación, **4.767.987 bytes**. Licencia y procedencia: `public/vendor/docaligner/`.
- El Worker carga OpenCV.js 5.0.0 con la adaptación CSP existente. No se incorporó un segundo runtime neuronal ni una API externa.
- Entrada: `img`, Float32 `[1, 3, 256, 256]`, canales **BGR / 255**, siguiendo la llamada de referencia de DocAligner. Se redimensiona sin bandas de relleno; la reducción solamente interviene en la detección.
- Salida verificada: `heatmap`, Float32 `[1, 4, 128, 128]`, probabilidades. No se aplica otra sigmoide.
- Por canal: umbral 0,3, mayor región con conectividad de ocho vecinos, centroide ponderado por intensidad y coordenadas normalizadas del centro de las celdas. Es una implementación propia y difiere del centroide geométrico de contornos sobre máscaras ampliadas del proyecto original.
- Se rechazan regiones demasiado extensas, activaciones máximas menores a 0,6, valores inválidos y cuadriláteros degenerados. Estos umbrales son experimentales: una activación de 0,9 **no demuestra un 90% de probabilidad de recorte correcto**.
- La foto destinada a la transformación geométrica conserva la resolución y el remuestreo Lanczos4 existentes. El modelo no genera texto, no modifica precios y no ejecuta OCR.
- SHA256 y tamaño del archivo se verifican antes de cargarlo. `node scripts/download-corner-model.mjs` reproduce la descarga desde la ubicación oficial y rechaza contenido diferente.

El runtime usado exporta `readNetFromONNX`, `blobFromImage`, `setInput` y `forward`. Se ejecutó el modelo real; la presencia de constantes del motor por sí sola no se tomó como prueba de compatibilidad. El ensayo no forzó una selección de motor no expuesta por esos enlaces JavaScript.

## Comparación inicial y límites

Se probaron dos fotografías reales de laboratorio, mantenidas fuera del repositorio. Ambos métodos localizaron la hoja. Las propuestas difieren y se revisaron visualmente; no se hizo una evaluación de OCR ni se dispone de un conjunto independiente de referencias para declarar superioridad general.

La detección neuronal completa en la aplicación tardó aproximadamente **2,3–4,6 segundos** en Chromium de escritorio, incluyendo la inicialización del Worker y carga local de sus archivos. No son tiempos de teléfono ni incluyen una descarga real desde Internet. El modelo agrega unos 4,8 MB de almacenamiento y descarga a OpenCV 5, que ya ocupa unos 13,3 MB sin comprimir. No se midió el pico de memoria total durante la inferencia.

Un control sintético con una hoja rectangular que ocupa casi todo el encuadre no produjo cuatro regiones fiables: el modelo fue rechazado y se conservó el detector habitual. Otro control con perspectiva y sombra produjo una activación alta, pero delimitó el bloque de texto interior en lugar del papel. La comprobación de discrepancia geométrica rechaza ese recorte y conserva la hoja detectada por el método habitual. Este resultado respalda conservar el método actual y muestra por qué la activación alta no basta para elegir el recorte.

Se corrigió además el tamaño del contenedor de la foto en el editor: al limitar la altura del canvas, el contenedor podía seguir ocupando todo el ancho y estirar el contorno. Ahora la foto y el contorno comparten el mismo rectángulo, también al cambiar orientación o tamaño de pantalla.

La prueba inicial es pequeña. Falta medir teléfonos y más documentos antes de cambiar el valor predeterminado o usar el modelo en la cámara en vivo. Los controles automatizados incluyen decodificación, cancelación, respaldo, edición manual, CSP sin `unsafe-eval`, ausencia de subidas, rechazo de un recorte interior incorrecto sobre una hoja sintética con perspectiva y funcionamiento offline.

Pasaron **51 pruebas unitarias y los 14 casos de navegador**, además de la comprobación TypeScript y compilación de producción. El primer ensayo automatizado esperaba que el modelo acertara una hoja sintética; la comparación contra su contorno conocido mostró que estaba recortando el texto. Se incorporó el control de discrepancia y se volvió a ejecutar la suite completa. No se ajustó el umbral de precisión para aceptar aquel recorte incorrecto.

También se compiló con `SCANNER_BASE=/web-document-scanner/` y pasaron los casos de inferencia bajo CSP y uso sin conexión en esa subruta.

## Calibración de cámara: siguiente experimento posible

La calibración corrige distorsión radial/tangencial del lente. No es equivalente a enderezar perspectiva ni a corregir la curvatura física del papel. Ya existía en OpenCV 4.

Se verificaron en nuestra distribución 5.0 `calibrateCameraExtended`, `initUndistortRectifyMap`, `undistort` y `aruco_CharucoDetector`. `findChessboardCorners` no está exportada. Un flujo basado en ChArUco requeriría comprobar los enlaces del detector, tomar varias vistas de un patrón plano conocido y validar el error de reproyección. Ver [calibración de cámara de OpenCV](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html).

El perfil tendría que identificar cámara, resolución y condiciones de captura compatibles. No se debe aplicar el mismo perfil entre lentes, zooms o entre una vista previa recortada y una foto nativa sin validar su correspondencia. La cámara del teléfono puede entregar imágenes ya corregidas.

No se implementó calibración ni se aplicaron coeficientes supuestos. Si se incorpora, conviene componer la corrección óptica con el mapa geométrico final para conservar un único remuestreo.
