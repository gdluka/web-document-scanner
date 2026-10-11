# A Bob's Scan

Escáner de documentos que funciona en el navegador. Detecta el contorno de la hoja en la cámara, permite una captura única o combinar una ráfaga de fotos y corrige perspectiva, curvatura e iluminación antes de exportar la imagen.

**[Usar el escáner](https://gdluka.github.io/web-document-scanner/)** · **[Abrir en StackBlitz](https://stackblitz.com/github/gdluka/web-document-scanner?startScript=dev)** · **[Código fuente](https://github.com/gdluka/web-document-scanner)**

Las fotografías se procesan en el dispositivo. La aplicación no tiene servidor de documentos, cuentas de usuario, telemetría ni servicios de OCR conectados.

## Prueba experimental de OpenCV 5

En la rama experimental de OpenCV 5 se incorporó una [prueba opcional de detección neuronal de la hoja](docs/neural-corner-detection.md). El detector habitual sigue siendo el predeterminado. El documento explica cómo comparar ambos métodos, sus límites y la posibilidad de probar calibración de cámara.

La web pública de `main` conserva su versión estable. Este ensayo se ejecuta desde el checkout de `experiment/opencv-5`.

## Qué incluye

- Cámara posterior con detección de bordes en vivo y contorno superpuesto al vídeo.
- Captura de seis fotografías y carga manual de entre dos y ocho imágenes.
- Selección de la captura más nítida y fusión de las imágenes que se pueden alinear con confianza.
- Detección automática y ajuste manual de las cuatro esquinas, con controles táctiles y de teclado.
- Corrección de perspectiva y corrección experimental de la curvatura de tablas.
- Remuestreo geométrico único desde la imagen original, con interpolación Lanczos4.
- Perfiles para tablas, documentos y fotografías; compensación de iluminación y nitidez suave.
- Comparación entre original, ráfaga, perspectiva preparada y resultado.
- Exportación PNG, JPEG y WebP.
- Descarga local de los metadatos geométricos y de procesamiento.
- Funcionamiento offline en la versión compilada, después de descargar los motores.

## Usar la web pública

Abrir **[Usar el escáner](https://gdluka.github.io/web-document-scanner/)** para ejecutar la versión compilada en una pestaña normal, incluyendo desde el teléfono. Está alojada en GitHub Pages mediante HTTPS. El sitio entrega archivos estáticos; las fotos se procesan en el dispositivo.

La publicación se realiza automáticamente desde `main` después de pasar las pruebas. StackBlitz sigue disponible para editar y ejecutar el proyecto en su entorno de desarrollo.

## Laboratorio público

La calibración experimental está disponible en [GitHub Pages — laboratorio](https://gdluka.github.io/web-document-scanner/lab/), sin arrancar un entorno de desarrollo. El escáner habitual sigue en la raíz.

## Probar en StackBlitz

1. Abrir el enlace **Abrir en StackBlitz**.
2. Esperar a que se instalen las dependencias y arranque `npm run dev`.
3. Abrir la vista previa en una pestaña independiente mediante **Open in new tab**.
4. Permitir el acceso a la cámara cuando lo solicite el navegador.
5. Pulsar **Abrir cámara** y encuadrar la hoja completa.

StackBlitz importa directamente el repositorio público. No requiere configurar credenciales de la aplicación. Su entorno WebContainers ejecuta el servidor de desarrollo en el navegador: la disponibilidad y el consumo de memoria dependen del navegador y del dispositivo. La vista previa puede necesitar una pestaña independiente para solicitar acceso a la cámara.

El modo offline de esta aplicación se habilita en una compilación de producción. En StackBlitz se utiliza la vista previa de desarrollo, cuyo entorno gestiona sus propios recursos. No se promete funcionamiento offline de StackBlitz.

Referencias oficiales: [importación desde GitHub](https://developer.stackblitz.com/guides/user-guide/importing-projects) y [compatibilidad de navegadores](https://developer.stackblitz.com/platform/webcontainers/browser-support).

## Cómo escanear

### Captura con cámara

1. Colocar el documento sobre una superficie que contraste con el papel.
2. Evitar sombras fuertes, reflejos y movimientos durante la captura.
3. Abrir la cámara y encuadrar la hoja en la vista de pantalla completa. Los botones de captura y cierre quedan sobre la imagen. El contorno verde ayuda a ubicar los bordes, pero no es obligatorio para capturar.
4. Pulsar **Capturar una foto**. El escáner solicita enfoque automático cuando está disponible y aprovecha las indicaciones de detalle y estabilidad para tomar una única fotografía.
5. La comprobación es orientativa: espera hasta 1,5 segundos y toma la foto aunque no logre confirmar nitidez, estabilidad o bordes. No exige otro botón ni muestra un error de calidad; permite revisar la imagen y repetirla si hace falta.
6. Revisar las esquinas y ajustarlas si fuera necesario. Pulsar **Usar foto preparada** y luego **Procesar imagen**.
7. Comparar las cifras y descargar el resultado.

**Capturar 6 fotos** conserva la alternativa de ráfaga. Se selecciona la mejor fotografía y se combinan las que pueden alinearse; al confirmar sus bordes, se procesa automáticamente.

El contorno representa una detección real. Si el detector no encuentra una hoja, se muestra el estado de búsqueda; no se simula una detección. Después de capturar, siempre se puede ajustar el encuadre manualmente.

La cámara abre un diálogo que ocupa todo el viewport y conserva la proporción original del vídeo. El contorno comparte exactamente ese encuadre, también al girar el teléfono; no se recorta la imagen para llenar los márgenes. Los controles respetan las áreas seguras del dispositivo. Se solicita además el modo fullscreen del navegador al pulsar **Abrir cámara**; si no se admite o se rechaza, se mantiene la vista completa dentro de la página. Cerrar, cancelar o capturar libera la cámara, devuelve el desplazamiento de la página y sale del fullscreen solicitado por el escáner. **Escape** también permite cerrar. Referencias: [requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) y [showModal](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal).

### Contorno estable e indicaciones de encuadre

El contorno de la cámara tiene un seguimiento temporal independiente de las mediciones usadas para foco y detalle. Los cambios visuales de hasta el 0,4% del encuadre se mantienen en una banda muerta. Los desplazamientos pequeños se suavizan con un promedio exponencial (peso 0,22, o 0,6 para movimientos mayores); una traslación coherente se sigue sin retraso adicional. Un cambio brusco de forma o tamaño debe aparecer en dos detecciones compatibles antes de reemplazar la hoja. Una pérdida puntual conserva la última forma hasta dos segundos, en ámbar y sin confirmar la calidad; después se retira. Nunca se dibuja un contorno detectado antes de una detección real válida.

**Verde** significa que el tamaño aparente, centrado y perspectiva son adecuados y que dos detecciones consecutivas conservan la ubicación. **Ámbar** indica que se está confirmando el borde, o recomienda acercar, alejar, centrar o poner el teléfono más paralelo a la hoja. La indicación de distancia se infiere del tamaño aparente del papel: no mide centímetros ni presupone un tamaño de hoja específico. Se recomienda acercar por debajo del 35% de cobertura y alejar con menos del 2,5% de margen o más del 88% de cobertura. Estos valores son orientativos y las recomendaciones siguen sin bloquear la captura. El verde del encuadre no garantiza nitidez ni exactitud OCR.

### Enfoque y comprobación de captura única

Se consultan las capacidades de la cámara activa (`getCapabilities`). Se solicita enfoque `continuous` o, si solo está disponible, `single-shot`. Cuando el navegador reconoce `pointsOfInterest` en `getSupportedConstraints`, se solicita el centro del contorno de la hoja en coordenadas normalizadas. Si rechaza ese punto, se vuelve a intentar únicamente el enfoque automático; si tampoco lo admite, se conserva el control de la cámara. La interfaz informa qué se **solicitó**, sin afirmar que el hardware confirmó el enfoque. No se fija una distancia de 50 cm.

La detección de contorno conserva un lado máximo de 640 px. La comprobación de detalle trabaja sobre una vista previa de hasta 960 px, dentro del 80% interior del cuadrilátero, para excluir el borde del papel y el fondo. Usa contraste y extensión aproximada de bordes horizontales/verticales mediante Sobel y percentiles en histogramas. No filtra ni modifica la fotografía capturada. Los criterios de esta primera implementación son cobertura de hoja ≥25%, contraste ≥25 niveles de gris y extensión de borde ≤4,5 px en la escala de análisis.

El detector de bordes reutiliza un Worker y su motor WASM; lo recicla cada 30 análisis para limitar las asignaciones de sus bindings antiguos. En paralelo, un control independiente obtiene cuadros actuales de vídeo cada 500 ms para comprobar detalle y movimiento, de modo que el tiempo de detección no envejezca artificialmente la comprobación.

Se requieren tres observaciones con detalle durante al menos 900 ms, con desplazamiento de esquinas ≤1,2% de la imagen y variación de extensión de borde ≤20% o 0,5 px. Se descartan observaciones anteriores a un nuevo pedido de enfoque y se espera al menos 400 ms después de solicitarlo. Además, se compara una muestra de luminancia de 64 × 64 puntos interiores para detectar movimiento del texto entre respuestas del detector; se descuenta el cambio uniforme de exposición. Las observaciones demasiado antiguas no confirman la calidad de la vista previa: el último cuadro debe tener menos de 1,5 s y el contorno menos de 4 s. Al pulsar el botón se conservan las comprobaciones válidas y no se vuelve a solicitar enfoque si ya se pidió sobre esa hoja. Las indicaciones en vivo distinguen bordes, tamaño, texto, nitidez o estabilidad y nunca bloquean el disparo. La espera al pulsar el botón se limita a 1,5 segundos; si no hay comprobación fiable, se captura igualmente y se invita a revisar el texto y las esquinas. Estos valores son **heurísticas de vista previa**, no una calibración de exactitud OCR ni una garantía de enfoque para todos los teléfonos. Los errores se reservan para fallos reales al abrir la cámara o tomar la foto.

Para obtener la foto se utiliza `ImageCapture.takePhoto` y, si se exponen, las dimensiones máximas de `getPhotoCapabilities`. Si la cámara rechaza esa combinación de dimensiones se reintenta con sus ajustes de foto predeterminados. Si la captura fotográfica no está disponible o falla, se conserva la alternativa de un fotograma PNG a la resolución real del vídeo, sin ampliarlo artificialmente. Cancelar cierra la cámara y descarta las respuestas de captura pendientes; una captura cancelada no sustituye el documento anterior. Las solicitudes a la cámara tienen un tiempo máximo de espera.

Los controles y sus capacidades varían entre dispositivos y navegadores. Referencias: [MediaTrackConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints) y [API ImageCapture](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture).

### Prueba de calibración de cámara — rama experimental

La indicación de acercar o alejar la hoja evalúa encuadre y tamaño en la vista previa; **no calcula la calibración óptica del lente**. El teléfono puede aplicar ya su propia corrección, en cuyo caso otra calibración puede no aportar una mejora. La calibración tampoco corrige desenfoque ni dobleces del papel.

Esta rama incorpora un panel independiente **Probar calibración de cámara — experimental**, cerrado por defecto. Al abrirlo se puede calcular un perfil a partir de un patrón físico y comparar una fotografía con y sin corrección. **El perfil no se aplica automáticamente al escáner habitual.**

Para realizar la prueba:

1. Abrir el panel y descargar el [patrón ChArUco A4 en PDF](public/calibration-pattern-A4.pdf). Imprimir en A4 al **100%**, comprobar un cuadrado de **30 mm** y fijar la hoja sobre una superficie plana. También se puede generar una versión SVG en el navegador.
2. Agregar entre **10 y 20 fotos** originales del patrón, mediante **Tomar foto del patrón** o **Agregar fotos del patrón**. Usar la misma cámara, modo de foto, orientación, resolución y zoom. Variar posiciones, distancia e inclinación: algunas vistas deben mostrar el patrón inclinado y otras acercarlo a los bordes de la imagen. El patrón completo debe permanecer visible.
3. Revisar las miniaturas con las 24 esquinas detectadas. Reemplazar fotos rechazadas o repetidas. Pulsar **Calcular perfil de cámara**.
4. Cargar una fotografía original del documento mediante **Foto para comparar la corrección óptica**. Debe proceder de la misma cámara y modo, con la misma resolución y orientación. Comparar las dos imágenes; la vista previa utiliza el mismo tamaño en ambas y la salida corregida se puede descargar.
5. Descargar el **perfil JSON** para conservarlo. Al cerrar el panel se libera el motor y se descartan las fotos de esa sesión. El perfil se puede volver a cargar, pero pertenece a esa cámara y modo de captura: no se traslada automáticamente a otro teléfono, lente, zoom o recorte del sensor.

El patrón contiene **5 × 7 cuadrados**, marcadores **DICT_4X4_50**, cuadrados de **30 mm** y marcas de **21 mm**. El PDF incluye una imagen sin pérdidas y una página A4 de dimensiones físicas explícitas. Se puede regenerar con `python3 scripts/build-calibration-pattern.py`, usando OpenCV con `aruco` disponible.

Las imágenes se analizan de una en una, con lado mayor limitado a **1600 píxeles**, y los bitmaps se liberan después de leerlas. Solo se conservan las posiciones detectadas y miniaturas pequeñas en memoria. Se usa `CharucoDetector` y `calibrateCameraExtended` de la distribución de OpenCV 5; el modelo de lente es pinhole con cinco coeficientes: `k1`, `k2`, `p1`, `p2`, `k3`. La matriz intrínseca se escala desde la resolución de análisis a la resolución original, sin cambiar los coeficientes de distorsión.

Se rechazan conjuntos con resoluciones mezcladas, patrones incompletos, archivos repetidos, posiciones casi idénticas, cobertura insuficiente o falta de tomas inclinadas. El perfil exige parámetros finitos y plausibles, error RMS global de hasta **0,8 px** en la resolución de análisis y errores por foto de hasta **1,5 px**. Se verifica además que el mapa estimado no invierta ni deforme excesivamente la imagen, incluyendo distorsión tangencial y columnas exteriores. Estos umbrales son controles conservadores del laboratorio, no certifican la precisión del OCR.

La corrección de comparación se ejecuta con `undistort`, conserva el campo de vista definido por la matriz original y no realiza un recorte automático. Es una transformación adicional para inspeccionar el efecto óptico. Si posteriormente se integrara en la preparación normal, el mapa óptico debería componerse con el mapa de perspectiva y curvatura antes del remuestreo final, para evitar interpolaciones consecutivas.

Las pruebas con proyecciones sintéticas de una cámara conocida recuperaron `fx = 1050`, `fy = 1040`, el centro óptico y los cinco coeficientes con error RMS de aproximadamente **0,00002 px**. Una imagen sintética con una línea curvada por esa distorsión se enderezó con desviación media inferior a **1 px**. Las pruebas verifican cálculo, patrón, cancelación, CSP y funcionamiento de la comparación, pero **todavía no se ha calculado un perfil de una cámara real del usuario ni medido una mejora de su OCR**.

Todo se procesa localmente. El modo sin conexión incluye el worker de calibración y el patrón PDF al preparar sus recursos. Referencia: [tutorial oficial de calibración de OpenCV](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html).

### Fotografía o ráfaga existente

**Cargar fotografía** abre una imagen desde el dispositivo. **Tomar foto** utiliza la cámara del sistema operativo; el contorno en vivo pertenece a **Abrir cámara**, no a la interfaz de cámara del sistema.

**Cargar fotos de una ráfaga** admite de dos a ocho imágenes de la misma hoja, con la misma orientación y resolución. Conviene utilizar los archivos originales, sin compresión de aplicaciones de mensajería.

Al cargar una sola foto se confirma primero el recorte y luego se pulsa **Procesar imagen**. **Usar original** conserva la fotografía completa. **Cancelar foto** sale del editor sin sustituir la última imagen preparada.

### Ajuste de esquinas y opciones

Los puntos se pueden arrastrar con el dedo o el ratón. Con un punto enfocado, las flechas del teclado permiten ajustes pequeños. Se rechazan esquinas cruzadas, fuera de la imagen o que forman un área demasiado pequeña.

- **Girar 90°** modifica la orientación y vuelve a detectar los bordes.
- **Detectar bordes** repite la detección automática.
- **Recorte rectangular** permite seleccionar una zona sin perspectiva.
- **Corregir curvatura de la tabla** activa el modo experimental basado en líneas físicas.
- **Compensar sombras e iluminación** busca uniformar el fondo del papel.
- **Nitidez suave** aplica un refuerzo moderado; valores altos pueden exagerar halos.
- **Enderezar filas con líneas fiables** es una alternativa para tablas con líneas inclinadas. Se deshabilita si ya se aplicó la corrección de curvatura, para evitar otra transformación innecesaria.
- **PNG** conserva los píxeles sin compresión con pérdida. JPEG y WebP permiten ajustar calidad.

Comparar siempre códigos pequeños, signos y cifras. Una imagen que parece más contrastada puede perder detalles útiles para OCR.

## Ejecutar localmente

Requiere Node.js **22.12 o posterior**. Se puede usar npm o pnpm.

```bash
git clone https://github.com/gdluka/web-document-scanner.git
cd web-document-scanner
npm install
npm run dev
```

Vite informa la dirección local. Para acceder a la cámara se necesita un contexto seguro: HTTPS o `localhost`. Acceder desde el teléfono a una dirección HTTP de la red local no garantiza permiso para usar la cámara; se debe utilizar una vista previa HTTPS o un túnel HTTPS.

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

Para ejecutar las pruebas de navegador, instalar Chromium con `npx playwright install chromium` y usar `npm run test:e2e`.

El resultado de `npm run build` queda en `dist/` y se puede servir en cualquier alojamiento estático HTTPS. No necesita una base de datos ni un servidor Node.js en producción.

Para alojarlo bajo una subcarpeta, definir `SCANNER_BASE` al compilar:

```bash
SCANNER_BASE=/web-document-scanner/ npm run build
```

Los workers y los motores utilizan la misma base. La importación en StackBlitz usa `/` de forma predeterminada.

## Arquitectura

```mermaid
flowchart TD
  A[Cámara o archivos locales] --> B[Contorno y captura]
  B --> C{Una foto o ráfaga}
  C -->|Ráfaga| D[Medir nitidez, alinear y fusionar]
  C -->|Una foto| E[Editor de esquinas]
  D --> E
  E --> F[Homografía y guías de curvatura]
  F --> G[Mapa inverso combinado]
  G --> H[Un remuestreo Lanczos4]
  H --> I[Iluminación y nitidez opcionales]
  I --> J[Comparación y descarga local]
```

La interfaz utiliza **SolidJS y TypeScript**, con **Vite** para desarrollo y compilación. Las operaciones costosas de fusión y procesamiento se ejecutan en **Web Workers** para permitir que la interfaz siga respondiendo.

Los motores son recursos locales del proyecto:

- [`101arrowz/scanner`](https://github.com/101arrowz/scanner): detección de bordes en WebAssembly.
- [OpenCV.js](https://github.com/opencv/opencv/tree/5.0.0): transformaciones, morfología, filtros y remuestreo.
- [Distribución OpenCV.js](https://github.com/TechStark/opencv-js): versión experimental fijada `5.0.0-release.1`.

No se descarga código de motores desde un CDN durante el escaneo. En la primera visita el navegador descarga los archivos públicos del proyecto, incluyendo OpenCV.js, cuyo archivo ocupa aproximadamente 13,3 MB. El tiempo inicial incluye esa descarga y la inicialización de WebAssembly.

## Proceso técnico

### 1. Vista previa y detección del contorno

La cámara solicita orientación posterior y una resolución ideal de 2560 × 1920. El navegador y el dispositivo deciden la resolución disponible.

La detección en vivo analiza un cuadro reducido cuyo lado mayor no supera 640 píxeles. Cada análisis termina antes de programar el siguiente, con una pausa de 500 ms. Este intervalo no equivale a una tasa fija de cuadros por segundo: también depende del tiempo de detección.

Las esquinas se normalizan a coordenadas `[0, 1]`. El SVG y el vídeo comparten contenedor, dimensiones y coordenadas. La posición del contorno se define dentro del componente para que no quede debajo del vídeo si la hoja de estilos es anterior.

Cerrar o cancelar la cámara detiene todas sus pistas y descarta los resultados de detecciones anteriores. Mientras se espera la comprobación de captura única, el análisis continúa. Durante la toma de la fotografía o la ráfaga se evita iniciar otro análisis del cuadro.

### 2. Captura y fusión de ráfaga

Cuando está disponible, se utiliza `ImageCapture.takePhoto()` para obtener fotografías. Si no se puede usar, se extraen cuadros de la transmisión de vídeo. Se capturan seis imágenes, con pausas de 180 ms entre solicitudes; las capturas de alta resolución pueden agregar su propia demora.

Las imágenes se reducen, si es necesario, a un lado mayor de 2000 píxeles. Se evalúa su nitidez, se selecciona una referencia y se alinean las demás por desplazamiento X/Y con refinamiento subpíxel. La alineación actual no estima giros, cambios de escala ni deformaciones locales. Las imágenes con alineación insuficiente se descartan. Si solamente una es fiable, se conserva la mejor captura y se informa ese resultado.

La fusión busca reducir ruido y mejorar legibilidad. Esta implementación **no es superresolución** y no promete recuperar detalle que ninguna captura contiene. Un movimiento grande, desenfoque, cambios de iluminación u objetos móviles pueden impedir una combinación útil.

### 3. Perspectiva

El editor trabaja con cuatro puntos en orden horario: inferior izquierdo, superior izquierdo, superior derecho e inferior derecho. Se validan límites, convexidad y un área normalizada mínima del 2 %.

A partir de las esquinas se calcula una homografía que transforma el cuadrilátero de la hoja en un rectángulo. El tamaño de trabajo se limita para controlar memoria y tiempo de procesamiento. El editor prepara la imagen a un lado mayor de 2400 píxeles y permite una ampliación geométrica acotada; ampliar no crea detalle óptico nuevo.

### 4. Detección de guías y ajuste cúbico

Para analizar la curvatura se construye una vista rectificada de referencia. Esa vista solamente sirve para detectar geometría: el resultado final se remuestrea desde la imagen fuente.

El detector utiliza gris, umbral adaptativo y apertura morfológica horizontal para buscar líneas físicas de la tabla. Muestrea 45 posiciones del eje X, entre el 4,5 % y el 96,5 % del ancho. Las trayectorias deben cubrir una proporción suficiente de esas posiciones; los fragmentos cortos de texto no se aceptan como guías fiables.

Cada guía se aproxima por un polinomio:

```text
u = x / W
s_i(x) = a0 + a1·u + a2·u² + a3·u³
```

Normalizar X mejora el condicionamiento numérico. Los cuatro coeficientes se obtienen mediante mínimos cuadrados con **QR y Gram–Schmidt modificado, con dos pasadas de ortogonalización**. El cálculo está implementado en TypeScript y no necesita NumPy, una biblioteca de álgebra adicional ni un modelo de IA.

Se controlan cobertura, residuo, posición y separación entre guías. Su cantidad depende de cada documento; no se asume un número fijo de filas.

### 5. Interpolación vertical entre curvas

Para cada guía se define una altura de destino estable `t_i`, tomando su altura en el centro de la tabla. Se agregan anclas para el borde superior y el inferior de la imagen.

Para una fila de salida `y` entre dos anclas consecutivas:

```text
alpha = (y - t_i) / (t_(i+1) - t_i)
Y_curva(x,y) = (1-alpha)·s_i(x) + alpha·s_(i+1)(x)
```

La interpolación entre guías es **lineal por tramos**. Los polinomios cúbicos describen la curvatura horizontal de cada guía; no se ajusta otro polinomio global a todas las filas.

### 6. Mapa combinado y remuestreo único

La coordenada `(x, Y_curva)` se transforma mediante la homografía inversa hacia la imagen fuente. Así se obtiene un mapa que compone perspectiva y curvatura antes de interpolar los píxeles:

```text
source(x,y) = H_inverse(x, Y_curva(x,y))
output = remap(original, source, Lanczos4)
```

Esto evita aplicar primero una transformación de perspectiva al resultado final y luego volver a interpolarlo para corregir la curvatura. La interpolación Lanczos4 se realiza una sola vez en la etapa geométrica. Los filtros de imagen posteriores siguen siendo opcionales.

Los mapas X e Y son `Float32Array` planos. Se precalculan las posiciones de las guías y se recorre la salida por filas para mejorar la localidad de memoria. El bucle por píxel no crea objetos pequeños ni arreglos temporales.

### 7. Validación y fallback

Antes de remuestrear, se validan todas las columnas, incluyendo `x = 0` y `x = W - 1`. Esto cubre los márgenes en los que los polinomios extrapolan fuera de su región de muestreo.

Se comprueban orden vertical, separación positiva y escala local acotada. Se rechazan cruces, compresión excesiva, denominadores de homografía inválidos y coordenadas no finitas. Si faltan guías suficientes o falla la validación, se aplica **solamente perspectiva** y se informa que la curvatura no se corrigió.

Los objetos `cv.Mat` se liberan en bloques `finally`. Los workers se terminan después de completar, cancelar o fallar una operación.

### 8. Iluminación y nitidez

Los filtros operan después de la preparación geométrica. La compensación de iluminación estima el fondo para reducir variaciones de luz; la nitidez agrega un refuerzo moderado de contraste local. El umbral adaptativo se usa para detectar guías geométricas; la imagen exportada no recibe una binarización adaptativa final para OCR.

Estos filtros no deshacen de forma general el desenfoque ni reconstruyen letras perdidas. Cuando el original ya es nítido, la corrección geométrica sin filtros adicionales puede producir la mejor imagen para OCR. Conviene comparar varias variantes y elegir la que conserva mejor las cifras.

## Metadatos e integración con OCR

**Descargar metadatos** genera un JSON local con dimensiones, rotación, esquinas, homografía, curvas, alturas de destino, fallback, opciones y medidas de procesamiento. No incluye el contenido de la fotografía ni reconoce nombres o cifras.

Este proyecto prepara imágenes. **El reconocimiento de texto no está incluido en la interfaz pública.** No contiene claves de proveedores ni utiliza una cuenta compartida de OCR. Se puede enviar la imagen descargada a un motor de OCR propio o integrar uno en una aplicación que use estos módulos.

Para integrar resultados de OCR basados en coordenadas:

1. Registrar las dimensiones de la imagen efectivamente enviada al OCR.
2. Si se redujo desde una altura `H` a `H_ocr`, escalar cada guía con `k = H_ocr / H`.
3. Comparar las cajas del texto con intervalos entre guías escaladas, sin confiar en el orden de un arreglo de palabras.
4. Distinguir encabezados por semántica y estructura antes de aplicar reglas comerciales a filas de datos.
5. Definir columnas usando encabezados y alineaciones repetidas de los datos; una guía horizontal no delimita columnas por sí sola.
6. Marcar asociaciones ambiguas para revisión, en lugar de asignar precios automáticamente.

Las guías de este proyecto describen líneas geométricas. Su presencia no garantiza que cada intervalo sea un artículo ni que el OCR reconozca el 100 % de una imagen. La lógica de documentos, columnas y validación comercial pertenece a la integración que consuma la imagen.

## Investigación de técnicas para mejorar el OCR

Revisión del **11 de octubre de 2026**. Se compararon repositorios y documentación primaria con la implementación de este proyecto. Las técnicas siguientes se investigan como referencias; su inclusión no implica que estén integradas en la interfaz pública. Los ensayos y la posterior incorporación de la comprobación orientativa de captura única se describen por separado. El escáner público sigue preparando imágenes sin ejecutar OCR.

### Proyectos y diferencias concretas

| Proyecto y fuente | Técnica que aporta | Diferencia y posible aplicación |
| --- | --- | --- |
| [OSS Document Scanner](https://github.com/ossappscollective/OSS-DocumentScanner/blob/main/plugin-nativeprocessor/platforms/android/java/com/akylas/documentscanner/AutoScanHandler.kt) | Sigue las cuatro esquinas entre cuadros y cancela la captura automática cuando pierde la continuidad del contorno. | Actualmente el usuario dispara la ráfaga sin una comprobación temporal de estabilidad. Adaptar esa idea a coordenadas normalizadas y agregar, como propuesta propia, control de nitidez dentro de la hoja y de zonas sobreexpuestas. Su implementación es nativa; se adaptaría la técnica a TypeScript. |
| [page-dewarp](https://github.com/lmmx/page-dewarp), [explicación del autor original](https://mzucker.github.io/2016/08/15/page-dewarping.html) | Agrupa contornos de texto en renglones y ajusta un modelo de superficie cúbica mediante optimización. | Nuestro ajuste depende de líneas físicas de tablas. Usar líneas de texto como guías adicionales permitiría evaluar documentos sin cuadrícula. El modelo Python no es un reemplazo directo del worker; hay que medir el costo de optimización. El autor también documenta compresión horizontal residual. |
| [ScanTailor Advanced](https://github.com/ScanTailor-Advanced/scantailor-advanced) | Binarización adaptativa Sauvola/Wolf y separación del contenido de texto e imágenes. | Compensamos el fondo, pero no generamos una variante final con umbral local. Probar Sauvola después de la geometría, conservando también una versión en gris; medir si mantiene cifras finas. Es una referencia de algoritmos, no una dependencia de navegador. |
| [Deep Burst Super-Resolution](https://github.com/goutamgmb/deep-burst-sr) | Alineación mediante flujo óptico por píxel y fusión aprendida de múltiples capturas RAW para superresolución. | Nuestra fusión usa desplazamiento global y promedio con rechazo de diferencias. Primero probar alineación afín y pesos locales de nitidez; solamente después evaluar flujo óptico. El modelo RAW no se puede aplicar directamente a nuestra ráfaga JPEG/PNG esperando los mismos resultados. |
| [PaddleOCR.js, SDK oficial](https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/README.md) | Detecta y reconoce texto en el navegador; devuelve polígonos, texto y puntuación. Admite un worker dedicado y configuración del runtime WASM. | Permite evaluar OCR local como módulo opcional. Elegir modelos adecuados al idioma y medir descarga, memoria, tiempo y exactitud en teléfonos reales. El OCR de navegador no implica que todos los módulos Python de PaddleOCR estén disponibles en JavaScript. |
| [UVDoc](https://github.com/tanguymagne/UVDoc), [preprocesador de PaddleOCR](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/doc_preprocessor.html) | Estima una malla de deformación del documento con un modelo entrenado; PaddleOCR ofrece UVDoc como módulo opcional de rectificación. | Evaluar una corrección geométrica más general que nuestra interpolación vertical entre guías. Empezar con la implementación Python en laboratorio; la disponibilidad de PaddleOCR.js no confirma soporte de UVDoc en ese SDK. |
| [Tesseract.js](https://github.com/naptha/tesseract.js), [guía oficial de calidad de Tesseract](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) | OCR en navegador mediante WASM; la guía describe Sauvola/Otsu adaptativo, segmentación por región y configuración para códigos o cifras. | Probar reconocimiento por celdas o columnas con modos de línea/palabra y restricciones de caracteres específicas del campo. Una restricción numérica debe aplicarse a precios, conservando letras en códigos y descripciones. La documentación advierte que las tablas requieren análisis de layout. |
| [Scribe.js](https://github.com/scribeocr/scribe.js), [comparación con Tesseract.js](https://github.com/scribeocr/scribe.js/blob/master/docs/scribe_vs_tesseract.md) | Su modo de calidad agrega reconocimiento y comprobaciones; también extrae texto existente de PDFs. | Referencia para evaluar una segunda lectura de campos ambiguos. Sus autores indican más consumo y tiempo; se debe comprobar la mejora con documentos propios. Usa AGPL-3.0 y no se incorporó al proyecto MIT. |
| [DocRes](https://github.com/ZZZHANG-jx/DocRes) | Restauración aprendida con tareas de rectificación, eliminación de sombras, desenfoque y binarización. | Evaluar por separado los casos en que la geometría ya está resuelta y todavía falta legibilidad. Su implementación Python y sus pesos requieren una prueba de laboratorio; la apariencia mejorada no demuestra que conserve correctamente letras y números. |

### Orden recomendado de experimentos

Este orden es una conclusión de la comparación, no un resultado de rendimiento ya demostrado:

1. **Captura:** medir nitidez dentro del documento, estabilidad del contorno y saturación antes de iniciar la ráfaga. La medición actual de nitidez usa toda la foto y puede verse influida por objetos del fondo. Mantener captura manual cuando la evaluación sea incierta.
2. **Filtros para OCR:** comparar perspectiva/curvatura sin filtros, gris con iluminación compensada y Sauvola. Ajustar el tamaño de ventana según la escala del texto; conservar siempre el original. No aplicar erosión, dilatación o refuerzo agresivo de nitidez por defecto.
3. **Ráfaga:** ensayar una transformación afín antes del flujo óptico denso. OpenCV documenta [alineación ECC con modelos de traslación, euclídeo, afín y homografía](https://docs.opencv.org/4.12.0/dc/d6b/group__video__track.html); verificar si la distribución de OpenCV.js utilizada exporta las funciones necesarias. Rechazar alineaciones dudosas y comparar la fusión con la mejor captura individual.
4. **Reconocimiento:** comparar el mismo motor OCR sobre las variantes de imagen; después comparar Tesseract.js y PaddleOCR.js sobre una misma variante. Usar una segunda lectura solamente para regiones ambiguas y registrar desacuerdos.
5. **Geometría difícil:** añadir guías de texto y evaluar UVDoc/DocRes en laboratorio cuando el caso no se resuelva con los pasos anteriores. Conservar las validaciones del mapa y componer las transformaciones antes del remuestreo final.

### Cómo decidir si una técnica mejora el resultado

Preparar un conjunto fijo de documentos autorizados con transcripción de referencia, incluyendo poca luz, movimiento, pliegues y texto pequeño. Ejecutar comparaciones con idéntico motor, versión, idioma y configuración de OCR, cambiando una etapa por vez.

Registrar error por carácter (CER), porcentaje de códigos e importes exactos, asociación correcta entre fila y precio, omisiones, falsos positivos, tiempo, memoria y tamaño de descarga. Un importe legible asignado a otra fila sigue siendo un error. Priorizar conservación de caracteres y menor cantidad de asociaciones incorrectas; revisar por separado resultados visuales y resultados OCR.

Las fotografías y las transcripciones de referencia permanecen fuera del repositorio público. Las mejoras deben medirse con esos experimentos antes de generalizarse a otros documentos.

### Primer ensayo: filtros y segunda lectura por celda

Ensayo del **11 de octubre de 2026**, ejecutado fuera de la aplicación pública. Se utilizó una fotografía privada con poca luz, rectificada previamente a **1741 × 2400 píxeles**, y una referencia digital de **40 filas**. Se conservaron la misma geometría, el motor principal Google Cloud Vision (`DOCUMENT_TEXT_DETECTION`, idioma español) y el parser para comparar los filtros. Los códigos e importes de referencia se utilizaron para evaluar, sin suministrarlos a los motores OCR.

| Variante | Códigos presentes en el texto, de 40 | Asociaciones código/precio correctas, de 40 |
| --- | ---: | ---: |
| Iluminación compensada y nitidez 0,2: control actual | 39 | 37 |
| Gris sin filtros adicionales | 38 | 37 |
| CLAHE, límite 2 y cuadrícula 8 × 8 | 38 | 37 |
| Sauvola, ventana 51, `k = 0,15` | 13 | 0 |
| Sauvola después de compensar iluminación, ventana 51, `k = 0,15` | 12 | 0 |
| Sauvola, ventana 75, `k = 0,20` | 4 | 0 |
| Sauvola menos agresivo, ventana 51, `k = 0,03` | 33 | 0 |
| CLAHE seguido de Sauvola, ventana 51, `k = 0,05` | 33 | 0 |

Sauvola conserva algunos códigos, pero deteriora trazos tenues y la lectura de los encabezados necesarios para delimitar las columnas. **Cero asociaciones no significa ausencia de texto OCR**: en estas variantes el parser no puede reconstruir la tabla con sus encabezados. CLAHE no supera al control en esta muestra. Se conserva el procesamiento actual.

La implementación de Sauvola calcula `T = m × (1 + k × (s / 128 - 1))`, donde `m` y `s` son la media y la desviación estándar locales sobre gris de 8 bits. Usa filtros de caja, bordes replicados y varianza acotada a cero para evitar errores numéricos. Se comprobó su salida contra un cálculo directo de los vecindarios de una imagen sintética, incluyendo bordes. Referencia de la fórmula: [documentación de scikit-image](https://scikit-image.org/docs/stable/api/skimage.filters.html#skimage.filters.threshold_sauvola).

También se volvieron a reconocer tres filas pendientes como recortes completos. Dos filas se ensayaron además con ampliación Lanczos4 al doble. Manteniendo los intervalos geométricos originales, ninguno de esos intentos aumentó las 37 asociaciones correctas. Esta ampliación no representa superresolución.

La prueba que aportó una mejora fue una **segunda lectura local de las cifras**, usando Tesseract.js 7.0.0:

1. Localizar la fila mediante las guías físicas y las posiciones del OCR principal.
2. Delimitar las columnas a partir de los encabezados ya reconocidos.
3. Recortar solamente el rectángulo de las cifras, excluyendo el símbolo monetario y los bordes de la celda, y agregar un pequeño margen blanco.
4. Reconocer con `PSM.SINGLE_LINE`, caracteres `0123456789.,` y diccionarios general/frecuente desactivados. La prueba utilizó el modelo `eng` para campos numéricos; no evaluó descripciones en español con ese modelo.
5. Considerar la lectura secundaria únicamente si confirma el importe por docena del OCR principal, respeta la relación comercial exacta de esa lista, permanece en la misma fila y tiene confianza de al menos 85. La referencia digital no participa en esta decisión.

El ensayo pasa de **37 a 38 asociaciones correctas de 40**, conserva las 37 anteriores y no propone asociaciones incorrectas respecto de la referencia. Quedan un código ambiguo y un precio contradictorio. El importe recuperado tiene confianza 95 en la lectura secundaria, pero esa puntuación no equivale a una probabilidad de exactitud. La relación docena/par usada en esta prueba es específica del documento y no debe suponerse universal. Referencias de configuración: [API de Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) y [guía de calidad de Tesseract](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).

Los recortes amplios, que todavía incluyen bordes y símbolo monetario, produjeron lecturas deficientes. El modo `SINGLE_WORD` tampoco ayudó. `RAW_LINE` discrepó en el importe recuperado y tuvo menor confianza. Por ello, los resultados respaldan ampliar el ensayo de segmentación por celda; no demuestran que toda segunda lectura sea segura.

CLAHE tardó aproximadamente 16 ms y las variantes Sauvola 79–106 ms en el equipo de laboratorio. Las cuatro lecturas de cifras con `SINGLE_LINE` y resolución nativa sumaron 126 ms, con el motor ya inicializado. Esos tiempos no incluyen carga inicial del OCR, red ni geometría y **no son mediciones de rendimiento en teléfonos**.

Son resultados exploratorios de una sola captura. No se modificaron precios ni se agregó OCR al escáner público. Las imágenes, las respuestas OCR, los scripts con rutas privadas y la referencia digital no se publicaron. La prioridad siguiente es validar la segunda lectura de cifras sobre más documentos y condiciones de captura antes de integrarla.

### Segunda ronda: alineación, OCR neuronal y calidad de captura

Ensayos realizados el **11/10/2026**, fuera de la aplicación pública. Se separan las mediciones sobre la fotografía real de los ensayos con degradaciones y movimientos simulados.

**Alineación de ráfaga.** Se generaron cinco imágenes de 726 × 1000 a partir de una fotografía: desplazamiento conocido, giros de 0°, ±0,3° y ±0,6°, cambio de escala de 0,2% en las cuatro imágenes giradas, pequeña variación de exposición y ruido reproducible. Se comparó la función TypeScript actual con OpenCV 5.0.0 en Python. El error se midió contra la transformación conocida, sobre una cuadrícula de 400 puntos que cubre el 80% central de la imagen.

| Método | Error medio por imagen con giro, en píxeles | Tiempo por alineación, equipo de laboratorio |
| --- | --- | --- |
| Desplazamiento actual, TypeScript | 1,58–4,53 | 86–119 ms |
| ECC, transformación afín | 0,070–0,099 | 277–426 ms |
| Lucas–Kanade con ajuste de similitud y RANSAC | 0,010–0,011 | 10–26 ms |

El ensayo incluye un control con solo desplazamiento: el método actual obtuvo 0,080 px de error medio. Para Lucas–Kanade se utilizaron hasta 600 puntos, seguimiento piramidal de ida y vuelta, rechazo cuando el retorno difiere más de un píxel y RANSAC con umbral de un píxel. Una transformación de similitud tiene cuatro parámetros: desplazamiento X/Y, giro y escala uniforme.

**Estos resultados son sintéticos: no prueban una mejora del OCR, de la fusión o del rendimiento en teléfonos.** Python y TypeScript se ejecutaron en runtimes distintos. La fusión actual también puede rechazar imágenes por residual alto; medir una transformación no significa que la aplicación vaya a mezclarlas. Antes de integrarlo, hacen falta ráfagas reales, límites de movimiento y escala, comprobación de cobertura de puntos e inspección de cifras para detectar imágenes fantasma.

Se verificó que nuestra distribución OpenCV.js 4.12.0 expone `goodFeaturesToTrack`, `calcOpticalFlowPyrLK` y `findTransformECC`. No expone `estimateAffinePartial2D`, utilizada en el ensayo Python: ese ajuste requeriría una implementación pequeña propia o una distribución distinta. Fuente del seguimiento y ECC: [documentación oficial de OpenCV](https://docs.opencv.org/4.12.0/dc/d6b/group__video__track.html).

**PaddleOCR en navegador.** Se probó `@paddleocr/paddleocr-js` 0.4.2, PP-OCRv5 mobile, OpenCV.js 4.10.0-release.1 y ONNX Runtime Web 1.30.0. El ensayo usó Chromium, un Worker, WASM con un hilo y modelos servidos localmente. Se bloquearon peticiones externas durante la inferencia. No requiere credenciales ni enviar la imagen a una API. Las opciones usadas fueron `lang: en`, modelos explícitos y URLs locales; no se probó reconocimiento de español con PP-OCRv6.

- Archivos de modelos: **21,5 MB**, sin contar OpenCV, el runtime WASM y JavaScript.
- Inicialización local: **4,7 s**. No incluye descargar los modelos desde Internet.
- Cuatro recortes numéricos nativos: **0,25–0,46 s cada uno**. Leyó las dos docenas; no produjo lecturas válidas de los dos importes por par en esos recortes.
- Hoja completa de 1741 × 2400, límite del detector 2400: **95,5 s**, aproximadamente 10 s en detección y 85,4 s en reconocimiento. Detectó 265 regiones y conservó 260 lecturas con el umbral aplicado.
- La lectura de la hoja completa recuperó el mismo precio que la segunda lectura Tesseract del ensayo anterior. El híbrido alcanzó **38 asociaciones correctas de 40**, conservó las 37 del control y no propuso asociaciones incorrectas. **No mejoró las 38 ya obtenidas con Tesseract.**

El motor también leyó un importe incorrecto con puntuación **95,6%**. La validación de la fila y la relación comercial impidió usarlo. No se corrigieron letras para convertirlas en cifras ni se completaron importes usando la referencia digital.

PaddleOCR devuelve cajas por línea, mientras que el parser existente recibe palabras. El adaptador directo, que conservó esas cajas sin inventar coordenadas de palabras, no reconstruyó asociaciones de artículos: **no significa que el OCR no haya leído texto**. Para evaluar la segunda lectura se usaron las filas y columnas ya identificadas en el control, una única lectura numérica por celda, docena corroborada y relación 12:1. La API advierte además que su preprocesador documental y la orientación de líneas no están soportados en este SDK; su disponibilidad en el proyecto Python no implica soporte en navegador. Fuente: [SDK oficial PaddleOCR.js](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js/packages/core).

**Medición del desenfoque.** Se ensayó una medida direccional de extensión del borde: contraste tinta/papel dividido por el percentil 90 de la magnitud del gradiente, agrupando normales de borde en 0°, 45°, 90° y 135°. Referencia de la técnica: [doc-qual-scorer](https://github.com/joeVenner/doc-qual-scorer/blob/main/docqual/checks/blur.py). El prototipo independiente utilizó una máscara fija construida con cajas OCR almacenadas; no es todavía un control de calidad de cámara en tiempo real.

| Variante de la misma fotografía | Media cuadrática del Laplaciano en texto | Extensión de borde horizontal |
| --- | --- | --- |
| Control | 280 | 3,21 px |
| Desenfoque gaussiano añadido, sigma 1,5 | 32 | 4,86 px |
| El mismo desenfoque más ruido, sigma 8 | 1146 | 4,67 px |

El ruido puede elevar mucho la puntuación del Laplaciano sin recuperar detalle. La medida de extensión de borde distinguió mejor este caso, aunque también cambió con el ruido. Son degradaciones simuladas sobre una captura real, sin repetir OCR ni calibrar umbrales. El cálculo completo tardó 0,41–0,64 s en escritorio; un control de cámara necesitaría análisis reducido y segmentación de texto local, sin depender de cajas devueltas por una API. No se adoptan umbrales universales a partir de este ensayo.

**Otras referencias nuevas para explorar:**

| Proyecto | Técnica y siguiente uso posible |
| --- | --- |
| [Ocrs](https://github.com/robertknight/ocrs), [compilación JS/WASM](https://github.com/robertknight/ocrs/tree/main/js) | OCR neuronal con runtime RTen y soporte WASM experimental. El proyecto reconoce alfabeto latino y advierte que está en vista previa. El paquete mencionado en su ejemplo JS no estaba disponible en npm durante esta revisión; requiere preparar una compilación. No se midió su precisión ni su costo. |
| [doc-qual-scorer](https://github.com/joeVenner/doc-qual-scorer) | Calidad por regiones de texto, extensión direccional de bordes y escala de caracteres. Sus umbrales se calibraron con páginas sintéticas y Tesseract; requieren validación sobre capturas de nuestros dispositivos antes de usarlos como bloqueo de captura. |
| [Handheld Multi-Frame Super-Resolution](https://github.com/Jamy-L/Handheld-Multi-Frame-Super-Resolution) | Reconstrucción con alineación local, pesos de robustez y modelo de ruido de cámara. Implementación educativa basada en ráfagas RAW, Python/Numba y GPU: sirve como referencia de fusión, no como dependencia directa de la PWA ni como prueba de mejora sobre JPEG/PNG. |

La prioridad respaldada por estos ensayos es **validar alineación con giro sobre ráfagas reales y medir calidad dentro del documento**. Para segunda lectura de importes, Tesseract por celda mantiene el mejor resultado observado con menor costo en esta muestra. La alineación con giro y los nuevos motores OCR siguen fuera de la aplicación pública. Posteriormente se incorporó la comprobación orientativa de detalle en la captura única, descrita arriba; no es el prototipo de calidad post-OCR ni sus umbrales de laboratorio.

## Uso offline

En una versión compilada y servida por HTTPS:

1. Abrir la aplicación con conexión.
2. Esperar a que se active su service worker.
3. Pulsar **Preparar para usar sin conexión**.
4. Esperar la confirmación de que se descargaron todos los motores.
5. Volver a abrirla sin conexión y cargar una fotografía local o usar la cámara, si el navegador lo permite.

El caché guarda la aplicación y sus motores, no las fotografías del usuario. Las actualizaciones cambian la versión del caché. Los navegadores pueden borrar datos temporales cuando falta espacio; el modo offline debe comprobarse en el dispositivo de uso.

## Privacidad y publicación

El repositorio contiene código, motores, licencias, configuración, pruebas con datos sintéticos y métricas agregadas de experimentos. No contiene fotografías de usuarios, documentos comerciales, respuestas OCR de documentos privados, credenciales, bases de datos ni variables privadas.

La aplicación no envía fotografías al servidor. Descargar un archivo guarda una copia en el dispositivo; compartirla después queda a decisión del usuario. La cámara requiere permiso explícito del navegador y se detiene al cerrarla o abandonar el componente.

El alojamiento público y StackBlitz entregan los archivos de la aplicación y las dependencias; se aplican sus propias condiciones de servicio. El escáner no agrega analítica ni recolección de documentos.

### Ensayo de superresolución para OCR

Prueba local del **11/10/2026** sobre cinco recortes de una fotografía privada ya rectificada: cuatro campos numéricos y un código ambiguo. Se compararon la resolución nativa, Lanczos4 ×2 y dos redes de superresolución ×2: [ESPCN](https://github.com/fannymonori/TF-ESPCN) y [FSRCNN](https://github.com/Saafke/FSRCNN_Tensorflow). Los recortes se delimitaron con las cajas del OCR previo; la referencia digital se consultó exclusivamente después del reconocimiento para evaluar las lecturas.

| Preparación | Campos correctos, de 5 | Tiempo de preparación de los cinco recortes |
| --- | ---: | ---: |
| Resolución nativa | 3 | Sin ampliación |
| Lanczos4 ×2 | 3 | 3,65 ms |
| ESPCN ×2 | 3 | 19,69 ms |
| FSRCNN ×2 | 3 | 18,58 ms |

Se utilizó Tesseract.js 7, modelo `eng`, `PSM.SINGLE_LINE`, diccionarios general y frecuente desactivados, y una lista de caracteres numéricos para los precios o alfanuméricos para el código. En los importes se comparó el valor numérico, admitiendo separadores de miles; el código exigió coincidencia exacta. Las redes conservaron las tres lecturas correctas, pero no recuperaron el precio erróneo ni el código ambiguo. Algunos campos aumentaron su confianza sin mejorar la exactitud. **Estas métricas corresponden a cinco recortes; no sustituyen las métricas de asociación de las 40 filas ni prueban un rendimiento general.**

La inferencia se ejecutó en CPU con **OpenCV contrib 4.12.0 en Python**, mediante su [módulo `dnn_superres`](https://docs.opencv.org/4.x/d5/d29/tutorial_dnn_superres_upscale_image_single.html). Los tiempos son una medición de laboratorio: excluyen carga de modelos, OCR, lectura y escritura de archivos, y no estiman la velocidad en teléfonos. Los pesos pesan 86.446 bytes para ESPCN y 38.973 bytes para FSRCNN; esos tamaños no incluyen el motor de ejecución ni su memoria de trabajo.

Procedencia de los pesos utilizados:

- ESPCN ×2: [`export/ESPCN_x2.pb`](https://github.com/fannymonori/TF-ESPCN/blob/master/export/ESPCN_x2.pb), SHA256 `59f77351e1d7c0057bf6fe088b4a8a07e42c468c8c8aebb674a6b4ea1823221d`.
- FSRCNN ×2: [`models/FSRCNN_x2.pb`](https://github.com/Saafke/FSRCNN_Tensorflow/blob/master/models/FSRCNN_x2.pb), SHA256 `366b33f0084c7b3f2bf6724f0a2c77bca94fcec9d7b6d72389d330073b380d5c`.

La distribución actual de OpenCV.js no expone `DnnSuperResImpl`. El intento directo con estos pesos TensorFlow en OpenCV 5 para Python falló en la capa `DepthToSpace`; esto no demuestra incompatibilidad de otros modelos o formatos. **Todavía no se validó superresolución en el navegador y no se incorporó a la aplicación.**

El siguiente candidato a evaluar es un modelo entrenado para texto, como [Text Gestalt de PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version2.x/algorithm/super_resolution/algorithm_sr_gestalt.en.md). Su documentación describe inferencia Python por recortes; no ofrece por sí misma una integración validada para esta PWA. Antes de integrarlo, corresponde comparar aciertos exactos, errores nuevos y coste en el teléfono sobre más fotografías. El original debe conservarse y la superresolución no debe sustituir automáticamente una lectura comercial porque se vea más nítida.

Las fotografías, transcripciones, pesos de prueba y respuestas OCR de este ensayo permanecen fuera del repositorio público.

#### Ensayo con Text Gestalt

La revisión del código oficial de [Text Gestalt en PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.7/tools/infer/predict_sr.py) muestra que la configuración de ejemplo `3,32,128` reduce cada entrada a **64 × 16** y genera una salida de **128 × 32**. Los recortes de este ensayo tienen mayor altura. Por tanto, esa configuración no equivale a ampliar su resolución nativa al doble y puede descartar detalle antes de la inferencia. El archivo de entrenamiento publicado ocupa **354.048.000 bytes**; no representa necesariamente el tamaño mínimo del modelo de inferencia exportado.

El ensayo se ejecutó el **11/10/2026** con PaddlePaddle 2.6.2 en CPU, NumPy 1.26.4 y Pillow 12.3.0. Se usaron los mismos cinco recortes y el mismo OCR del ensayo anterior. La referencia digital intervino exclusivamente después del reconocimiento. Se compararon la configuración de ejemplo, un control bicúbico con exactamente las mismas dimensiones y una variante experimental que conserva las dimensiones de entrada y genera una salida al doble.

| Variante | Lecturas correctas, de 5 | Campos recuperados | Lecturas correctas del original que se pierden | Preparación de los cinco recortes |
| --- | ---: | ---: | ---: | ---: |
| Original, sin superresolución | 3 | — | — | Sin ampliación |
| Control bicúbico, 64 × 16 → 128 × 32 | 1 | 0 | 2 | 1,19 ms |
| Text Gestalt, 64 × 16 → 128 × 32 | 0 | 0 | 3 | 1.281,93 ms |
| Text Gestalt, entrada nativa → salida ×2 | 2 | 0 | 1 | 4.663,20 ms |

La variante con entrada nativa ejecuta las mismas capas y pesos, pero cambia las dimensiones respecto de la configuración documentada: sus resultados **no describen el benchmark publicado por los autores**. El control bicúbico demuestra que reducir estos recortes ya deteriora la lectura; aun con sus mismas dimensiones, Text Gestalt no lo mejora en esta muestra. La variante nativa cambia incorrectamente un precio que antes se reconocía bien y no resuelve los dos campos pendientes. No se integra ninguna de estas variantes al escáner.

Se ejecutaron las clases originales de la arquitectura TSRN de PaddleOCR. Se omitieron exclusivamente el módulo auxiliar de entrenamiento y la transformación STN que el código original no utiliza en modo evaluación. Se verificó que todos los **253 tensores** de las capas de superresolución coinciden por nombre y forma con el checkpoint; no hubo claves faltantes ni inesperadas. La conversión de salida siguió el ejemplo oficial y los valores producidos permanecieron dentro de `[0,1]`.

Los parámetros de las capas utilizadas suman **4.023.312 bytes**, incluyendo entradas duplicadas de GRU en el estado serializado; no equivalen al tamaño de una exportación ONNX validada. El archivo completo de parámetros pesa 271.039.023 bytes y tiene SHA256 `24510cc48aac87d250c572641bef6d8be8b9f7afa0b8de06c0159ecec53afd1c`. El archivo de código de referencia utilizado tiene SHA256 `36787ca7583fe7f3e88ea8d11d0f54a8ac2a793cee5abd8038c872fef96a47c9`.

Los tiempos incluyen preparación del recorte y ejecución, después de una pasada inicial de calentamiento; excluyen carga de pesos, OCR y escritura del PNG. El experimento no midió el pico de memoria ni la velocidad en teléfonos y no validó ejecución en el navegador. Son cinco recortes de una sola fotografía ya rectificada y filtrada: estos resultados no descartan todos los modelos especializados ni otras condiciones de captura.

Se conservan las imágenes originales, los recortes generados, las lecturas OCR y sus métricas fuera del repositorio público. Se mantiene el procesamiento actual, que obtuvo más lecturas correctas en esta comparación.

#### Segunda ronda de superresolución: SwinIR y EDSR

El **11/10/2026** se ensayaron [SwinIR-S ×2](https://github.com/JingyunLiang/SwinIR), variante oficial `002_lightweightSR_DIV2K_s64w8_SwinIR-S_x2`, y [EDSR ×2](https://github.com/Saafke/EDSR_Tensorflow). Sobre los **mismos cinco recortes difíciles** del primer ensayo, ambos obtuvieron **3 lecturas correctas de 5**, igual que el original y Lanczos4 ×2. Ninguno recuperó los dos campos pendientes.

Se amplió la prueba de SwinIR a **40 filas y tres campos por fila**: código, importe por docena e importe por par. Las posiciones se seleccionaron mediante las cajas del OCR principal, sus encabezados y las guías físicas de la tabla. Se prepararon recortes equivalentes con los filtros actuales y antes de compensar iluminación y aplicar nitidez; las dos imágenes comparten la misma geometría. La referencia del XLS se utilizó únicamente después del OCR y se alineó por el orden fijo de las filas físicas. No se proporcionaron códigos ni precios de referencia al modelo.

| Entrada y preparación | Códigos correctos / 40 | Importes correctos / 80 | Total / 120 | Lecturas recuperadas frente al original de esa entrada | Lecturas correctas que se pierden |
| --- | ---: | ---: | ---: | ---: | ---: |
| Filtros actuales, resolución nativa | 21 | 53 | 74 | — | — |
| Filtros actuales, Lanczos de Pillow ×2 | 16 | 52 | 68 | 6 | 12 |
| Filtros actuales, SwinIR ×2 | 17 | 56 | 73 | 11 | 12 |
| Antes de filtros, resolución nativa | 18 | 66 | 84 | — | — |
| Antes de filtros, Lanczos de Pillow ×2 | 18 | 59 | 77 | 4 | 11 |
| Antes de filtros, SwinIR ×2 | 9 | 22 | 31 | 1 | 54 |

Estos resultados corresponden a **Tesseract.js por recortes**, con los mismos parámetros y listas de caracteres del primer ensayo. **No equivalen a las métricas del OCR de página completa de Google Cloud Vision ni del parser de producción.** La comparación ampliada contiene 720 lecturas: dos entradas fotométricas, tres preparaciones y 120 campos. EDSR se evaluó exclusivamente en los cinco recortes iniciales. El control ampliado usa el filtro `LANCZOS` de Pillow; el control de los cinco recortes conserva la ampliación Lanczos4 de OpenCV del primer ensayo.

SwinIR aporta tres importes correctos más con los filtros actuales, pero pierde cuatro códigos correctos y tampoco mejora el total. En la entrada anterior a los filtros deteriora significativamente la lectura. El mejor total de esta ronda se obtiene leyendo los recortes anteriores a los filtros **sin superresolución**. Esto justifica explorar una entrada alternativa para la segunda lectura por celda; no justifica desactivar los filtros globales del escáner ni cambiar el OCR de producción a partir de una sola fotografía.

Se usó la arquitectura original de SwinIR sin modificar sus capas, con carga de estado `strict=True`, relleno por concatenación de la imagen invertida hasta el siguiente múltiplo de ocho, recorte de salida a las dimensiones de entrada ×2 y conversión RGB conforme al ejemplo oficial. La inferencia se ejecutó en CPU con PyTorch 2.6.0, timm 0.6.13 y dos hilos. EDSR se ejecutó con OpenCV contrib 4.12.0. No se entrenaron ni ajustaron pesos con el documento de evaluación.

Procedencia de los modelos:

- SwinIR-S ×2: [peso oficial](https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/002_lightweightSR_DIV2K_s64w8_SwinIR-S_x2.pth), **17.147.989 bytes**, SHA256 `193b229909ca89cd8b55de9c9e7fce146ae759d59dfcd78d8feb9dd1d6fa0fd7`.
- EDSR ×2: [peso publicado por su implementación TensorFlow](https://github.com/Saafke/EDSR_Tensorflow/blob/master/models/EDSR_x2.pb), **38.490.162 bytes**, SHA256 `585623221baa070279a0d1e7e113a4c3faba0f318ca7fdd9a65d9afc0763d9b4`.

SwinIR tardó aproximadamente 123–124 segundos por conjunto de 120 recortes en esta ejecución. La inferencia inicial se calentó antes de medir. Los tiempos excluyen carga de pesos, OCR y escritura de imágenes; hubo otras tareas de laboratorio durante parte del ensayo. No representan velocidad en teléfonos ni una comparación de rendimiento bajo carga controlada. Tampoco se midió el pico de memoria ni se validó una exportación para navegador.

Se conserva el procesamiento actual. Las imágenes y lecturas individuales permanecen en archivos locales privados, con una comparativa visual al mismo tamaño y una galería que permite elegir fila, campo y entrada; el original se amplía únicamente para visualizarlo. Las dependencias temporales se pueden reinstalar desde las versiones registradas. Ninguna foto, transcripción o referencia personal de esta prueba se publica con el código.

## Estructura del código

| Archivo | Responsabilidad |
| --- | --- |
| `src/shared/document-scanner/DocumentScannerApp.tsx` | Interfaz y comparación de resultados. |
| `src/shared/document-scanner/BurstDocumentCapture.tsx` | Cámara, contorno en vivo y captura de ráfaga. |
| `src/shared/ui/DocumentImageEditor.tsx` | Esquinas, rotación y preparación geométrica. |
| `src/app/documentScanner.client.ts` | Detector y solicitudes de perspectiva al worker. |
| `src/shared/document-scanner/cameraCapture.client.ts` | Solicitud de enfoque y captura fotográfica con alternativas según el dispositivo. |
| `src/shared/document-scanner/captureQuality.ts` | Comprobación orientativa de detalle y estabilidad dentro de la hoja. |
| `src/shared/document-scanner/burst.ts` | Nitidez, alineación y fusión de capturas. |
| `src/shared/document-scanner/burst.worker.ts` | Ejecución de la fusión en segundo plano. |
| `src/shared/document-scanner/curvedTableGeometry.ts` | Ajuste QR, curvas y mapa inverso combinado. |
| `src/shared/document-scanner/tableGeometry.ts` | Corrección alternativa de líneas inclinadas. |
| `src/shared/document-scanner/scanner.worker.ts` | OpenCV, perspectiva, curvatura y filtros. |
| `src/shared/document-scanner/scanner.client.ts` | Preparación de imágenes, opciones y exportación. |
| `src/shared/document-scanner/scannerSession.ts` | Tipos de metadatos geométricos. |
| `src/app/scannerAssets.ts` | Rutas compatibles con alojamientos en subcarpetas. |
| `public/vendor/` | Motores distribuidos localmente y sus licencias. |
| `scripts/build-offline.mjs` | Versión del caché y recursos de producción. |

## Pruebas y límites

La validación de esta rama experimental pasó **59 pruebas unitarias y 18 pruebas de navegador**, además de la comprobación de tipos y la compilación de producción. Todas las imágenes de prueba son sintéticas.

Las pruebas unitarias utilizan datos sintéticos para verificar validación de esquinas, nitidez y fusión, ajuste cúbico, orden de curvas, mapas y fallback. Las pruebas de navegador verifican superposición del contorno, anchuras móviles, exportación, funcionamiento de los motores, modo offline, captura única con enfoque solicitado, resolución de foto nativa, captura sin controles de enfoque o detalle confirmado, cancelación sin sustituir el documento anterior, captura con una demora simulada de 1,8 s en el detector de bordes, captura cuando el detector falla, cierre con Escape cuando el navegador rechaza fullscreen y estabilidad del contorno ante una detección errónea aislada, con indicación de distancia. La prueba adicional de OpenCV 5.0 verifica procesamiento bajo una CSP que permite WebAssembly y prohíbe `unsafe-eval`. La calibración verifica carga y detección de fotos sintéticas, cálculo y exportación de perfil, recuperación de parámetros de cámara conocidos, corrección de una línea distorsionada, rechazo de entradas incompatibles y cancelación. El patrón PDF y su generación alternativa también se verifican sin conexión.

La duración depende de la resolución, el número de imágenes, la primera carga de WebAssembly y el dispositivo. El tiempo mostrado junto al resultado corresponde a la etapa de filtros; no representa el tiempo completo desde la apertura de cámara hasta la descarga.

Una tabla con líneas visibles puede rectificarse mejor que una página sin guías. Arrugas, pliegues bruscos, superficies no desarrollables, sombras intensas y desenfoque fuerte pueden impedir corregir la curvatura. Esta función es experimental y conserva un fallback explícito.

La compatibilidad de cámara, `ImageCapture`, WebAssembly, memoria y formatos de exportación depende del navegador. Cuando la cámara no está disponible, se pueden cargar fotografías existentes.

No se garantiza reconocimiento perfecto, aumento real de resolución ni corrección general de cualquier deformación del papel.

## Licencias y atribuciones

El código propio se publica bajo [licencia MIT](LICENSE).

- `101arrowz/scanner`: MIT; atribución y licencia en [`public/vendor/document-scanner/LICENSE`](public/vendor/document-scanner/LICENSE).
- OpenCV: Apache 2.0; licencia en [`public/vendor/opencv/LICENSE`](public/vendor/opencv/LICENSE).
- Modelo DocAligner LCNet100: Apache 2.0; [licencia](public/vendor/docaligner/LICENSE) y [procedencia, hash y preprocesamiento](public/vendor/docaligner/SOURCE.txt). Los pesos originales se sirven localmente.
- Distribución de OpenCV.js: licencia y procedencia en [`DISTRIBUTION-LICENSE`](public/vendor/opencv/DISTRIBUTION-LICENSE) y [`SOURCE.txt`](public/vendor/opencv/SOURCE.txt).

La distribución de OpenCV.js incorpora adaptaciones de `createJsInvoker` y `__emval_create_invoker` para utilizar cierres estáticos en lugar de constructores dinámicos `Function`. Se conservan sus avisos de licencia y se documenta esa modificación en `SOURCE.txt`. La adaptación se puede reproducir con `python3 scripts/adapt-opencv-csp.py <opencv.js original de 5.0.0-release.1> public/vendor/opencv/opencv-5.0.0.js`; el script verifica el SHA256 de entrada. Ver el [informe de la prueba de OpenCV 5.0](docs/opencv-5-trial.md).
