# Prueba de OpenCV.js 5.0.0

Fecha: 11 de octubre de 2026. Rama experimental: `experiment/opencv-5`.

La actualización funciona en Chromium, mantiene la calidad de las imágenes de laboratorio y pasa las pruebas de captura, exportación, seguridad y uso sin conexión. No se demostró una mejora consistente de velocidad ni de reconocimiento. La prueba no modifica la versión pública.

## Método

Se compararon OpenCV.js `4.12.0-release.1` y `5.0.0-release.1` con dos entradas locales de una sesión de laboratorio: una foto individual y la combinación de una ráfaga. Las imágenes y sus documentos no forman parte del repositorio.

Cada salida mide 1741 × 2400 píxeles. Se mantuvieron las mismas cuatro esquinas, detección de guías, ajuste cúbico, validación del mapa, remuestreo Lanczos4, normalización de iluminación y nitidez 0,2. Por versión y entrada se ejecutaron seis iteraciones en un Worker: una inicial y cinco con el motor inicializado. Los tiempos de la tabla son medianas de esas cinco iteraciones, tomadas en una segunda serie local con Chromium de escritorio. No representan el rendimiento de un teléfono.

La referencia numérica 4.12 utiliza la distribución original de npm con ejecución dinámica permitida únicamente en su Worker local de comparación. El bundle 4.12 adaptado del proyecto no completó la inicialización en el sondeo aislado con CSP estricta. La salida de referencia 4.12 coincidió píxel por píxel con la rectificación de laboratorio guardada anteriormente. El Worker 5.0 utiliza la adaptación estática y una CSP que prohíbe `unsafe-eval`.

## Resultados visuales y geométricos

| Entrada | Guías en ambas versiones | Curvatura aplicada | Perspectiva y filtros habituales |
| --- | ---: | --- | --- |
| Foto individual | 32 | No: ambas rechazaron el mapa y aplicaron perspectiva | Píxeles y archivos PNG idénticos |
| Ráfaga combinada | 46 | Sí | Píxeles y archivos PNG idénticos |

La comparación incluyó todos los canales RGB de los 4.178.400 píxeles. La diferencia absoluta fue cero en ambas salidas habituales. Por eso no se repitió un OCR remoto: el PNG enviado sería exactamente el mismo, y esta actualización no aporta información adicional al reconocedor.

También se activó, por separado, la opción de enderezar filas que utiliza interpolación bicúbica. Allí aparecieron diferencias pequeñas, compatibles con el cambio de interpolación descrito en la guía de migración: diferencia media de 0,0622 niveles por canal en la foto individual y 0,0391 en la combinación, sobre una escala de 0 a 255; diferencias máximas de 12 y 5, respectivamente. No se evaluó si esas diferencias cambian la exactitud del OCR.

## Tiempo y memoria

| Entrada | Perspectiva 4.12 | Perspectiva 5.0 | Filtros 4.12 | Filtros 5.0 | Total 4.12 | Total 5.0 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Foto individual | 2226 ms | 2413 ms | 605 ms | 622 ms | 2878 ms | 3043 ms |
| Ráfaga combinada | 2531 ms | 2546 ms | 660 ms | 617 ms | 3191 ms | 3164 ms |

El total se calcula como mediana de la suma de fases por iteración, por lo que puede diferir de la suma de las medianas de las columnas. En esta serie 5.0 fue aproximadamente 5,7% más lento en la foto individual y 0,8% más rápido en la combinación. Una serie anterior mostró mejoras de tiempo en ambas entradas; esa variación impide afirmar una aceleración estable.

La capacidad del búfer de memoria WebAssembly, observada desde `Mat.data.buffer.byteLength` después de procesar, fue **128 MiB en ambas versiones**. Esta medición describe memoria reservada por el motor; no es un pico medido de memoria total del navegador y no incluye todos los canvas, imágenes y objetos JavaScript.

El archivo de OpenCV.js pasa de aproximadamente **10,87 MB a 13,30 MB**, sin comprimir: alrededor de 22% más de descarga y almacenamiento offline. Se conservó la comprobación de tipos y la compilación de producción.

## Adaptación y validaciones

- El nuevo bundle expone una Promise de inicialización. El cargador la espera antes de utilizar matrices y funciones.
- La distribución original de 5.0 falla bajo la CSP estricta por sus constructores `Function`. Se sustituyeron `createJsInvoker` y `__emval_create_invoker` por cierres estáticos, siguiendo la semántica de Emscripten con `DYNAMIC_EXECUTION=0`. El WebAssembly permanece intacto.
- `scripts/adapt-opencv-csp.py` reproduce la adaptación y rechaza un bundle de entrada cuyo SHA256 no corresponda a la versión probada. Procedencia, licencia y hashes están en `public/vendor/opencv/SOURCE.txt`.
- Se actualizaron las rutas del Worker, la preparación offline, la lista de motores del Service Worker y el cálculo de versión de caché. La primera prueba offline detectó una referencia antigua en esa lista; después de corregirla, la prueba pasó.
- Pasaron las 39 pruebas unitarias y se verificaron los 11 casos de navegador: nueve casos en la primera ejecución y, tras la corrección offline, el caso offline y el nuevo caso con CSP estricta. Las imágenes de las pruebas automatizadas son sintéticas.
- La distribución 5.0 exporta las funciones actuales del escáner y `findTransformECC`, pero no expone `estimateAffinePartial2D`, `phaseCorrelate` ni `phaseCorrelateIterative`. La actualización por sí sola no habilita esas técnicas de alineación.

## Referencias

- [OpenCV 5.0.0](https://github.com/opencv/opencv/releases/tag/5.0.0).
- [Migración: cambios en remuestreo](https://github.com/opencv/opencv/wiki/OpenCV-4-to-5-migration#accelerated-warping).
- [Distribución JavaScript](https://github.com/TechStark/opencv-js).
- [Enlaces estáticos de Emscripten](https://github.com/emscripten-core/emscripten/blob/main/src/lib/libembind.js).
- [Invocación estática de Emscripten](https://github.com/emscripten-core/emscripten/blob/main/src/lib/libemval.js).
